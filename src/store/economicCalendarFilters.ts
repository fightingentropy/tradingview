import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES,
  ECONOMIC_CALENDAR_COUNTRY_CODES,
  normalizeEconomicCalendarCountries,
  normalizeEconomicCalendarImportances,
  type EconomicCalendarImportance,
} from '@/domain/economicCalendar';
import { mmkvStorage } from '@/lib/mmkv';

interface EconomicCalendarFiltersState {
  selectedCountries: string[];
  selectedImportances: EconomicCalendarImportance[];
  setFilters: (
    countries: readonly string[],
    importances: readonly EconomicCalendarImportance[],
  ) => void;
}

export const useEconomicCalendarFilters = create<EconomicCalendarFiltersState>()(
  persist(
    (set) => ({
      selectedCountries: [...ECONOMIC_CALENDAR_COUNTRY_CODES],
      selectedImportances: [...DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES],
      setFilters: (countries, importances) =>
        set({
          selectedCountries: normalizeEconomicCalendarCountries(countries),
          selectedImportances: normalizeEconomicCalendarImportances(importances),
        }),
    }),
    {
      name: 'economic-calendar-filters-v1',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: ({ selectedCountries, selectedImportances }) => ({
        selectedCountries,
        selectedImportances,
      }),
      merge: (persistedState, currentState) => {
        const persisted =
          persistedState && typeof persistedState === 'object'
            ? (persistedState as Partial<EconomicCalendarFiltersState>)
            : {};
        return {
          ...currentState,
          selectedCountries: normalizeEconomicCalendarCountries(
            persisted.selectedCountries,
          ),
          selectedImportances: normalizeEconomicCalendarImportances(
            persisted.selectedImportances,
          ),
        };
      },
    },
  ),
);
