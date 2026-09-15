import { describe, expect, test } from "bun:test";
import {
  addCalendarDays,
  calendarDateKey,
  calendarCountries,
  calendarTimeZoneLabel,
  calendarWeekDays,
  calendarWeekLabel,
  calendarWeekStart,
  filterCalendarEvents,
  formatCalendarValue,
  loadCalendarWeek,
  parseCalendarWeek,
  type CalendarFilters,
} from "./economicCalendar";

const release = (id: string, date: string, extra = {}) => ({
  id,
  date,
  title: "Inflation Rate",
  country: "GB",
  currency: "GBP",
  importance: 1,
  actual: 0,
  forecast: 2.5,
  previous: 2.6,
  unit: "%",
  category: "prce",
  ...extra,
});
const defaults: CalendarFilters = {
  day: "week",
  countries: calendarCountries.map((country) => country.code),
  category: "all",
  impact: "important",
  query: "",
};

describe("calendar week navigation", () => {
  test("navigates across months and years and includes all seven days", () => {
    expect(calendarWeekStart("2027-01-03")).toBe("2026-12-28");
    expect(addCalendarDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addCalendarDays("2026-09-07", -7)).toBe("2026-08-31");
    expect(calendarWeekDays("2026-12-28").map((day) => day.key)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(calendarWeekLabel("2026-12-28")).toContain("2027");
  });

  test("rejects incomplete and impossible dates from the date picker", () => {
    for (const key of ["", "2026-02-30", "2026-13-01", "2026-1-1", "invalid"]) {
      expect(() => calendarWeekStart(key)).toThrow("Invalid calendar date");
    }
  });

  test("uses London dates and accurately labels the daylight-saving transition", () => {
    expect(calendarDateKey(new Date("2026-09-13T23:30:00Z"))).toBe(
      "2026-09-14",
    );
    expect(calendarDateKey(new Date("2026-12-13T23:30:00Z"))).toBe(
      "2026-12-13",
    );
    expect(calendarTimeZoneLabel("2026-10-19")).toBe("BST / GMT");
    expect(calendarTimeZoneLabel("2026-10-26")).toBe("GMT");
  });
});

describe("calendar feed boundaries", () => {
  test("trims padded results to London weeks, retaining Monday midnight and Sunday", () => {
    const events = parseCalendarWeek(
      {
        result: [
          release("too-early", "2026-09-13T22:59:00Z"),
          release("next-week", "2026-09-20T23:00:00Z"),
          release("sunday", "2026-09-20T22:59:00Z"),
          release("monday", "2026-09-13T23:00:00Z"),
          release("monday", "2026-09-13T23:00:00Z"),
          {
            id: "malformed",
            title: "Invalid date",
            country: "US",
            date: "bad",
          },
        ],
      },
      "2026-09-14",
    );
    expect(events.map((event) => event.id)).toEqual(["monday", "sunday"]);
    expect(events[0].time).toBe("00:00");
    expect(events[0].day).toBe("2026-09-14");
    expect(events[0].actual).toBe(0);
    expect(events[0].category).toBe("Inflation");
  });

  test("preserves the repeated hour and Sunday releases when clocks go back", () => {
    const events = parseCalendarWeek(
      {
        result: [
          release("bst", "2026-10-25T00:30:00Z"),
          release("gmt", "2026-10-25T01:30:00Z"),
          release("sunday-late", "2026-10-25T23:30:00Z"),
          release("monday", "2026-10-26T00:00:00Z"),
        ],
      },
      "2026-10-19",
    );
    expect(events.map((event) => event.id)).toEqual([
      "bst",
      "gmt",
      "sunday-late",
    ]);
    expect(events.slice(0, 2).map((event) => event.time)).toEqual([
      "01:30",
      "01:30",
    ]);
  });

  test("accepts an unpublished week but reports malformed feeds as failures", () => {
    expect(parseCalendarWeek({ result: [] }, "2026-09-14")).toEqual([]);
    expect(() =>
      parseCalendarWeek({ error: "unavailable" }, "2026-09-14"),
    ).toThrow("invalid response");
    expect(() => parseCalendarWeek(null, "2026-09-14")).toThrow(
      "invalid response",
    );
  });

  test("keeps sourced notes as text and only accepts HTTP source links", () => {
    const events = parseCalendarWeek(
      {
        result: [
          release("safe", "2026-09-15T10:00:00Z", {
            source: "ONS",
            source_url: "https://www.ons.gov.uk/",
            comment: "Published release notes.",
          }),
          release("unsafe", "2026-09-15T11:00:00Z", {
            source_url: "javascript:alert(1)",
          }),
        ],
      },
      "2026-09-14",
    );
    expect(events[0].source?.label).toBe("ONS");
    expect(events[0].description).toBe("Published release notes.");
    expect(events[1].source).toBeUndefined();
  });

  test("preserves provider scales so billions are never displayed as individual units", () => {
    const [event] = parseCalendarWeek(
      {
        result: [
          release("loans", "2026-09-15T10:00:00Z", {
            actual: 60,
            previous: -340,
            forecast: null,
            scale: "B",
            unit: "CNY",
          }),
        ],
      },
      "2026-09-14",
    );
    expect(formatCalendarValue(event, "actual")).toBe("60B CNY");
    expect(formatCalendarValue(event, "previous")).toBe("-340B CNY");
    expect(formatCalendarValue(event, "forecast")).toBe("–");
    expect(formatCalendarValue({ ...event, unit: "$" }, "actual")).toBe("$60B");
    expect(
      formatCalendarValue(
        { ...event, actual: 0, scale: undefined, unit: "%" },
        "actual",
      ),
    ).toBe("0%");
  });

  test("requests the selected week through the existing same-origin proxy", async () => {
    let received = "";
    const fetcher = (async (input: RequestInfo | URL) => {
      received = String(input);
      return Response.json({
        result: [release("november", "2026-11-11T10:00:00Z")],
      });
    }) as typeof fetch;
    const events = await loadCalendarWeek("2026-11-09", undefined, fetcher);
    const url = new URL(received, "https://terminal.example");
    expect(url.pathname).toBe("/api/economic-calendar");
    expect(url.searchParams.get("from")).toBe("2026-11-08T00:00:00.000Z");
    expect(url.searchParams.get("to")).toBe("2026-11-16T00:00:00.000Z");
    expect(url.searchParams.get("countries")?.split(",")).toHaveLength(18);
    expect(events[0].id).toBe("november");
  });

  test("does not turn an upstream outage into an empty schedule", async () => {
    const fetcher = (async () =>
      new Response("Unavailable", { status: 502 })) as unknown as typeof fetch;
    await expect(
      loadCalendarWeek("2026-09-14", undefined, fetcher),
    ).rejects.toThrow("unavailable");
  });
});

test("combines filters and searches country names without losing zero values", () => {
  const events = parseCalendarWeek(
    {
      result: [
        release("gb-high", "2026-09-15T10:00:00Z"),
        release("gb-low", "2026-09-15T10:00:00Z", { importance: -1 }),
        release("us", "2026-09-16T10:00:00Z", {
          country: "US",
          currency: "USD",
        }),
      ],
    },
    "2026-09-14",
  );
  expect(
    filterCalendarEvents(events, defaults).map((event) => event.id),
  ).toEqual(["gb-high", "us"]);
  expect(
    filterCalendarEvents(events, {
      ...defaults,
      query: "  United Kingdom  ",
    }).map((event) => event.id),
  ).toEqual(["gb-high"]);
  expect(
    filterCalendarEvents(events, {
      ...defaults,
      impact: "all",
      countries: ["GB"],
      category: "Inflation",
      day: "2026-09-15",
    }),
  ).toHaveLength(2);
  expect(
    filterCalendarEvents(events, { ...defaults, day: "2026-09-17" }),
  ).toHaveLength(0);
  expect(
    filterCalendarEvents(events, {
      ...defaults,
      impact: "high",
      countries: ["GB"],
    })[0].actual,
  ).toBe(0);
});

test("supports country sets, clear selection, and select all without changing other filters", () => {
  const events = parseCalendarWeek(
    {
      result: [
        release("gb", "2026-09-15T10:00:00Z"),
        release("us", "2026-09-15T11:00:00Z", { country: "US" }),
        release("ca", "2026-09-15T12:00:00Z", { country: "CA" }),
        release("us-low", "2026-09-15T13:00:00Z", {
          country: "US",
          importance: -1,
        }),
      ],
    },
    "2026-09-14",
  );
  expect(
    filterCalendarEvents(events, { ...defaults, countries: ["US", "GB"] }).map(
      (event) => event.id,
    ),
  ).toEqual(["gb", "us"]);
  expect(
    filterCalendarEvents(events, { ...defaults, countries: ["US"] }).map(
      (event) => event.id,
    ),
  ).toEqual(["us"]);
  expect(filterCalendarEvents(events, { ...defaults, countries: [] })).toEqual(
    [],
  );
  expect(
    filterCalendarEvents(events, defaults).map((event) => event.id),
  ).toEqual(["gb", "us", "ca"]);
  expect(
    filterCalendarEvents(events, {
      ...defaults,
      countries: ["US", "GB"],
      impact: "all",
    }),
  ).toHaveLength(3);
});
