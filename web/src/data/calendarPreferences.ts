import {
  calendarCategories,
  calendarCountries,
  calendarImpacts,
  type CalendarCategory,
  type CalendarImpact,
} from "./economicCalendar";

export const CALENDAR_PREFERENCES_KEY = "tradingview.calendar.filters.v1";

export type CalendarPreferences = {
  countries: string[];
  categories: CalendarCategory[];
  impacts: CalendarImpact[];
};

export const defaultCalendarPreferences = (): CalendarPreferences => ({
  countries: calendarCountries.map((country) => country.code),
  categories: [...calendarCategories],
  impacts: ["high", "medium"],
});

function selectedValues<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T[],
): T[] {
  if (!Array.isArray(value)) return fallback;
  // Preserve a deliberately empty selection, while dropping stale values and duplicates.
  return allowed.filter((item) => value.includes(item));
}

export function loadCalendarPreferences(
  storage?: Pick<Storage, "getItem">,
): CalendarPreferences {
  const defaults = defaultCalendarPreferences();
  try {
    const raw = (storage ?? window.localStorage).getItem(
      CALENDAR_PREFERENCES_KEY,
    );
    if (!raw) return defaults;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return defaults;
    const record = saved as Record<string, unknown>;
    return {
      countries: selectedValues(
        record.countries,
        defaults.countries,
        defaults.countries,
      ),
      categories: selectedValues(
        record.categories,
        calendarCategories,
        defaults.categories,
      ),
      impacts: selectedValues(
        record.impacts,
        calendarImpacts.map((impact) => impact.value),
        defaults.impacts,
      ),
    };
  } catch {
    return defaults;
  }
}

export function saveCalendarPreferences(
  preferences: CalendarPreferences,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    (storage ?? window.localStorage).setItem(
      CALENDAR_PREFERENCES_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // Filtering still works in memory when browser storage is unavailable.
  }
}
