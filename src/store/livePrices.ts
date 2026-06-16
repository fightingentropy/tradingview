import { create } from 'zustand';

import type { PriceTick } from '@/providers/types';

interface LivePricesState {
  /** Latest streamed last-price keyed by provider-native coin key. */
  prices: Record<string, number>;
  applyTicks: (ticks: PriceTick[]) => void;
}

/**
 * Live last prices written by the websocket layer. Rows subscribe to a single
 * coin key via a selector, so a tick only re-renders the row(s) it touches.
 */
export const useLivePrices = create<LivePricesState>((set) => ({
  prices: {},
  applyTicks: (ticks) =>
    set((state) => {
      let changed = false;
      const next = state.prices;
      const draft: Record<string, number> = { ...next };
      for (const t of ticks) {
        if (draft[t.coinKey] !== t.last) {
          draft[t.coinKey] = t.last;
          changed = true;
        }
      }
      return changed ? { prices: draft } : state;
    }),
}));

/** Selector hook: live price for one coin key (undefined until first tick). */
export const useLivePrice = (coinKey: string | undefined): number | undefined =>
  useLivePrices((s) => (coinKey ? s.prices[coinKey] : undefined));
