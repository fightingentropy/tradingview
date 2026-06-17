import type { AxisTickKind } from '@/lib/format';
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
  /** How the x-axis labels its ticks for this range. */
  axis: AxisTickKind;
}

const RANGES: Record<RangeKey, RangeMeta> = {
  // 64 × 15m ≈ 16h: the TradingView app's "1D" shows the recent intraday session,
  // not a packed 24h — fewer, thicker candles with room to breathe.
  '1D': { label: '1D', interval: '15m', count: 64, axis: 'time' }, //  ~16h @ 15m
  '1W': { label: '1W', interval: '2h', count: 84, axis: 'day' }, //    7 days @ 2h
  '1M': { label: '1M', interval: '8h', count: 90, axis: 'monthday' }, // 30 days @ 8h
  '3M': { label: '3M', interval: '1d', count: 90, axis: 'monthday' }, // 90 days @ 1d
  YTD: { label: 'YTD', interval: '1d', count: 0, axis: 'month' }, //   Jan 1 → now @ 1d (computed)
  '1Y': { label: '1Y', interval: '1w', count: 52, axis: 'month' }, //   1 year @ 1w
  '5Y': { label: '5Y', interval: '1M', count: 60, axis: 'year' }, //    5 years @ 1mo
  ALL: { label: 'All', interval: '1M', count: 130, axis: 'year' }, //  ~10 years @ 1mo
};

export const RANGE_ORDER: RangeKey[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL'];
export const DEFAULT_RANGE: RangeKey = '1D';

export const rangeLabel = (key: RangeKey) => RANGES[key].label;

/**
 * Extra leading candles fetched beyond the visible window so moving averages
 * (notably SMA 200) can be computed from real history instead of vanishing on
 * short ranges. These sit before the rendered window, off the left edge.
 */
const SMA_LEAD = 200;

/**
 * Older candles rendered to the left of the visible window so you can drag the
 * chart back through history instead of hitting empty space. They're drawn (and
 * have valid moving averages, since SMA_LEAD precedes them) but start off-screen;
 * `viewport` scopes the initial view to just the last `visible` candles.
 */
const PAN_HISTORY = 150;

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
  /** Candles initially in view (the viewport window). */
  visible: number;
  /** Candles actually rendered (visible + pannable history). */
  render: number;
  axis: AxisTickKind;
} {
  const meta = RANGES[key];
  const visible = key === 'YTD' ? ytdVisibleDays() : meta.count;
  const render = visible + PAN_HISTORY;
  return { interval: meta.interval, visible, render, fetch: render + SMA_LEAD, axis: meta.axis };
}
