import { describe, expect, test } from "bun:test";
import {
  CALENDAR_PREFERENCES_KEY,
  defaultCalendarPreferences,
  loadCalendarPreferences,
  saveCalendarPreferences,
  type CalendarPreferences,
} from "./calendarPreferences";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe("saved calendar selections", () => {
  test("starts with all countries and categories, and high and medium impact", () => {
    expect(loadCalendarPreferences(memoryStorage())).toEqual(
      defaultCalendarPreferences(),
    );
  });

  test("restores every selected filter on the next visit", () => {
    const storage = memoryStorage();
    const selected: CalendarPreferences = {
      countries: ["US", "GB", "GR"],
      categories: ["Inflation", "Labour"],
      impacts: ["high", "low"],
    };
    saveCalendarPreferences(selected, storage);
    expect(loadCalendarPreferences(storage)).toEqual(selected);
    saveCalendarPreferences({ ...selected, impacts: ["medium"] }, storage);
    expect(loadCalendarPreferences(storage)).toEqual({
      ...selected,
      impacts: ["medium"],
    });
  });

  test("keeps intentionally empty selections empty after reopening", () => {
    const storage = memoryStorage();
    const empty = { countries: [], categories: [], impacts: [] };
    saveCalendarPreferences(empty, storage);
    expect(loadCalendarPreferences(storage)).toEqual(empty);
  });

  test("resetting overwrites previously saved selections", () => {
    const storage = memoryStorage();
    saveCalendarPreferences(
      { countries: [], categories: [], impacts: ["low"] },
      storage,
    );
    saveCalendarPreferences(defaultCalendarPreferences(), storage);
    expect(loadCalendarPreferences(storage)).toEqual(
      defaultCalendarPreferences(),
    );
  });

  test("cleans unknown values and duplicates without discarding valid selections", () => {
    const storage = memoryStorage();
    storage.setItem(
      CALENDAR_PREFERENCES_KEY,
      JSON.stringify({
        countries: ["US", "US", "unknown", 3],
        categories: ["Labour", "Labour", "invalid"],
        impacts: ["low", "low", "invalid"],
      }),
    );
    expect(loadCalendarPreferences(storage)).toEqual({
      countries: ["US"],
      categories: ["Labour"],
      impacts: ["low"],
    });
  });

  test("corrupt storage uses defaults, while missing fields keep valid choices", () => {
    const storage = memoryStorage();
    for (const raw of ["bad JSON", "null", "[]", "42"]) {
      storage.setItem(CALENDAR_PREFERENCES_KEY, raw);
      expect(loadCalendarPreferences(storage)).toEqual(
        defaultCalendarPreferences(),
      );
    }
    storage.setItem(
      CALENDAR_PREFERENCES_KEY,
      JSON.stringify({
        countries: ["US"],
        categories: "invalid",
        impacts: null,
      }),
    );
    expect(loadCalendarPreferences(storage)).toEqual({
      ...defaultCalendarPreferences(),
      countries: ["US"],
    });
  });

  test("unavailable browser storage does not break the calendar", () => {
    const unavailable = {
      getItem(): never {
        throw new Error("Storage disabled");
      },
      setItem(): never {
        throw new Error("Storage disabled");
      },
    };
    expect(loadCalendarPreferences(unavailable)).toEqual(
      defaultCalendarPreferences(),
    );
    expect(() =>
      saveCalendarPreferences(defaultCalendarPreferences(), unavailable),
    ).not.toThrow();
  });
});
