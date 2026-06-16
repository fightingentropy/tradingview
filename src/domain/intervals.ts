import type { CandleInterval } from './types';

export interface IntervalMeta {
  /** UI label. */
  label: string;
  /** Milliseconds per candle. */
  ms: number;
  /** How many candles to seed the chart with. */
  count: number;
}

// `count` is only a fallback fetch size; the date-range selector (domain/ranges)
// drives the real candle counts per range. `ms` is the candle duration, used to
// compute the snapshot start time and to aggregate the Cboe series.
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const INTERVALS: Record<CandleInterval, IntervalMeta> = {
  '1m': { label: '1m', ms: MIN, count: 300 },
  '5m': { label: '5m', ms: 5 * MIN, count: 300 },
  '15m': { label: '15m', ms: 15 * MIN, count: 300 },
  '1h': { label: '1H', ms: HOUR, count: 300 },
  '2h': { label: '2H', ms: 2 * HOUR, count: 280 },
  '4h': { label: '4H', ms: 4 * HOUR, count: 300 },
  '8h': { label: '8H', ms: 8 * HOUR, count: 290 },
  '1d': { label: '1D', ms: DAY, count: 300 },
  '1w': { label: '1W', ms: 7 * DAY, count: 260 },
  '1M': { label: '1M', ms: 30 * DAY, count: 260 },
};
