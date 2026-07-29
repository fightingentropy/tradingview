import type { NewsItem, NewsSource } from './news';

export interface NewsNotificationSourceOption {
  id: string;
  source: NewsSource;
  label: string;
  detail: string;
}

const X_LIST_ID = '1933193197817135501';

export const NEWS_NOTIFICATION_SOURCES = [
  {
    id: `x:list:${X_LIST_ID}`,
    source: 'x',
    label: 'X List',
    detail: 'Your configured list timeline',
  },
  {
    id: 'telegram:tradfi_t3',
    source: 'telegram',
    label: '@tradfi_t3',
    detail: 'Telegram channel',
  },
  {
    id: 'telegram:trad_fin',
    source: 'telegram',
    label: '@trad_fin',
    detail: 'Telegram channel',
  },
  {
    id: 'telegram:watcherguru',
    source: 'telegram',
    label: '@WatcherGuru',
    detail: 'Telegram channel',
  },
  {
    id: 'telegram:chain_alerts',
    source: 'telegram',
    label: '@chain_alerts',
    detail: 'Telegram channel',
  },
  {
    id: 'telegram:dbnewsdelayed',
    source: 'telegram',
    label: '@dbnewsdelayed',
    detail: 'Telegram channel',
  },
  {
    id: 'telegram:hyperliquid_announcements',
    source: 'telegram',
    label: '@hyperliquid_announcements',
    detail: 'Telegram channel',
  },
] as const satisfies readonly NewsNotificationSourceOption[];

export const ALL_NEWS_NOTIFICATION_SOURCE_IDS = NEWS_NOTIFICATION_SOURCES.map(
  ({ id }) => id,
);

const VALID_SOURCE_IDS = new Set<string>(ALL_NEWS_NOTIFICATION_SOURCE_IDS);
const NEWS_SOURCES = new Set<NewsSource>(['x', 'telegram', 'digg', 'paste']);

export interface NewsNotificationTarget {
  itemId: string;
  source: NewsSource;
}

export interface NewsPushNotificationContent {
  title: string;
  body: string;
  itemId: string;
  itemUrl?: string;
}

const MAX_NEWS_NOTIFICATION_BODY_LENGTH = 180;

export function newsNotificationItemKey(
  item: Pick<NewsItem, 'source' | 'id'>,
): string {
  return `${item.source}:${item.id}`;
}

export function normalizeNewsNotificationSeenKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.filter(
      (key): key is string =>
        typeof key === 'string' &&
        parseNewsNotificationItemId(key) !== undefined,
    ),
  )];
}

export function mergeNewsNotificationSeenKeys(
  items: readonly Pick<NewsItem, 'source' | 'id'>[],
  existingKeys: unknown,
  limit = 1_000,
): string[] {
  return [...new Set([
    ...items.map(newsNotificationItemKey),
    ...normalizeNewsNotificationSeenKeys(existingKeys),
  ])].slice(0, Math.max(0, limit));
}

export function filterUnseenNewsNotificationItems<
  T extends Pick<NewsItem, 'source' | 'id'>,
>(
  items: readonly T[],
  seenKeys: unknown,
): T[] {
  const seen = new Set(normalizeNewsNotificationSeenKeys(seenKeys));
  return items.filter((item) => !seen.has(newsNotificationItemKey(item)));
}

function compactNewsNotificationBody(text: string): string {
  const body = text.replace(/\s+/g, ' ').trim();
  return body.length > MAX_NEWS_NOTIFICATION_BODY_LENGTH
    ? `${body.slice(0, MAX_NEWS_NOTIFICATION_BODY_LENGTH - 3)}…`
    : body;
}

export function buildNewsPushNotificationContent(
  items: readonly Pick<NewsItem, 'id' | 'source' | 'text' | 'author' | 'url'>[],
): NewsPushNotificationContent | undefined {
  const first = items[0];
  if (!first) return undefined;
  if (items.length === 1) {
    return {
      title: `${first.source === 'x' ? 'X' : 'Telegram'} · ${first.author.name}`,
      body: compactNewsNotificationBody(first.text),
      itemId: newsNotificationItemKey(first),
      itemUrl: first.url,
    };
  }
  return {
    title: `${items.length} new selected news updates`,
    body: compactNewsNotificationBody(`Latest — ${first.author.name}: ${first.text}`),
    itemId: 'news:summary',
  };
}

/**
 * Parses the stable `<source>:<feed item id>` value carried by news pushes.
 * The feed item ID may itself contain colons, so only the first separator is
 * structural.
 */
export function parseNewsNotificationItemId(value: unknown): NewsNotificationTarget | undefined {
  if (typeof value !== 'string') return undefined;
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) return undefined;

  const source = value.slice(0, separator);
  if (!NEWS_SOURCES.has(source as NewsSource)) return undefined;

  return { itemId: value, source: source as NewsSource };
}

export function normalizeNewsNotificationSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [...ALL_NEWS_NOTIFICATION_SOURCE_IDS];
  return [...new Set(value.filter((id): id is string => typeof id === 'string'))].filter((id) =>
    VALID_SOURCE_IDS.has(id),
  );
}

export function newsNotificationSourceIdForItem(
  item: Pick<NewsItem, 'source' | 'author'>,
): string | undefined {
  const id =
    item.source === 'x'
      ? `x:list:${X_LIST_ID}`
      : item.author.handle
        ? `telegram:${item.author.handle.replace(/^@/, '').toLowerCase()}`
        : undefined;
  return id && VALID_SOURCE_IDS.has(id) ? id : undefined;
}

export function filterNewsItemsByNotificationSources<T extends Pick<NewsItem, 'source' | 'author'>>(
  items: readonly T[],
  sourceIds: readonly string[],
): T[] {
  const allowed = new Set(normalizeNewsNotificationSourceIds(sourceIds));
  return items.filter((item) => {
    const sourceId = newsNotificationSourceIdForItem(item);
    return sourceId ? allowed.has(sourceId) : false;
  });
}
