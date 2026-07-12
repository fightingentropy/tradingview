export const PASTE_TRADE_URL = 'https://app.paste.trade';

const SHOWS_URL = `${PASTE_TRADE_URL}/api/shows`;
const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60_000;
const MAX_ACTIVE_SHOWS = 15;
const MAX_SOURCES_PER_SHOW = 30;
const SHOW_FETCH_CONCURRENCY = 3;
const showCache = new Map();

function asNonEmptyString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asHttpsUrl(value) {
  const text = asNonEmptyString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text, PASTE_TRADE_URL);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function cleanText(value) {
  return asNonEmptyString(value)?.replace(/\s+/g, ' ');
}

function timestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : undefined;
}

export function selectActivePasteShows(payload, now = Date.now()) {
  const shows = Array.isArray(payload?.items) ? payload.items : [];
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

function tradeLine(trade) {
  const ticker = cleanText(trade?.display_ticker) ?? cleanText(trade?.ticker);
  const direction = cleanText(trade?.direction)?.toUpperCase();
  const thesis = cleanText(trade?.thesis) ?? cleanText(trade?.headline_quote);
  if (!ticker || !direction || !thesis) return undefined;
  return `${direction} ${ticker} — ${thesis}`;
}

export function normalizePasteShow(payload) {
  const show = payload?.show;
  const showName = asNonEmptyString(show?.name) ?? 'Paste Trade';
  const showHandle = asNonEmptyString(show?.id) ?? 'paste';
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];

  return sources
    .flatMap((entry) => {
      const source = entry?.source;
      const id = asNonEmptyString(source?.id);
      const publishedAtValue = asNonEmptyString(source?.published_at ?? source?.created_at);
      const publishedTimestamp = timestamp(publishedAtValue);
      const title = cleanText(source?.title);
      const trades = Array.isArray(entry?.trades)
        ? entry.trades.map(tradeLine).filter(Boolean).slice(0, 6)
        : [];
      if (!id || !publishedAtValue || publishedTimestamp === undefined || trades.length === 0) {
        return [];
      }

      const authorName = asNonEmptyString(entry?.author?.name) ?? showName;
      const authorHandle = asNonEmptyString(entry?.author?.handle) ?? showHandle;
      const avatarUrl = asHttpsUrl(entry?.author?.avatar_url ?? show?.avatar_url);
      const image = Array.isArray(source?.source_images)
        ? source.source_images.map(asHttpsUrl).find(Boolean)
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

async function fetchJson(fetchImpl, url) {
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

async function loadShow(fetchImpl, show) {
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

export async function fetchPasteTrade({ count = 100, fetchImpl = fetch, now = Date.now() } = {}) {
  const index = await fetchJson(fetchImpl, SHOWS_URL);
  const shows = selectActivePasteShows(index, now);
  const results = [];

  for (let index = 0; index < shows.length; index += SHOW_FETCH_CONCURRENCY) {
    const batch = shows.slice(index, index + SHOW_FETCH_CONCURRENCY);
    results.push(...await Promise.allSettled(batch.map((show) => loadShow(fetchImpl, show))));
  }

  const byId = new Map();
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

export function resetPasteTradeCache() {
  showCache.clear();
}
