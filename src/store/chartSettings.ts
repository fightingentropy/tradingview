import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_RANGE, RANGE_ORDER, type RangeKey } from '@/domain/ranges';
import { mmkvStorage } from '@/lib/mmkv';

/** SMA periods offered in the indicator menu. */
export const SMA_OPTIONS = [20, 50, 200] as const;

/**
 * Chart overlay/indicator preferences. Global (not per-symbol) and persisted so
 * the user's chosen studies stick across sessions.
 */
interface ChartSettingsState {
  range: RangeKey;
  chartType: 'candle' | 'line';
  setRange: (range: RangeKey) => void;
  setChartType: (type: 'candle' | 'line') => void;
  /** Enabled SMA periods (subset of SMA_OPTIONS), e.g. [20, 50]. */
  smaPeriods: number[];
  volume: boolean;
  rsi: boolean;
  rsiPeriod: number;
  /** Overlay your open position (entry line + unrealized PnL) on the chart. On by default. */
  showPosition: boolean;
  toggleSma: (period: number) => void;
  toggleVolume: () => void;
  toggleRsi: () => void;
  setShowPosition: (value: boolean) => void;
}

export const useChartSettings = create<ChartSettingsState>()(
  persist(
    (set) => ({
      range: DEFAULT_RANGE,
      chartType: 'candle',
      setRange: (range) => set({ range }),
      setChartType: (chartType) => set({ chartType }),
      smaPeriods: [],
      volume: false,
      rsi: false,
      rsiPeriod: 14,
      showPosition: true,
      toggleSma: (period) =>
        set((s) => ({
          smaPeriods: s.smaPeriods.includes(period)
            ? s.smaPeriods.filter((p) => p !== period)
            : [...s.smaPeriods, period].sort((a, b) => a - b),
        })),
      toggleVolume: () => set((s) => ({ volume: !s.volume })),
      toggleRsi: () => set((s) => ({ rsi: !s.rsi })),
      setShowPosition: (value) => set({ showPosition: value }),
    }),
    {
      name: 'chart-settings-v2',
      storage: createJSONStorage(() => mmkvStorage),
      version: 2,
      // Coerce a stale/garbage persisted shape into safe defaults: `smaPeriods`
      // must be a numeric array, the toggles booleans, and `rsiPeriod` a finite
      // number, so the chart can read them without guards.
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<ChartSettingsState>;
        return {
          ...s,
          range: RANGE_ORDER.includes(s.range as RangeKey) ? s.range : DEFAULT_RANGE,
          chartType: s.chartType === 'line' ? 'line' : 'candle',
          smaPeriods: Array.isArray(s.smaPeriods)
            ? s.smaPeriods.filter((p): p is number => Number.isFinite(p))
            : [],
          volume: typeof s.volume === 'boolean' ? s.volume : false,
          rsi: typeof s.rsi === 'boolean' ? s.rsi : false,
          rsiPeriod: Number.isFinite(s.rsiPeriod) ? (s.rsiPeriod as number) : 14,
          showPosition: typeof s.showPosition === 'boolean' ? s.showPosition : true,
        } as ChartSettingsState;
      },
    },
  ),
);
