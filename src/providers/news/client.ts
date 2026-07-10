import type {
  NewsFeedNotice,
  NewsFeedPage,
  NewsItem,
  NewsMedia,
  NewsSourceFilter,
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
    (item.source !== 'x' && item.source !== 'telegram') ||
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
    (notice.source !== 'x' && notice.source !== 'telegram') ||
    typeof notice.message !== 'string'
  ) {
    return null;
  }
  return { id: notice.id, source: notice.source, message: notice.message };
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
    nextCursor: typeof raw.nextCursor === 'string' ? raw.nextCursor : undefined,
    updatedAt:
      typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}
