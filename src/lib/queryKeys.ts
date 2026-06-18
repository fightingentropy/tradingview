import type { CandleInterval } from '@/domain/types';
import type { HlNetwork } from '@/lib/hyperliquid/info';

/** Centralized query-key factory so cache reads/writes never drift. */
export const queryKeys = {
  instruments: () => ['instruments'] as const,
  candles: (id: string, interval: CandleInterval, count: number) =>
    ['candles', id, interval, count] as const,
  // Hyperliquid account state. The first segment is a stable prefix so invalidating
  // `['hl-account']` after an order matches every network/account variant.
  hlAccount: (network: HlNetwork, account: string) => ['hl-account', network, account] as const,
  /** Prefix that invalidation targets so it matches any {@link hlAccount} key. */
  hlAccountPrefix: () => ['hl-account'] as const,
  hlOpenOrders: (network: HlNetwork, account: string) => ['hl-open-orders', network, account] as const,
  hlOpenOrdersPrefix: () => ['hl-open-orders'] as const,
  hlFills: (network: HlNetwork, account: string) => ['hl-fills', network, account] as const,
  hlFillsPrefix: () => ['hl-fills'] as const,
  hlMeta: (network: HlNetwork) => ['hl-meta', network] as const,
};
