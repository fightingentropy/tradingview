import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import type { AlertDirection, PriceAlert } from '@/domain/types';
import { mmkvStorage } from '@/lib/mmkv';

interface NewAlert {
  instrumentId: string;
  symbol: string;
  pct: number;
  direction: AlertDirection;
  anchorPrice: number;
}

interface AlertsState {
  alerts: PriceAlert[];
  add: (a: NewAlert) => void;
  remove: (id: string) => void;
  clearAll: () => void;
  /** Mark an alert as fired so the watcher won't re-trigger it. */
  markTriggered: (id: string, price: number, ts: number) => void;
  /** Re-arm a fired alert from a fresh anchor price. */
  rearm: (id: string, anchorPrice: number) => void;
}

let counter = 0;
const makeId = () => `al_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export const useAlerts = create<AlertsState>()(
  persist(
    (set) => ({
      alerts: [],
      add: (a) =>
        set((s) => ({
          alerts: [
            ...s.alerts,
            {
              ...a,
              id: makeId(),
              createdAt: Date.now(),
              triggeredAt: null,
              triggeredPrice: null,
            },
          ],
        })),
      remove: (id) => set((s) => ({ alerts: s.alerts.filter((x) => x.id !== id) })),
      clearAll: () => set({ alerts: [] }),
      markTriggered: (id, price, ts) =>
        set((s) => ({
          alerts: s.alerts.map((x) =>
            x.id === id ? { ...x, triggeredAt: ts, triggeredPrice: price } : x,
          ),
        })),
      rearm: (id, anchorPrice) =>
        set((s) => ({
          alerts: s.alerts.map((x) =>
            x.id === id
              ? { ...x, anchorPrice, triggeredAt: null, triggeredPrice: null, createdAt: Date.now() }
              : x,
          ),
        })),
    }),
    {
      name: 'alerts-v1',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);

/**
 * Reactive list of alerts for one instrument. `useShallow` keeps the reference
 * stable when the filtered contents don't change, satisfying zustand v5's
 * snapshot-caching rule.
 */
export const useAlertsFor = (instrumentId: string | undefined): PriceAlert[] =>
  useAlerts(
    useShallow((s) => (instrumentId ? s.alerts.filter((a) => a.instrumentId === instrumentId) : EMPTY)),
  );

const EMPTY: PriceAlert[] = [];
