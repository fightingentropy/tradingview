export type NewsSource = 'x' | 'telegram' | 'digg' | 'paste';
export type NewsSourceFilter = 'all' | NewsSource;

export const DEFAULT_NEWS_FEED_LIMIT = 40;
export const RELATED_NEWS_FEED_LIMIT = 200;

export interface NewsAuthor {
  name: string;
  /** X @handle, Telegram channel handle, or source slug, without a required leading @. */
  handle?: string;
  avatarUrl?: string;
}

export interface NewsMedia {
  type: 'image' | 'video';
  /** A display-safe HTTPS thumbnail supplied by the feed service. */
  previewUrl: string;
}

export interface NewsItem {
  /** Stable across refreshes; prefixing with the source is recommended. */
  id: string;
  source: NewsSource;
  author: NewsAuthor;
  text: string;
  publishedAt: string;
  /** Canonical source URL. */
  url?: string;
  media?: NewsMedia[];
}

export type NewsPulseLabel = 'risk-on' | 'risk-off' | 'mixed' | 'calm' | 'event-driven';
export type NewsPulseChange = 'new' | 'changed' | 'unchanged';
export type NewsConfidence = 'confirmed' | 'reported' | 'disputed' | 'speculative';
export const NEWS_PULSE_ASSETS = ['BTC', 'ETH', 'Crypto', 'Nasdaq', 'S&P 500', 'Oil', 'Gold', 'US yields', 'Dollar'] as const;
export type NewsPulseAsset = typeof NEWS_PULSE_ASSETS[number];
export type NewsPulseDirection = 'up' | 'down' | 'mixed';

/** One price-strip entry at pulse time. `change` is the 24-hour move: percent, or basis points for a yield. */
export interface NewsPulseMarket {
  key: string;
  label: string;
  price: number;
  change: number;
  unit: 'pct' | 'bp';
}

export function formatPulseMarketPrice(market: NewsPulseMarket): string {
  if (market.unit === 'bp') return `${market.price.toFixed(2)}%`;
  const digits = market.price >= 1_000 ? 0 : 2;
  return market.price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPulseMarketChange(market: NewsPulseMarket): string {
  const sign = market.change > 0 ? '+' : market.change < 0 ? '−' : '';
  const size = Math.abs(market.change);
  return market.unit === 'bp' ? `${sign}${Math.round(size)}bp` : `${sign}${size.toFixed(1)}%`;
}

export const pulseDirectionArrow: Record<NewsPulseDirection, string> = { up: '↑', down: '↓', mixed: '↕' };

/** Shared by the iPhone and website parsers: drops malformed strip entries instead of failing the pulse. */
export function parsePulseMarkets(value: unknown): NewsPulseMarket[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): NewsPulseMarket[] => {
    const market = entry !== null && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const { key, label, price, change, unit } = market;
    if (typeof key !== 'string' || typeof label !== 'string' || !label.trim()) return [];
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return [];
    if (typeof change !== 'number' || !Number.isFinite(change) || (unit !== 'pct' && unit !== 'bp')) return [];
    return [{ key, label: label.trim(), price, change, unit }];
  }).slice(0, 8);
}

const pulseAssets = new Set<string>(NEWS_PULSE_ASSETS);
const pulseDirections = new Set<string>(['up', 'down', 'mixed']);

export function parsePulseAssets(value: unknown): { asset: NewsPulseAsset; direction: NewsPulseDirection }[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const { asset, direction } = (entry !== null && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    if (typeof asset !== 'string' || !pulseAssets.has(asset) || seen.has(asset)) return [];
    if (typeof direction !== 'string' || !pulseDirections.has(direction)) return [];
    seen.add(asset);
    return [{ asset: asset as NewsPulseAsset, direction: direction as NewsPulseDirection }];
  }).slice(0, 3);
}

export interface NewsSummarySourceReference {
  itemKey: string;
  source: NewsSource;
  title: string;
  author: string;
  publishedAt: string;
  url: string;
}

export interface NewsExecutiveSummaryBullet {
  headline: string;
  summary: string;
  /** Version 2 only; version 3 folds the market effect into summary. */
  marketImpact?: string;
  /** Version 4: the markets the development most likely moves, and which way. */
  assets?: { asset: NewsPulseAsset; direction: NewsPulseDirection }[];
  details: string;
  change: NewsPulseChange;
  confidence: NewsConfidence;
  sources: NewsSummarySourceReference[];
}

export interface NewsExecutiveSummary {
  formatVersion: number;
  id: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  headline: string;
  overview: string;
  /** `summary` is version 2 only; version 3 keeps just the mood label. */
  pulse: { label: NewsPulseLabel; summary?: string };
  bullets: NewsExecutiveSummaryBullet[];
  secondarySignals: string[];
  watchNext: string[];
  noiseSummary: string;
  /** Version 4: what the curated traders lean into or fade; opinion, not fact. */
  feedSentiment?: string;
  /** Version 4: the price strip at generation time. */
  markets?: NewsPulseMarket[];
  marketsAt?: string;
  analyzedItems: number;
  sourceCounts: Record<NewsSource, number>;
  model: string;
  reasoningEffort: string;
}

export interface NewsFeedPage {
  items: NewsItem[];
  notices?: NewsFeedNotice[];
  executiveSummary?: NewsExecutiveSummary;
  nextCursor?: string;
  updatedAt: string;
}

export interface NewsFeedNotice {
  id: string;
  source: NewsSource;
  message: string;
}
