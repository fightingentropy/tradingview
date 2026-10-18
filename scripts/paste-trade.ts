import type { NewsItem } from '../src/domain/news.ts';

export const PASTE_TRADE_URL = 'https://app.paste.trade';

const SHOWS_URL = `${PASTE_TRADE_URL}/api/shows`;
const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60_000;
const MAX_ACTIVE_SHOWS = 15;
const MAX_SOURCES_PER_SHOW = 30;
const SHOW_FETCH_CONCURRENCY = 3;

// Untrusted wire shapes from the public Paste Trade API.
interface PasteShowSummary { id?: unknown; name?: unknown; latest_published_at?: unknown }
interface PasteTrade { display_ticker?: unknown; ticker?: unknown; direction?: unknown; thesis?: unknown; headline_quote?: unknown }
interface PasteSourceEntry {
  source?: {
    id?: unknown;
    published_at?: unknown;
    created_at?: unknown;
    title?: unknown;
    source_images?: unknown;
    thumbnail_url?: unknown;
  };
  trades?: unknown;
  author?: { name?: unknown; handle?: unknown; avatar_url?: unknown };
}
interface PasteShowPayload {
  show?: { id?: unknown; name?: unknown; avatar_url?: unknown };
  sources?: unknown;
}

export interface ActivePasteShow {
  id: string;
  name: string;
  latestPublishedAt: string;
  latestTimestamp: number;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const showCache = new Map<string, { latestPublishedAt: string; items: NewsItem[] }>();

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asHttpsUrl(value: unknown): string | undefined {
  const text = asNonEmptyString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text, PASTE_TRADE_URL);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function cleanText(value: unknown): string | undefined {
  return asNonEmptyString(value)?.replace(/\s+/g, ' ');
}

function timestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : undefined;
}

export function selectActivePasteShows(payload: unknown, now = Date.now()): ActivePasteShow[] {
  const items = (payload as { items?: unknown } | null)?.items;
  const shows: PasteShowSummary[] = Array.isArray(items) ? items : [];
  return shows
    .flatMap((show) => {
      const id = asNonEmptyString(show?.id);
      const name = asNonEmptyString(show?.name);
      const latestPublishedAt = asNonEmptyString(show?.latest_published_at);
      const latestTimestamp = timestamp(latestPublishedAt);
      if (!id || !name || !latestPublishedAt || latestTimestamp === undefined) return [];
      if (latestTimestamp > now + 5 * 60_000 || now - latestTimestamp > ACTIVE_WINDOW_MS) return [];
      return [{ id, name, latestPublishedAt, latestTimestamp }];
    })
    .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
    .slice(0, MAX_ACTIVE_SHOWS);
}

function tradeLine(trade: PasteTrade | undefined): string | undefined {
  const ticker = cleanText(trade?.display_ticker) ?? cleanText(trade?.ticker);
  const direction = cleanText(trade?.direction)?.toUpperCase();
  const thesis = cleanText(trade?.thesis) ?? cleanText(trade?.headline_quote);
  if (!ticker || !direction || !thesis) return undefined;
  return `${direction} ${ticker} — ${thesis}`;
}

export function normalizePasteShow(input: unknown): NewsItem[] {
  const payload = input as PasteShowPayload | null;
  const show = payload?.show;
  const showName = asNonEmptyString(show?.name) ?? 'Paste Trade';
  const showHandle = asNonEmptyString(show?.id) ?? 'paste';
  const sources: PasteSourceEntry[] = Array.isArray(payload?.sources) ? payload.sources : [];

  return sources
    .flatMap((entry): NewsItem[] => {
      const source = entry?.source;
      const id = asNonEmptyString(source?.id);
      const publishedAtValue = asNonEmptyString(source?.published_at ?? source?.created_at);
      const publishedTimestamp = timestamp(publishedAtValue);
      const title = cleanText(source?.title);
      const trades = Array.isArray(entry?.trades)
        ? (entry.trades as PasteTrade[]).map(tradeLine).filter((line): line is string => Boolean(line)).slice(0, 6)
        : [];
      if (!id || !publishedAtValue || publishedTimestamp === undefined || trades.length === 0) {
        return [];
      }

      const authorName = asNonEmptyString(entry?.author?.name) ?? showName;
      const authorHandle = asNonEmptyString(entry?.author?.handle) ?? showHandle;
      const avatarUrl = asHttpsUrl(entry?.author?.avatar_url ?? show?.avatar_url);
      const image = Array.isArray(source?.source_images)
        ? (source.source_images as unknown[]).map(asHttpsUrl).find((url): url is string => Boolean(url))
        : asHttpsUrl(source?.thumbnail_url);

      return [{
        id,
        source: 'paste',
        author: {
          name: authorName,
          handle: authorHandle,
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        text: [title, ...trades].filter(Boolean).join('\n\n'),
        publishedAt: new Date(publishedTimestamp).toISOString(),
        url: `${PASTE_TRADE_URL}/s/${encodeURIComponent(id)}`,
        media: image ? [{ type: 'image', previewUrl: image }] : [],
      }];
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_SOURCES_PER_SHOW);
}

async function fetchJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TradingViewNewsBridge/1.0 (+localhost personal feed)',
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Paste Trade returned ${response.status}`);
  return response.json();
}

async function loadShow(fetchImpl: FetchLike, show: ActivePasteShow): Promise<NewsItem[]> {
  const cached = showCache.get(show.id);
  if (cached?.latestPublishedAt === show.latestPublishedAt) return cached.items;

  try {
    const payload = await fetchJson(
      fetchImpl,
      `${PASTE_TRADE_URL}/api/shows/${encodeURIComponent(show.id)}`,
    );
    const items = normalizePasteShow(payload);
    showCache.set(show.id, { latestPublishedAt: show.latestPublishedAt, items });
    return items;
  } catch (error) {
    if (cached) return cached.items;
    throw error;
  }
}

export async function fetchPasteTrade(
  { count = 100, fetchImpl = fetch as FetchLike, now = Date.now() }: { count?: number; fetchImpl?: FetchLike; now?: number } = {},
): Promise<NewsItem[]> {
  const index = await fetchJson(fetchImpl, SHOWS_URL);
  const shows = selectActivePasteShows(index, now);
  const results: PromiseSettledResult<NewsItem[]>[] = [];

  for (let index = 0; index < shows.length; index += SHOW_FETCH_CONCURRENCY) {
    const batch = shows.slice(index, index + SHOW_FETCH_CONCURRENCY);
    results.push(...await Promise.allSettled(batch.map((show) => loadShow(fetchImpl, show))));
  }

  const byId = new Map<string, NewsItem>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) byId.set(item.id, item);
  }
  const items = [...byId.values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, count);
  if (items.length === 0) throw new Error('Paste Trade returned no recent trade calls');
  return items;
}

export function resetPasteTradeCache(): void {
  showCache.clear();
}
