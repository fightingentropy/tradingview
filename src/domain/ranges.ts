import { INTERVALS } from './intervals';
import type { CandleInterval } from './types';

/**
 * Date ranges (à la TradingView) instead of raw candle intervals. Each range
 * picks a candle resolution and a visible candle count tuned so the candles read
 * thick on a phone (~50–100 bars), not hair-thin.
 */
export type RangeKey = '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | '5Y' | 'ALL';

interface RangeMeta {
  label: string;
  /** Candle resolution for this range. */
  interval: CandleInterval;
  /** Visible candle count (YTD is computed from the calendar — see resolveRange). */
  count: number;
}

const RANGES: Record<RangeKey, RangeMeta> = {
  '1D': { label: '1D', interval: '15m', count: 96 }, //  1 day  @ 15m
  '1W': { label: '1W', interval: '2h', count: 84 }, //   7 days @ 2h
  '1M': { label: '1M', interval: '8h', count: 90 }, //  30 days @ 8h
  '3M': { label: '3M', interval: '1d', count: 90 }, //  90 days @ 1d
  YTD: { label: 'YTD', interval: '1d', count: 0 }, //   Jan 1 → now @ 1d (computed)
  '1Y': { label: '1Y', interval: '1w', count: 52 }, //   1 year @ 1w
  '5Y': { label: '5Y', interval: '1M', count: 60 }, //   5 years @ 1mo
  ALL: { label: 'All', interval: '1M', count: 130 }, // ~10 years @ 1mo
};

export const RANGE_ORDER: RangeKey[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL'];
export const DEFAULT_RANGE: RangeKey = '1D';

export const rangeLabel = (key: RangeKey) => RANGES[key].label;

/**
 * Extra leading candles fetched beyond the visible window so moving averages
 * (notably SMA 200) can be computed from real history instead of vanishing on
 * short ranges. The chart shows only the last `visible` candles.
 */
const SMA_LEAD = 200;

const ytdVisibleDays = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1).getTime();
  return Math.max(2, Math.ceil((now.getTime() - start) / INTERVALS['1d'].ms));
};

/**
 * Resolve a range into the candle resolution, how many candles to *fetch*
 * (window + lead), and how many to actually *show*.
 */
export function resolveRange(key: RangeKey): {
  interval: CandleInterval;
  fetch: number;
  visible: number;
} {
  const meta = RANGES[key];
  const visible = key === 'YTD' ? ytdVisibleDays() : meta.count;
  return { interval: meta.interval, visible, fetch: visible + SMA_LEAD };
}
