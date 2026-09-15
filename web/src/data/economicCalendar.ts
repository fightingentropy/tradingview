import {
  ECONOMIC_CALENDAR_COUNTRIES,
  countryCodeToFlag,
  formatEconomicCalendarValue,
  parseEconomicCalendarEvents,
  type EconomicCalendarEvent,
} from "../../../src/domain/economicCalendar";

export { countryCodeToFlag };
export const calendarCountries = ECONOMIC_CALENDAR_COUNTRIES;
export const CALENDAR_TIME_ZONE = "Europe/London";

export const calendarCategories = [
  "Inflation",
  "Labour",
  "Central bank",
  "Growth",
  "Business",
  "Consumer",
  "Housing",
  "Trade",
  "Government",
  "Energy",
  "Other",
] as const;
export type CalendarCategory = (typeof calendarCategories)[number];
export type CalendarEvent = EconomicCalendarEvent & {
  day: string;
  time: string;
  category: CalendarCategory;
  scale?: string;
  description?: string;
  source?: { label: string; href: string };
};
export type CalendarFilters = {
  day: string;
  countries: readonly string[];
  category: string;
  impact: "all" | "important" | "high";
  query: string;
};

const CATEGORY_LABELS: Record<string, CalendarCategory> = {
  prce: "Inflation",
  lbr: "Labour",
  mny: "Central bank",
  gdp: "Growth",
  bsnss: "Business",
  cnsm: "Consumer",
  hse: "Housing",
  trd: "Trade",
  gov: "Government",
  bnd: "Government",
  enrg: "Energy",
};
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CALENDAR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: CALENDAR_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export function calendarDateKey(date = new Date()): string {
  const parts = dateFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateFromKey(key: string): Date {
  const date = new Date(`${key}T12:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(key) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== key
  ) {
    throw new RangeError("Invalid calendar date");
  }
  return date;
}

export function addCalendarDays(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarWeekStart(key: string): string {
  return addCalendarDays(key, -((dateFromKey(key).getUTCDay() + 6) % 7));
}

export function calendarWeekDays(start: string) {
  return Array.from({ length: 7 }, (_, index) => {
    const key = addCalendarDays(start, index);
    const date = dateFromKey(key);
    return {
      key,
      day: date.getUTCDate(),
      weekday: date.toLocaleDateString("en-GB", {
        weekday: "short",
        timeZone: "UTC",
      }),
      label: date.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }),
    };
  });
}

export function calendarWeekLabel(start: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(dateFromKey(start), dateFromKey(addCalendarDays(start, 6)));
}

export function calendarTimeZoneLabel(start: string): string {
  const name = (key: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: CALENDAR_TIME_ZONE,
      timeZoneName: "short",
    })
      .formatToParts(dateFromKey(key))
      .find((part) => part.type === "timeZoneName")!.value;
  const first = name(start);
  const last = name(addCalendarDays(start, 6));
  return first === last ? first : `${first} / ${last}`;
}

function sourceFromRecord(
  raw: Record<string, unknown>,
): CalendarEvent["source"] {
  if (typeof raw.source_url !== "string" || !raw.source_url.trim())
    return undefined;
  try {
    const url = new URL(raw.source_url);
    if (!["https:", "http:"].includes(url.protocol)) return undefined;
    return {
      href: url.href,
      label:
        typeof raw.source === "string" && raw.source.trim()
          ? raw.source
          : url.hostname,
    };
  } catch {
    return undefined;
  }
}

export function parseCalendarWeek(
  raw: unknown,
  start: string,
): CalendarEvent[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("result" in raw) ||
    !Array.isArray(raw.result)
  ) {
    throw new Error("The calendar feed returned an invalid response.");
  }
  const records = new Map<string, Record<string, unknown>>();
  for (const item of raw.result) {
    if (item && typeof item === "object" && typeof item.id === "string")
      records.set(item.id, item);
  }
  const end = addCalendarDays(start, 7);
  const seen = new Set<string>();
  return parseEconomicCalendarEvents(raw).flatMap((event): CalendarEvent[] => {
    const day = calendarDateKey(new Date(event.date));
    if (day < start || day >= end || seen.has(event.id)) return [];
    seen.add(event.id);
    const record = records.get(event.id)!;
    return [
      {
        ...event,
        day,
        time: timeFormatter.format(new Date(event.date)),
        category: CATEGORY_LABELS[String(record.category)] ?? "Other",
        scale:
          typeof record.scale === "string" ? record.scale.trim() : undefined,
        description:
          typeof record.comment === "string" && record.comment.trim()
            ? record.comment.trim()
            : undefined,
        source: sourceFromRecord(record),
      },
    ];
  });
}

export function formatCalendarValue(
  event: CalendarEvent,
  field: "actual" | "forecast" | "previous",
): string {
  const value = event[field];
  if (value === null) return "–";
  const amount = `${formatEconomicCalendarValue(value)}${event.scale ?? ""}`;
  if (!event.unit) return amount;
  if (/^[£$€¥]$/.test(event.unit)) return `${event.unit}${amount}`;
  return event.unit === "%" ? `${amount}%` : `${amount} ${event.unit}`;
}

export function filterCalendarEvents(
  events: CalendarEvent[],
  filters: CalendarFilters,
): CalendarEvent[] {
  const query = filters.query.trim().toLowerCase();
  const countries = new Set(filters.countries);
  return events.filter((event) => {
    if (filters.day !== "week" && event.day !== filters.day) return false;
    if (!countries.has(event.country)) return false;
    if (filters.category !== "all" && event.category !== filters.category)
      return false;
    if (filters.impact === "high" && event.importance !== 1) return false;
    if (filters.impact === "important" && event.importance < 0) return false;
    const country =
      calendarCountries.find((item) => item.code === event.country)?.name ??
      event.country;
    return (
      !query ||
      `${event.title} ${event.currency ?? ""} ${country} ${event.country} ${event.category}`
        .toLowerCase()
        .includes(query)
    );
  });
}

export async function loadCalendarWeek(
  start: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CalendarEvent[]> {
  // Include Monday's first hour during British Summer Time, then trim the
  // padded UTC response precisely to seven London calendar days above.
  const query = new URLSearchParams({
    from: `${addCalendarDays(start, -1)}T00:00:00.000Z`,
    to: `${addCalendarDays(start, 7)}T00:00:00.000Z`,
    countries: calendarCountries.map((country) => country.code).join(","),
    minImportance: "-1",
  });
  const response = await fetcher(`/api/economic-calendar?${query}`, {
    headers: { Accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error("The calendar feed is unavailable. Please try again.");
  return parseCalendarWeek(await response.json(), start);
}
