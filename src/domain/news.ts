export type NewsSource = 'x' | 'telegram' | 'digg' | 'paste';
export type NewsSourceFilter = 'all' | NewsSource;

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
  whyItMatters: string;
  details: string;
  sources: NewsSummarySourceReference[];
}

export interface NewsExecutiveSummary {
  id: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  headline: string;
  overview: string;
  pulse: { label: NewsPulseLabel; summary: string };
  bullets: NewsExecutiveSummaryBullet[];
  watchNext: string[];
  noiseSummary: string;
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
