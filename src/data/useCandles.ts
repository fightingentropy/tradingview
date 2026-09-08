import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { Candle, CandleInterval, Instrument } from '@/domain/types';
import { INTERVALS } from '@/domain/intervals';
import { candleCreatesGap, isValidCandle, mergeCandleHistory } from '@/lib/candleHistory';
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
  const [readError, setReadError] = useState<{ key: string; message: string } | null>(null);
  // Keep ticks that arrive during a REST read; the response must not roll them back.
  const contextKey = `${instrument?.id ?? ''}:${interval}:${count}`;
  const activeKey = useRef<string | null>(contextKey);
  const requestRevision = useRef(0);
  const acceptedSnapshotStart = useRef(0);
  const recent = useRef(new Map<number, { candle: Candle; receivedAt: number }>());
  useEffect(() => {
    activeKey.current = contextKey;
    recent.current.clear();
    acceptedSnapshotStart.current = 0;
    return () => { activeKey.current = null; };
  }, [contextKey]);

  const query = useQuery<Candle[]>({
    queryKey: instrument ? queryKeys.candles(instrument.id, interval, count) : ['candles', 'none'],
    queryFn: async () => {
      const startedAt = Date.now();
      const revision = ++requestRevision.current;
      try {
        const snapshot = await provider!.getCandles(instrument!, interval, count);
        const isCurrent = activeKey.current === contextKey && revision === requestRevision.current;
        const duringFetch = isCurrent ? [...recent.current.values()]
          .filter((update) => update.receivedAt >= startedAt).map((update) => update.candle) : [];
        const history = mergeCandleHistory(snapshot, duringFetch, count);
        if (history.length === 0) throw new Error('No chart data available for this range.');
        if (isCurrent) {
          acceptedSnapshotStart.current = startedAt;
          setReadError(null);
        }
        return history;
      } catch (error) {
        if (activeKey.current === contextKey && revision === requestRevision.current) {
          setReadError({ key: contextKey, message: error instanceof Error ? error.message : 'Chart history unavailable.' });
        }
        throw error;
      }
    },
    enabled: !!instrument && !!provider,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!instrument || !provider) return;
    const key = queryKeys.candles(instrument.id, interval, count);
    const refresh = () => { void queryClient.refetchQueries({ queryKey: key, exact: true, type: 'active' }, { cancelRefetch: false }); };
    const unsubscribe = provider.subscribeConnection?.((status) => {
      if (status === 'connected') refresh();
    });
    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active') refresh();
    });
    return () => { unsubscribe?.(); appState.remove(); };
  }, [instrument, provider, interval, count]);

  useEffect(() => {
    if (!instrument || !provider?.subscribeCandles) return;
    const key = queryKeys.candles(instrument.id, interval, count);

    // Coalesce the sub-second candle feed to ~4 Hz: the websocket pushes a frame
    // per tick, but each push re-renders the chart (recomputing SMA over the full
    // series + rebuilding every Skia path). Hold the latest candle and flush it at
    // most once per `THROTTLE_MS`, with a trailing flush so the final state lands.
    const THROTTLE_MS = 250;
    let pending: { candle: Candle; receivedAt: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (timer != null) clearTimeout(timer);
      timer = null;
      const update = pending;
      pending = null;
      // A completed REST backfill is newer than a buffered tick received before
      // that request began. Do not let the trailing timer undo the correction.
      if (!update || update.receivedAt < acceptedSnapshotStart.current) return;
      const c = update.candle;
      queryClient.setQueryData<Candle[]>(key, (old) => {
        if (!old || old.length === 0) return old;
        const last = old[old.length - 1];
        if (c.t === last.t) {
          // Same bucket: if nothing actually moved, return the SAME array reference so
          // React Query notifies no subscribers — a flat/idle market pushes identical
          // frames every tick, and reallocating here would relayout the whole chart
          // (SMA over the full series + every Skia path) ~4×/s for no visible change.
          if (c.o === last.o && c.h === last.h && c.l === last.l && c.c === last.c && c.v === last.v)
            return old;
          const next = old.slice();
          next[next.length - 1] = c;
          return next;
        }
        // Cap to the fetched count, not a hardcoded 499 — on long ranges the lead
        // (SMA 200 + pan history) exceeds 499, and trimming it would silently drop
        // the moving-average history off the left edge.
        return mergeCandleHistory(old, [c], count);
      });
    };

    const unsub = provider.subscribeCandles(instrument, interval, (c: Candle) => {
      if (!isValidCandle(c)) return;
      const update = { candle: c, receivedAt: Date.now() };
      recent.current.set(c.t, update);
      while (recent.current.size > count) recent.current.delete(recent.current.keys().next().value!);
      const old = queryClient.getQueryData<Candle[]>(key);
      if (interval !== '1M' && candleCreatesGap(old?.[old.length - 1], c, INTERVALS[interval].ms)) {
        void queryClient.refetchQueries({ queryKey: key, exact: true, type: 'active' }, { cancelRefetch: false });
      }
      // On a bucket rollover, flush the just-closed bar with its final value before
      // it's replaced — otherwise that bar freezes up to THROTTLE_MS short of its
      // true close and never self-corrects (it's now historical). Rollovers happen
      // once per interval, so this doesn't defeat the per-tick throttle.
      if (pending && c.t !== pending.candle.t) flush();
      // Always reflect the latest candle state; the timer just paces the writes.
      pending = update;
      if (timer == null) timer = setTimeout(flush, THROTTLE_MS);
    });
    return () => {
      if (timer != null) clearTimeout(timer);
      unsub?.();
    };
  }, [instrument, provider, interval, count]);

  return { ...query, historyError: readError?.key === contextKey ? readError.message : query.isError ? query.error.message : null };
}
