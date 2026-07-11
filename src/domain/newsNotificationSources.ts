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
    id: 'telegram:tradexyz_announcements',
    source: 'telegram',
    label: '@tradexyz_announcements',
    detail: 'Telegram channel · login required',
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
