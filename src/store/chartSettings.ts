import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/mmkv';

/** SMA periods offered in the indicator menu. */
export const SMA_OPTIONS = [20, 50, 200] as const;

/**
 * Chart overlay/indicator preferences. Global (not per-symbol) and persisted so
 * the user's chosen studies stick across sessions.
 */
interface ChartSettingsState {
  /** Enabled SMA periods (subset of SMA_OPTIONS), e.g. [20, 50]. */
  smaPeriods: number[];
  volume: boolean;
  rsi: boolean;
  rsiPeriod: number;
  toggleSma: (period: number) => void;
  toggleVolume: () => void;
  toggleRsi: () => void;
}

export const useChartSettings = create<ChartSettingsState>()(
  persist(
    (set) => ({
      smaPeriods: [],
      volume: false,
      rsi: false,
      rsiPeriod: 14,
      toggleSma: (period) =>
        set((s) => ({
          smaPeriods: s.smaPeriods.includes(period)
            ? s.smaPeriods.filter((p) => p !== period)
            : [...s.smaPeriods, period].sort((a, b) => a - b),
        })),
      toggleVolume: () => set((s) => ({ volume: !s.volume })),
      toggleRsi: () => set((s) => ({ rsi: !s.rsi })),
    }),
    {
      name: 'chart-settings-v2',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
