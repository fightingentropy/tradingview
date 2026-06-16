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
