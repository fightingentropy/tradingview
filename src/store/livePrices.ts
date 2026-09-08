import { create } from 'zustand';
import { useEffect } from 'react';

import type { Instrument, Quote, Source } from '@/domain/types';
import { marketPriceState, type ObservedPrice } from '@/lib/marketFreshness';
import type { FeedConnectionStatus, PriceTick } from '@/providers/types';

interface LivePricesState {
  /** Latest streamed last-price keyed by provider-native coin key. */
  prices: Record<string, number>;
  observations: Record<string, ObservedPrice>;
  connections: Partial<Record<Source, FeedConnectionStatus>>;
  now: number;
  applyTicks: (ticks: PriceTick[]) => void;
  setConnection: (source: Source, status: FeedConnectionStatus) => void;
}

/**
 * Live last prices written by the websocket layer. Rows subscribe to a single
 * coin key via a selector, so a tick only re-renders the row(s) it touches.
 */
export const useLivePrices = create<LivePricesState>((set) => ({
  prices: {},
  observations: {},
  connections: {},
  now: Date.now(),
  setConnection: (source, status) => set((state) =>
    state.connections[source] === status ? state : { connections: { ...state.connections, [source]: status } }),
  applyTicks: (ticks) =>
    set((state) => {
      let changed = false;
      const draft = { ...state.prices };
      const observations = { ...state.observations };
      const now = Date.now();
      for (const t of ticks) {
        const ts = t.ts ?? now;
        if (!Number.isFinite(t.last) || t.last < 0 || !Number.isFinite(ts) || ts <= 0 || ts > now + 5_000) continue;
        if (observations[t.coinKey] && observations[t.coinKey].ts > ts) continue;
        draft[t.coinKey] = t.last;
        observations[t.coinKey] = { last: t.last, ts };
        changed = true;
      }
      return changed ? { prices: draft, observations } : state;
    }),
}));

/** Selector hook: live price for one coin key (undefined until first tick). */
export const useLivePrice = (coinKey: string | undefined): number | undefined =>
  useLivePrices((s) => (coinKey ? s.prices[coinKey] : undefined));

// One shared clock for all mounted rows, so freshness changes even when no ticks arrive.
let clockUsers = 0;
let freshnessClock: ReturnType<typeof setInterval> | undefined;
function useFreshnessClock() {
  useEffect(() => {
    if (clockUsers++ === 0) {
      useLivePrices.setState({ now: Date.now() });
      freshnessClock = setInterval(() => useLivePrices.setState({ now: Date.now() }), 5_000);
    }
    return () => {
      if (--clockUsers === 0) { clearInterval(freshnessClock); freshnessClock = undefined; }
    };
  }, []);
}

export function useMarketPrice(instrument: Instrument | undefined, quote: Quote | undefined) {
  useFreshnessClock();
  const tick = useLivePrices((s) => instrument ? s.observations[instrument.coinKey] : undefined);
  const connection = useLivePrices((s) => instrument ? s.connections[instrument.source] ?? 'idle' : 'idle');
  const now = useLivePrices((s) => s.now);
  return marketPriceState(instrument ?? { source: 'hyperliquid', assetClass: 'crypto-perp' }, quote, tick, connection, Math.max(now, tick?.ts ?? 0));
}
