import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { SortMode } from '@/components/SortControl';
import { ALL_NEWS_NOTIFICATION_SOURCE_IDS } from '@/domain/newsNotificationSources';
import { mmkvStorage } from '@/lib/mmkv';

/** USD threshold below which a balance counts as "dust". */
export const SMALL_BALANCE_USD = 1;

export type MarketsFilter = 'all' | 'spot' | import('@/domain/marketThemes').WatchlistThemeId;

export type AccountTab =
  | 'positions' | 'orders' | 'balances' | 'history'
  | 'funding' | 'interest' | 'orderHistory' | 'transfers';

/**
 * Global display preferences, persisted across sessions.
 */
interface PreferencesState {
  /** Last Account section, restored immediately when returning or relaunching. */
  accountTab: AccountTab;
  setAccountTab: (value: AccountTab) => void;
  /** Show the optional CLOB depth panel in the web trading workspace. Off by default. */
  showClobOrderBook: boolean;
  setShowClobOrderBook: (value: boolean) => void;
  /** Add the opt-in Hyperliquid Outcomes destination to bottom navigation. */
  showOutcomeMarkets: boolean;
  setShowOutcomeMarkets: (value: boolean) => void;
  /** Hide spot balances worth less than {@link SMALL_BALANCE_USD}. On by default. */
  hideSmallBalances: boolean;
  setHideSmallBalances: (value: boolean) => void;
  /** Privacy mode: mask account values/amounts behind dots (eye toggle). Off by default. */
  privacyMode: boolean;
  setPrivacyMode: (value: boolean) => void;
  /** Markets-tab row order (default = by volume). Remembered across launches. */
  marketsFilter: MarketsFilter;
  setMarketsFilter: (value: MarketsFilter) => void;
  marketsSort: SortMode;
  setMarketsSort: (value: SortMode) => void;
  /** Watchlist row order (default = the list's manual order). Remembered across launches. */
  watchlistSort: SortMode;
  setWatchlistSort: (value: SortMode) => void;
  /**
   * Monitor price alerts on the Mac mini. Off by default; enabling requests push permission.
   */
  alertNotifications: boolean;
  setAlertNotifications: (value: boolean) => void;
  /** Keep retrying an unacknowledged disable across restarts without claiming it is off. */
  priceAlertsDisablePending: boolean;
  setPriceAlertsDisablePending: (value: boolean) => void;
  /** Receive remote push notifications when the configured news feeds publish. */
  newsNotifications: boolean;
  setNewsNotifications: (value: boolean) => void;
  /** X list and Telegram channels allowed to send remote news notifications. */
  newsNotificationSources: string[];
  setNewsNotificationSources: (value: string[]) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      accountTab: 'positions',
      setAccountTab: (value) => set({ accountTab: value }),
      showClobOrderBook: false,
      setShowClobOrderBook: (value) => set({ showClobOrderBook: value }),
      showOutcomeMarkets: false,
      setShowOutcomeMarkets: (value) => set({ showOutcomeMarkets: value }),
      hideSmallBalances: true,
      setHideSmallBalances: (value) => set({ hideSmallBalances: value }),
      privacyMode: false,
      setPrivacyMode: (value) => set({ privacyMode: value }),
      marketsFilter: 'all',
      setMarketsFilter: (value) => set({ marketsFilter: value }),
      marketsSort: 'default',
      setMarketsSort: (value) => set({ marketsSort: value }),
      watchlistSort: 'default',
      setWatchlistSort: (value) => set({ watchlistSort: value }),
      alertNotifications: false,
      setAlertNotifications: (value) => set({ alertNotifications: value }),
      priceAlertsDisablePending: false,
      setPriceAlertsDisablePending: (value) => set({ priceAlertsDisablePending: value }),
      newsNotifications: false,
      setNewsNotifications: (value) => set({ newsNotifications: value }),
      newsNotificationSources: [...ALL_NEWS_NOTIFICATION_SOURCE_IDS],
      setNewsNotificationSources: (value) => set({ newsNotificationSources: value }),
    }),
    {
      name: 'preferences-v1',
      storage: createJSONStorage(() => mmkvStorage),
      version: 5,
      migrate: (persisted, version) => {
        const state = persisted as Partial<PreferencesState>;
        return version < 5 ? { ...state, showClobOrderBook: false } as PreferencesState : state as PreferencesState;
      },
    },
  ),
);
