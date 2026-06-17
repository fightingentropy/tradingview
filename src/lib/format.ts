/**
 * Number formatting helpers. Implemented manually (no Intl) to stay consistent
 * across Hermes on iOS/Android, where Intl support is partial.
 */

export function toNum(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Pick a sensible number of decimals for a price when none is provided. */
export function inferDecimals(n: number): number {
  const a = Math.abs(n);
  if (a >= 1000) return 2;
  if (a >= 1) return 2;
  if (a >= 0.1) return 4;
  if (a >= 0.01) return 5;
  if (a > 0) return 6;
  return 2;
}

export function formatPrice(
  value: number | string | null | undefined,
  decimals?: number,
): string {
  const n = toNum(value);
  if (n === null) return '—';
  const d = decimals ?? inferDecimals(n);
  const fixed = Math.abs(n).toFixed(d);
  const [int, frac] = fixed.split('.');
  const body = groupThousands(int) + (frac ? '.' + frac : '');
  return (n < 0 ? '-' : '') + body;
}

/** Blend an instrument's declared decimals with magnitude-based inference for clean output. */
export function priceDecimalsFor(declared: number, price: number | null | undefined): number {
  const n = toNum(price);
  if (n === null) return declared;
  return Math.min(declared, inferDecimals(n));
}

export function formatPercent(value: number | string | null | undefined): string {
  const n = toNum(value);
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Signed absolute price change, e.g. `+2.47`, `-15.44`. Always carries an explicit
 * sign so it can sit next to a signed percent in watchlist rows. Returns '' when
 * the change can't be computed (so the caller can render the percent alone).
 */
export function formatSignedPrice(
  value: number | string | null | undefined,
  decimals?: number,
): string {
  const n = toNum(value);
  if (n === null) return '';
  return (n >= 0 ? '+' : '-') + formatPrice(Math.abs(n), decimals);
}

/**
 * Annualise an hourly perp funding rate (a fraction, e.g. 0.0000458) into a
 * signed APR percentage: +40.13%, -11.20%, 0.00%. Hyperliquid charges funding
 * hourly, so APR = hourlyRate × 24 × 365.
 */
export function formatFundingApr(hourlyRate: number | string | null | undefined): string {
  const n = toNum(hourlyRate);
  if (n === null) return '—';
  const apr = n * 24 * 365 * 100;
  const sign = apr > 0 ? '+' : ''; // toFixed already carries the '-' for negatives
  return `${sign}${apr.toFixed(2)}%`;
}

/** Granularity of a chart's time axis, chosen per date range. */
export type AxisTickKind = 'time' | 'day' | 'monthday' | 'month' | 'year';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));

/**
 * Format a candle's open time (ms epoch) for the chart's x-axis, in the device's
 * local timezone. The granularity matches the range: intraday shows clock time,
 * a week shows day-of-month, longer ranges step up to month then year — the way
 * the TradingView app labels its time axis. Manual (no Intl) for Hermes parity.
 */
export function formatChartAxisLabel(t: number, kind: AxisTickKind): string {
  const d = new Date(t);
  switch (kind) {
    case 'time':
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    case 'day':
      return String(d.getDate());
    case 'monthday':
      return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    case 'month':
      return MONTHS[d.getMonth()];
    case 'year':
      return String(d.getFullYear());
  }
}

/** Compact notation for volumes / market caps: 1.2K, 3.4M, 5.6B, 1.2T. */
export function formatCompact(value: number | string | null | undefined): string {
  const n = toNum(value);
  if (n === null) return '—';
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [div, suffix] of units) {
    if (abs >= div) {
      const scaled = (n / div).toFixed(2).replace(/\.?0+$/, '');
      return scaled + suffix;
    }
  }
  return formatPrice(n, abs >= 1 ? 2 : inferDecimals(n));
}
