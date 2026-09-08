import type { Instrument, Quote } from '../domain/types';

export type WatchlistSortKey = 'manual' | 'symbol' | 'price' | 'change';
export type WatchlistSortDirection = 'asc' | 'desc';

/** Sorting changes the visible rows only; the caller's saved manual order is untouched. */
export function sortWatchlistView(
  instruments: readonly Instrument[],
  quotes: Readonly<Record<string, Quote>>,
  key: WatchlistSortKey,
  direction: WatchlistSortDirection,
): Instrument[] {
  if (key === 'manual') return [...instruments];
  return [...instruments].sort((left, right) => {
    if (key === 'symbol') {
      const comparison = left.symbol.localeCompare(right.symbol, undefined, { sensitivity: 'base' });
      return direction === 'asc' ? comparison : -comparison;
    }
    const a = key === 'price' ? quotes[left.id]?.last : quotes[left.id]?.change24hPct;
    const b = key === 'price' ? quotes[right.id]?.last : quotes[right.id]?.change24hPct;
    const aMissing = a == null || !Number.isFinite(a);
    const bMissing = b == null || !Number.isFinite(b);
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return direction === 'asc' ? a! - b! : b! - a!;
  });
}

/** Restore only removed symbols, retaining any subsequent additions or manual edits. */
export function restoreRemovedSymbols(
  current: readonly string[],
  previous: readonly string[],
  removed: readonly string[],
): string[] {
  const restored = [...current];
  const removedSet = new Set(removed);
  for (const [index, id] of previous.entries()) {
    if (!removedSet.has(id) || restored.includes(id)) continue;
    const nextAnchor = previous.slice(index + 1).find((candidate) => restored.includes(candidate));
    const before = nextAnchor === undefined ? -1 : restored.indexOf(nextAnchor);
    const previousAnchor = previous.slice(0, index).reverse().find((candidate) => restored.includes(candidate));
    const after = previousAnchor === undefined ? -1 : restored.indexOf(previousAnchor);
    restored.splice(before >= 0 ? before : after + 1, 0, id);
  }
  return restored;
}
