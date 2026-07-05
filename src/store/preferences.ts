import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { SortMode } from '@/components/SortControl';
import { mmkvStorage } from '@/lib/mmkv';

/** USD threshold below which a balance counts as "dust". */
export const SMALL_BALANCE_USD = 1;

/**
 * Global display preferences, persisted across sessions.
 */
interface PreferencesState {
  /** Hide spot balances worth less than {@link SMALL_BALANCE_USD}. On by default. */
  hideSmallBalances: boolean;
  setHideSmallBalances: (value: boolean) => void;
  /** Privacy mode: mask account values/amounts behind dots (eye toggle). Off by default. */
  privacyMode: boolean;
  setPrivacyMode: (value: boolean) => void;
  /** Markets-tab row order (default = by volume). Remembered across launches. */
  marketsSort: SortMode;
  setMarketsSort: (value: SortMode) => void;
  /** Watchlist row order (default = the list's manual order). Remembered across launches. */
  watchlistSort: SortMode;
  setWatchlistSort: (value: SortMode) => void;
  /**
   * Fire a local OS notification when a price alert triggers, and keep the background
   * alert check registered. Off by default; enabling it requests notification permission.
   */
  alertNotifications: boolean;
  setAlertNotifications: (value: boolean) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      hideSmallBalances: true,
      setHideSmallBalances: (value) => set({ hideSmallBalances: value }),
      privacyMode: false,
      setPrivacyMode: (value) => set({ privacyMode: value }),
      marketsSort: 'default',
      setMarketsSort: (value) => set({ marketsSort: value }),
      watchlistSort: 'default',
      setWatchlistSort: (value) => set({ watchlistSort: value }),
      alertNotifications: false,
      setAlertNotifications: (value) => set({ alertNotifications: value }),
    }),
    {
      name: 'preferences-v1',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
