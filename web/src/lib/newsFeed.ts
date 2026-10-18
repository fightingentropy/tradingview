import type { NewsFeedNotice, NewsFeedPage, NewsItem, NewsMedia, NewsSource } from '../../../src/domain/news';

export type { NewsItem, NewsSourceFilter } from '../../../src/domain/news';

export const NEWS_SOURCE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'x', label: 'X' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'digg', label: 'Digg' },
  { key: 'paste', label: 'Paste' },
] as const;

const sources = new Set<string>(['x', 'telegram', 'digg', 'paste']);
const isSource = (value: unknown): value is NewsSource => typeof value === 'string' && sources.has(value);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { return new URL(value).protocol === 'https:' ? value : undefined; } catch { return undefined; }
}

export function parseNewsFeed(value: unknown): NewsFeedPage {
  const payload = record(value);
  if (!payload || !Array.isArray(payload.items) || typeof payload.updatedAt !== 'string' || !Number.isFinite(Date.parse(payload.updatedAt))) {
    throw new Error('Invalid news feed response');
  }
  const seen = new Set<string>();
  const items = payload.items.flatMap((entry): NewsItem[] => {
    const item = record(entry);
    const author = record(item?.author);
    if (!item || !author || typeof item.id !== 'string' || !item.id.trim() || !isSource(item.source) ||
      typeof item.text !== 'string' || !item.text.trim() || typeof author.name !== 'string' || !author.name.trim() ||
      typeof item.publishedAt !== 'string' || !Number.isFinite(Date.parse(item.publishedAt))) return [];
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const media = Array.isArray(item.media) ? item.media.flatMap((entry): NewsMedia[] => {
      const preview = record(entry);
      const previewUrl = httpsUrl(preview?.previewUrl);
      return previewUrl && (preview?.type === 'image' || preview?.type === 'video') ? [{ type: preview.type, previewUrl }] : [];
    }) : [];
    return [{
      id: item.id, source: item.source, text: item.text, publishedAt: item.publishedAt,
      author: { name: author.name, handle: typeof author.handle === 'string' ? author.handle : undefined, avatarUrl: httpsUrl(author.avatarUrl) },
      url: httpsUrl(item.url), media,
    }];
  });
  const notices = Array.isArray(payload.notices) ? payload.notices.flatMap((entry): NewsFeedNotice[] => {
    const notice = record(entry);
    return notice && typeof notice.id === 'string' && isSource(notice.source) && typeof notice.message === 'string'
      ? [{ id: notice.id, source: notice.source, message: notice.message }] : [];
  }) : [];
  return { items, notices, updatedAt: payload.updatedAt };
}

export async function loadNewsFeed(signal: AbortSignal): Promise<NewsFeedPage> {
  // The site's own Worker reads the relay snapshot, so no relay token ships to browsers.
  const response = await fetch('/api/news?source=all&limit=200', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`News service returned ${response.status}`);
  return parseNewsFeed(await response.json());
}

export function formatNewsTime(timestamp: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
