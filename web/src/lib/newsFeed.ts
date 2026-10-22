import type {
  NewsConfidence, NewsExecutiveSummary, NewsExecutiveSummaryBullet, NewsFeedNotice, NewsFeedPage, NewsItem, NewsMedia,
  NewsPulseChange, NewsPulseLabel, NewsSource, NewsSummarySourceReference,
} from '../../../src/domain/news';
import { parsePulseAssets, parsePulseMarkets } from '../../../src/domain/news';

export type { NewsExecutiveSummary, NewsItem, NewsSourceFilter } from '../../../src/domain/news';

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

const pulseLabels = new Set<string>(['risk-on', 'risk-off', 'mixed', 'calm', 'event-driven']);
const changeLabels = new Set<string>(['new', 'changed', 'unchanged']);
const confidenceLabels = new Set<string>(['confirmed', 'reported', 'disputed', 'speculative']);
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const isDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const texts = (value: unknown, limit: number): string[] => Array.isArray(value) ? value.flatMap(entry => text(entry) ?? []).slice(0, limit) : [];

function parseSummarySources(value: unknown): NewsSummarySourceReference[] {
  const publishers = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap((entry): NewsSummarySourceReference[] => {
    const source = record(entry);
    const author = text(source?.author);
    const url = httpsUrl(source?.url);
    if (!source || !author || !url || typeof source.itemKey !== 'string' || !isSource(source.source) || !isDate(source.publishedAt)) return [];
    // One link per publisher, as on the iPhone.
    const publisher = author.toLowerCase().replace(/[^a-z0-9]/g, '') || source.itemKey;
    if (publishers.has(publisher)) return [];
    publishers.add(publisher);
    return [{ itemKey: source.itemKey, source: source.source, title: text(source.title) ?? author, author, publishedAt: source.publishedAt, url }];
  }).slice(0, 4);
}

/** The Claude pulse is optional: a missing, malformed or outdated one is dropped, never allowed to break the feed. */
export function parseExecutiveSummary(value: unknown): NewsExecutiveSummary | undefined {
  const summary = record(value);
  const pulse = record(summary?.pulse);
  const id = text(summary?.id), headline = text(summary?.headline), overview = text(summary?.overview);
  if (!summary || !pulse || !id || !headline || !overview || typeof pulse.label !== 'string' ||
    !pulseLabels.has(pulse.label) || !isDate(summary.generatedAt) || !Array.isArray(summary.bullets)) return undefined;
  const bullets = summary.bullets.flatMap((entry): NewsExecutiveSummaryBullet[] => {
    const bullet = record(entry);
    const sources = parseSummarySources(bullet?.sources);
    const bulletHeadline = text(bullet?.headline), bulletSummary = text(bullet?.summary), details = text(bullet?.details);
    // Versions 1 and 2 carried a separate market effect (`whyItMatters`, then `marketImpact`); version 3 folds it into the summary.
    const marketImpact = text(bullet?.marketImpact) ?? text(bullet?.whyItMatters);
    if (!bullet || !bulletHeadline || !bulletSummary || !details || !sources.length) return [];
    const assets = parsePulseAssets(bullet.assets);
    return [{
      headline: bulletHeadline, summary: bulletSummary, ...(marketImpact ? { marketImpact } : {}), ...(assets.length ? { assets } : {}), details, sources,
      change: typeof bullet.change === 'string' && changeLabels.has(bullet.change) ? bullet.change as NewsPulseChange : 'unchanged',
      confidence: typeof bullet.confidence === 'string' && confidenceLabels.has(bullet.confidence) ? bullet.confidence as NewsConfidence : 'reported',
    }];
  }).slice(0, 3);
  if (!bullets.length) return undefined;
  const sourceCounts = record(summary.sourceCounts);
  return {
    formatVersion: Math.max(1, count(summary.formatVersion)),
    id,
    generatedAt: summary.generatedAt,
    windowStart: isDate(summary.windowStart) ? summary.windowStart : summary.generatedAt,
    windowEnd: isDate(summary.windowEnd) ? summary.windowEnd : summary.generatedAt,
    headline,
    overview,
    pulse: { label: pulse.label as NewsPulseLabel, ...(text(pulse.summary) ? { summary: text(pulse.summary) } : {}) },
    bullets,
    secondarySignals: texts(summary.secondarySignals, 3),
    watchNext: texts(summary.watchNext, 2),
    noiseSummary: text(summary.noiseSummary) ?? '',
    ...(text(summary.feedSentiment) ? { feedSentiment: text(summary.feedSentiment) } : {}),
    ...(parsePulseMarkets(summary.markets).length && isDate(summary.marketsAt)
      ? { markets: parsePulseMarkets(summary.markets), marketsAt: summary.marketsAt } : {}),
    analyzedItems: count(summary.analyzedItems),
    sourceCounts: { x: count(sourceCounts?.x), telegram: count(sourceCounts?.telegram), digg: count(sourceCounts?.digg), paste: count(sourceCounts?.paste) },
    model: text(summary.model) ?? '',
    reasoningEffort: text(summary.reasoningEffort) ?? '',
  };
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
  return { items, notices, executiveSummary: parseExecutiveSummary(payload.executiveSummary), updatedAt: payload.updatedAt };
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

const londonDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const londonClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const londonDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });

/** London wall-clock time, with the date once the pulse is from an earlier London day. */
export function formatPulseTime(timestamp: string, now: number): string {
  const date = new Date(timestamp);
  const clock = londonClock.format(date);
  return londonDay.format(date) === londonDay.format(now) ? clock : `${londonDate.format(date)}, ${clock}`;
}
