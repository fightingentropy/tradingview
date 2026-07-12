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

export interface NewsFeedPage {
  items: NewsItem[];
  notices?: NewsFeedNotice[];
  nextCursor?: string;
  updatedAt: string;
}

export interface NewsFeedNotice {
  id: string;
  source: NewsSource;
  message: string;
}
