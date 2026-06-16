import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';

import { mmkvStorage } from '@/lib/mmkv';

/** How long a persisted cache entry stays usable on a cold start. */
export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24; // 24h

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // gcTime must be >= the persister's maxAge, otherwise restored queries get
      // garbage-collected before they're observed and never show on cold start.
      gcTime: PERSIST_MAX_AGE,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Writes the React Query cache (markets snapshot + candles) to MMKV so a cold
 * start can paint the last-known tickers instantly, then refresh in the
 * background. MMKV is synchronous, so restore happens within a tick.
 */
export const queryPersister = createSyncStoragePersister({
  storage: mmkvStorage,
  key: 'tradingview.rq-cache',
  throttleTime: 1000,
});
