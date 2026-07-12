import type {
  NewsExecutiveSummary,
  NewsExecutiveSummaryBullet,
  NewsFeedNotice,
  NewsFeedPage,
  NewsItem,
  NewsMedia,
  NewsSourceFilter,
  NewsSummarySourceReference,
} from '@/domain/news';

const DEV_NEWS_FEED_URL = 'http://127.0.0.1:8430/feed';
const NEWS_FEED_URL = process.env.EXPO_PUBLIC_NEWS_FEED_URL?.trim() ||
  (__DEV__ ? DEV_NEWS_FEED_URL : undefined);
const NEWS_RELAY_ACCESS_TOKEN = process.env.EXPO_PUBLIC_NEWS_RELAY_ACCESS_TOKEN?.trim();
const PAGE_SIZE = 40;

export const isNewsFeedConfigured = Boolean(NEWS_FEED_URL);
export const usesLocalNewsFeed = NEWS_FEED_URL === DEV_NEWS_FEED_URL;
export const newsFeedEndpoint = NEWS_FEED_URL;
export const newsRelayAccessToken = NEWS_RELAY_ACCESS_TOKEN;

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseItem(value: unknown): NewsItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const author = item.author as Record<string, unknown> | undefined;
  if (
    typeof item.id !== 'string' ||
    (item.source !== 'x' &&
      item.source !== 'telegram' &&
      item.source !== 'digg' &&
      item.source !== 'paste') ||
    typeof item.text !== 'string' ||
    typeof item.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(item.publishedAt)) ||
    !author ||
    typeof author.name !== 'string'
  ) {
    return null;
  }

  const media = Array.isArray(item.media)
    ? item.media.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const candidate = entry as Record<string, unknown>;
        if (
          (candidate.type !== 'image' && candidate.type !== 'video') ||
          !isHttpsUrl(candidate.previewUrl)
        ) {
          return [];
        }
        return [{ type: candidate.type, previewUrl: candidate.previewUrl } satisfies NewsMedia];
      })
    : undefined;

  return {
    id: item.id,
    source: item.source,
    text: item.text,
    publishedAt: item.publishedAt,
    author: {
      name: author.name,
      handle: typeof author.handle === 'string' ? author.handle : undefined,
      avatarUrl: isHttpsUrl(author.avatarUrl) ? author.avatarUrl : undefined,
    },
    url: isHttpsUrl(item.url) ? item.url : undefined,
    media,
  };
}

function parseNotice(value: unknown): NewsFeedNotice | null {
  if (!value || typeof value !== 'object') return null;
  const notice = value as Record<string, unknown>;
  if (
    typeof notice.id !== 'string' ||
    (notice.source !== 'x' &&
      notice.source !== 'telegram' &&
      notice.source !== 'digg' &&
      notice.source !== 'paste') ||
    typeof notice.message !== 'string'
  ) {
    return null;
  }
  return { id: notice.id, source: notice.source, message: notice.message };
}

function parseSummarySource(value: unknown): NewsSummarySourceReference | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.itemKey !== 'string' ||
    (source.source !== 'x' && source.source !== 'telegram' && source.source !== 'digg' && source.source !== 'paste') ||
    typeof source.title !== 'string' ||
    typeof source.author !== 'string' ||
    typeof source.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(source.publishedAt)) ||
    !isHttpsUrl(source.url)
  ) {
    return null;
  }
  return {
    itemKey: source.itemKey,
    source: source.source,
    title: source.title,
    author: source.author,
    publishedAt: source.publishedAt,
    url: source.url,
  };
}

