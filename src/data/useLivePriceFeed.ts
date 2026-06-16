import { useEffect, useMemo } from 'react';

import type { Instrument, Source } from '@/domain/types';
import { getProvider } from '@/providers/registry';
import type { Unsubscribe } from '@/providers/types';
import { useLivePrices } from '@/store/livePrices';

/**
 * Opens live price streams for the given instruments, grouped by source, and
 * writes ticks into the live-price store. Re-subscribes only when the set of
 * watched coin keys actually changes.
 */
export function useLivePriceFeed(instruments: Instrument[]) {
  const applyTicks = useLivePrices((s) => s.applyTicks);

  // Stable signature so effect re-runs only when the watched set changes.
  const signature = useMemo(
    () =>
      instruments
        .map((i) => `${i.source}:${i.coinKey}`)
        .sort()
        .join('|'),
    [instruments],
  );

  useEffect(() => {
    if (!signature) return;
    const bySource = new Map<Source, string[]>();
    for (const i of instruments) {
      const list = bySource.get(i.source) ?? [];
      list.push(i.coinKey);
      bySource.set(i.source, list);
    }

    const unsubs: Unsubscribe[] = [];
    bySource.forEach((coinKeys, source) => {
      const provider = getProvider(source);
      if (provider?.subscribePrices) {
        unsubs.push(provider.subscribePrices(coinKeys, applyTicks));
      }
    });
    return () => unsubs.forEach((u) => u());
    // `instruments` is intentionally excluded; `signature` captures meaningful changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, applyTicks]);
}
