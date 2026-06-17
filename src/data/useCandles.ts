import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { Candle, CandleInterval, Instrument } from '@/domain/types';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { getProvider } from '@/providers/registry';

/** Historical candles seeded from REST and kept live via the websocket candle feed. */
export function useCandles(
  instrument: Instrument | undefined,
  interval: CandleInterval,
  count: number,
) {
  const provider = instrument ? getProvider(instrument.source) : undefined;

  const query = useQuery<Candle[]>({
    queryKey: instrument ? queryKeys.candles(instrument.id, interval, count) : ['candles', 'none'],
    queryFn: () => provider!.getCandles(instrument!, interval, count),
    enabled: !!instrument && !!provider,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!instrument || !provider?.subscribeCandles) return;
    const key = queryKeys.candles(instrument.id, interval, count);

    // Coalesce the sub-second candle feed to ~4 Hz: the websocket pushes a frame
    // per tick, but each push re-renders the chart (recomputing SMA over the full
    // series + rebuilding every Skia path). Hold the latest candle and flush it at
    // most once per `THROTTLE_MS`, with a trailing flush so the final state lands.
    const THROTTLE_MS = 250;
    let pending: Candle | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const c = pending;
      pending = null;
      if (!c) return;
      queryClient.setQueryData<Candle[]>(key, (old) => {
        if (!old || old.length === 0) return old;
        const last = old[old.length - 1];
        if (c.t === last.t) {
          const next = old.slice();
          next[next.length - 1] = c;
          return next;
        }
        // Cap to the fetched count, not a hardcoded 499 — on long ranges the lead
        // (SMA 200 + pan history) exceeds 499, and trimming it would silently drop
        // the moving-average history off the left edge.
        if (c.t > last.t) return [...old.slice(-(count - 1)), c];
        return old;
      });
    };

    const unsub = provider.subscribeCandles(instrument, interval, (c: Candle) => {
      // On a bucket rollover, flush the just-closed bar with its final value before
      // it's replaced — otherwise that bar freezes up to THROTTLE_MS short of its
      // true close and never self-corrects (it's now historical). Rollovers happen
      // once per interval, so this doesn't defeat the per-tick throttle.
      if (pending && c.t !== pending.t) flush();
      // Always reflect the latest candle state; the timer just paces the writes.
      pending = c;
      if (timer == null) timer = setTimeout(flush, THROTTLE_MS);
    });
    return () => {
      if (timer != null) clearTimeout(timer);
      unsub?.();
    };
  }, [instrument, provider, interval, count]);

  return query;
}
