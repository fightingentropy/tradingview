import type { CandleInterval } from '@/domain/types';
import type { HlNetwork } from '@/lib/hyperliquid/info';
import type { HlAccountMode } from '@/lib/accountRisk';
import { DEFAULT_NEWS_FEED_LIMIT, type NewsSourceFilter } from '@/domain/news';

/** Centralized query-key factory so cache reads/writes never drift. */
export const queryKeys = {
  instruments: () => ['instruments'] as const,
  newsFeed: (source: NewsSourceFilter, limit = DEFAULT_NEWS_FEED_LIMIT) => ['news-feed', source, limit] as const,
  economicCalendar: (dateKey: string) => ['economic-calendar', dateKey] as const,
  economicCalendarRange: (fromDateKey: string, toDateKey: string) =>
    ['economic-calendar-range', fromDateKey, toDateKey] as const,
  candles: (id: string, interval: CandleInterval, count: number) =>
    ['candles', id, interval, count] as const,
  // Hyperliquid account state. The first segment is a stable prefix so invalidating
  // `['hl-account']` after an order matches every network/account variant.
  hlAccount: (network: HlNetwork, account: string) => ['hl-account', network, account] as const,
  hlAccountOverview: (network: HlNetwork, account: string, mode: HlAccountMode) =>
    ['hl-account', network, account, 'overview', mode] as const,
  /** Prefix that invalidation targets so it matches any {@link hlAccount} key. */
  hlAccountPrefix: () => ['hl-account'] as const,
  hlOpenOrders: (network: HlNetwork, account: string) => ['hl-open-orders', network, account] as const,
  hlOpenOrdersPrefix: () => ['hl-open-orders'] as const,
  hlHistoricalOrders: (network: HlNetwork, account: string) =>
    ['hl-historical-orders', network, account] as const,
  hlFills: (network: HlNetwork, account: string) => ['hl-fills', network, account] as const,
  hlFillsPrefix: () => ['hl-fills'] as const,
  hlPortfolio: (network: HlNetwork, account: string) => ['hl-portfolio', network, account] as const,
  hlAccountFees: (network: HlNetwork, account: string) => ['hl-account-fees', network, account] as const,
  hlEarnBalance: (network: HlNetwork, account: string) => ['hl-earn-balance', network, account] as const,
  hlAccountActivity: (network: HlNetwork, account: string) => ['hl-account-activity', network, account] as const,
  hlFundingHistory: (network: HlNetwork, coin: string) =>
    ['hl-funding-history', network, coin] as const,
  hlUserFunding: (network: HlNetwork, account: string) =>
    ['hl-user-funding', network, account] as const,
  hlBorrowLendInterest: (network: HlNetwork, account: string) =>
    ['hl-borrow-lend-interest', network, account] as const,
  hlMeta: (network: HlNetwork) => ['hl-meta', network] as const,
  hlLegalCheck: (network: HlNetwork, user: string) =>
    ['hl-legal-check', network, user] as const,
};
