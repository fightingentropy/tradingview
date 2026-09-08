import type { Candle } from '../domain/types';

export function isValidCandle(candle: Candle): boolean {
  return [candle.t, candle.o, candle.h, candle.l, candle.c, candle.v].every(Number.isFinite) &&
    candle.t > 0 && candle.l >= 0 && candle.v >= 0 &&
    candle.h >= Math.max(candle.o, candle.c, candle.l) && candle.l <= Math.min(candle.o, candle.c);
}

/** Later observations win per bucket, including repairs to historical bars. */
export function mergeCandleHistory(base: Candle[], updates: Candle[], count: number): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of [...base, ...updates]) if (isValidCandle(candle)) byTime.set(candle.t, candle);
  return [...byTime.values()].sort((a, b) => a.t - b.t).slice(-Math.max(1, count));
}

export function candleCreatesGap(last: Candle | undefined, next: Candle, intervalMs: number): boolean {
  return !!last && next.t - last.t > intervalMs * 1.1;
}
