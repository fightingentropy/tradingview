import type { CandleInterval } from '@/domain/types';

/** Centralized query-key factory so cache reads/writes never drift. */
export const queryKeys = {
  instruments: () => ['instruments'] as const,
  quotes: (ids: string[]) => ['quotes', [...ids].sort().join(',')] as const,
  candles: (id: string, interval: CandleInterval, count: number) =>
    ['candles', id, interval, count] as const,
};