function parseExecutiveSummary(value: unknown): NewsExecutiveSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const summary = value as Record<string, unknown>;
  const pulse = summary.pulse as Record<string, unknown> | undefined;
  const pulseLabels = ['risk-on', 'risk-off', 'mixed', 'calm', 'event-driven'] as const;
  if (
    typeof summary.id !== 'string' ||
    typeof summary.generatedAt !== 'string' ||
    typeof summary.windowStart !== 'string' ||
    typeof summary.windowEnd !== 'string' ||
    !Number.isFinite(Date.parse(summary.generatedAt)) ||
    !Number.isFinite(Date.parse(summary.windowStart)) ||
    !Number.isFinite(Date.parse(summary.windowEnd)) ||
    typeof summary.headline !== 'string' ||
    typeof summary.overview !== 'string' ||
    !pulse ||
    typeof pulse.label !== 'string' ||
    !pulseLabels.includes(pulse.label as (typeof pulseLabels)[number]) ||
    typeof pulse.summary !== 'string' ||
    !Array.isArray(summary.bullets) ||
    typeof summary.noiseSummary !== 'string'
  ) {
    return undefined;
  }

  const bullets = summary.bullets.flatMap((value): NewsExecutiveSummaryBullet[] => {
    if (!value || typeof value !== 'object') return [];
    const bullet = value as Record<string, unknown>;
    const sources = Array.isArray(bullet.sources)
      ? bullet.sources.map(parseSummarySource).filter((source): source is NewsSummarySourceReference => source !== null)
      : [];
    if (
      typeof bullet.headline !== 'string' ||
      typeof bullet.summary !== 'string' ||
      typeof bullet.whyItMatters !== 'string' ||
      typeof bullet.details !== 'string' ||
      sources.length === 0
    ) {
      return [];
    }
    return [{
      headline: bullet.headline,
      summary: bullet.summary,
      whyItMatters: bullet.whyItMatters,
      details: bullet.details,
      sources,
    }];
  });
  if (bullets.length === 0) return undefined;

  const count = (source: 'x' | 'telegram' | 'digg' | 'paste') => {
    const candidate = (summary.sourceCounts as Record<string, unknown> | undefined)?.[source];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(0, Math.floor(candidate)) : 0;
  };
  return {
    id: summary.id,
    generatedAt: summary.generatedAt,
    windowStart: summary.windowStart,
    windowEnd: summary.windowEnd,
    headline: summary.headline,
    overview: summary.overview,
    pulse: {
      label: pulse.label as NewsExecutiveSummary['pulse']['label'],
      summary: pulse.summary,
    },
    bullets,
    watchNext: Array.isArray(summary.watchNext)
      ? summary.watchNext.filter((item): item is string => typeof item === 'string').slice(0, 5)
      : [],
    noiseSummary: summary.noiseSummary,
    analyzedItems: typeof summary.analyzedItems === 'number' && Number.isFinite(summary.analyzedItems)
      ? Math.max(0, Math.floor(summary.analyzedItems))
      : 0,
    sourceCounts: { x: count('x'), telegram: count('telegram'), digg: count('digg'), paste: count('paste') },
    model: typeof summary.model === 'string' ? summary.model : 'gpt-5.6-sol',
    reasoningEffort: typeof summary.reasoningEffort === 'string' ? summary.reasoningEffort : 'xhigh',
  };
}

export async function loadNewsFeed(
  source: NewsSourceFilter,
  cursor?: string,
): Promise<NewsFeedPage> {
  if (!NEWS_FEED_URL) throw new Error('News feed is not connected');

  const url = new URL(NEWS_FEED_URL);
  url.searchParams.set('source', source);
  url.searchParams.set('limit', String(PAGE_SIZE));
  if (cursor) url.searchParams.set('cursor', cursor);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(NEWS_RELAY_ACCESS_TOKEN
        ? { Authorization: `Bearer ${NEWS_RELAY_ACCESS_TOKEN}` }
        : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`News service returned ${response.status}`);

  const raw = (await response.json()) as Record<string, unknown>;
  const items = Array.isArray(raw.items)
    ? raw.items.map(parseItem).filter((item): item is NewsItem => item !== null)
    : [];
  const notices = Array.isArray(raw.notices)
    ? raw.notices.map(parseNotice).filter((notice): notice is NewsFeedNotice => notice !== null)
    : undefined;

  return {
    items,
    notices,
    executiveSummary: parseExecutiveSummary(raw.executiveSummary),
    nextCursor: typeof raw.nextCursor === 'string' ? raw.nextCursor : undefined,
    updatedAt:
      typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}
