import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      hideSmallBalances: true,
      setHideSmallBalances: (value) => set({ hideSmallBalances: value }),
      privacyMode: false,
      setPrivacyMode: (value) => set({ privacyMode: value }),
    }),
    {
      name: 'preferences-v1',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
