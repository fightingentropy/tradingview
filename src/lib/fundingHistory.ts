import type { HlFundingPoint } from '@/lib/hyperliquid/info';

export type FundingResolution = '1h' | '8h' | '1d';

export interface AggregatedFundingPoint {
  /** Start of the selected interval, ms epoch. */
  t: number;
  /** Sum of hourly funding rates inside the interval. */
  rate: number;
  /** Running sum from the first visible hourly sample through this interval. */
  cumulative: number;
  samples: number;
}

export const FUNDING_RESOLUTIONS: readonly {
  key: FundingResolution;
  label: string;
  hours: number;
  visibleDays: number;
}[] = [
  { key: '1h', label: '1h', hours: 1, visibleDays: 7 },
  { key: '8h', label: '8h', hours: 8, visibleDays: 30 },
  { key: '1d', label: 'D', hours: 24, visibleDays: 90 },
];

/**
 * Collapse hourly rates into the selected settlement window. Funding compounds as a
 * sequence of cash transfers, so both the interval rate and the cumulative line use
 * sums rather than averages.
 */
export function aggregateFundingPoints(
  points: readonly HlFundingPoint[],
  resolution: FundingResolution,
  now = Date.now(),
): AggregatedFundingPoint[] {
  const config = FUNDING_RESOLUTIONS.find((item) => item.key === resolution)!;
  const cutoff = now - config.visibleDays * 24 * 60 * 60 * 1000;
  const bucketMs = config.hours * 60 * 60 * 1000;
  const buckets = new Map<number, { rate: number; samples: number }>();

  const ordered = points
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        Number.isFinite(point.rate) &&
        point.t >= cutoff &&
        point.t <= now,
    )
    .sort((a, b) => a.t - b.t);

  for (const point of ordered) {
    const t = Math.floor(point.t / bucketMs) * bucketMs;
    const current = buckets.get(t);
    if (current) {
      current.rate += point.rate;
      current.samples += 1;
    } else {
      buckets.set(t, { rate: point.rate, samples: 1 });
    }
  }

  let cumulative = 0;
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, bucket]) => {
      cumulative += bucket.rate;
      return { t, rate: bucket.rate, cumulative, samples: bucket.samples };
    });
}

/** Compact percentage precision that keeps tiny hourly funding rates visible. */
export function formatFundingRatePercent(rate: number): string {
  if (!Number.isFinite(rate)) return '—';
  const percent = rate * 100;
  const abs = Math.abs(percent);
  const decimals = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return `${percent.toFixed(decimals)}%`;
}
