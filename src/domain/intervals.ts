import type { CandleInterval } from './types';

export interface IntervalMeta {
  /** UI label. */
  label: string;
  /** Milliseconds per candle. */
  ms: number;
  /** How many candles to seed the chart with. */
  count: number;
}

// Counts are seeded generously (≥300 where history allows) so the SMA 200
// overlay has enough bars to draw a meaningful line, not just a stub.
export const INTERVALS: Record<CandleInterval, IntervalMeta> = {
  '1m': { label: '1m', ms: 60_000, count: 300 },
  '5m': { label: '5m', ms: 5 * 60_000, count: 300 },
  '15m': { label: '15m', ms: 15 * 60_000, count: 300 },
  '1h': { label: '1H', ms: 60 * 60_000, count: 300 },
  '4h': { label: '4H', ms: 4 * 60 * 60_000, count: 300 },
  '1d': { label: '1D', ms: 24 * 60 * 60_000, count: 300 },
  '1w': { label: '1W', ms: 7 * 24 * 60 * 60_000, count: 260 },
};

export const INTERVAL_ORDER: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export const DEFAULT_INTERVAL: CandleInterval = '1h';
