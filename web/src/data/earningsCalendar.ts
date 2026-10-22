import {
  DEFAULT_EARNINGS_CAP_TIER,
  EARNINGS_CAP_TIERS,
  earningsLines,
  earningsStatus,
  earningsTimingLabel,
  formatMarketCap,
  meetsEarningsCapTier,
  parseEarningsCalendar,
  type EarningsCalendar,
  type EarningsCapTier,
  type EarningsLine,
  type EarningsReport,
  type EarningsStatus,
} from "../../../src/domain/earningsCalendar";
import { CALENDAR_TIME_ZONE, addCalendarDays } from "./economicCalendar";

export { earningsLines, earningsStatus, earningsTimingLabel, formatMarketCap };
export type {
  EarningsCalendar,
  EarningsCapTier,
  EarningsLine,
  EarningsReport,
  EarningsStatus,
};
export const earningsCapTiers = EARNINGS_CAP_TIERS;

export const EARNINGS_PREFERENCES_KEY = "tradingview.earnings.filters.v1";

export const earningsSessions = [
  { value: "all", label: "All" },
  { value: "before_open", label: "Before open" },
  { value: "after_close", label: "After close" },
] as const;
export type EarningsSession = (typeof earningsSessions)[number]["value"];

export type EarningsFilters = {
  cap: EarningsCapTier;
  session: EarningsSession;
  query: string;
};
export type EarningsPreferences = Pick<EarningsFilters, "cap" | "session">;

export const defaultEarningsPreferences = (): EarningsPreferences => ({
  cap: DEFAULT_EARNINGS_CAP_TIER,
  session: "all",
});

export function loadEarningsPreferences(
  storage?: Pick<Storage, "getItem">,
): EarningsPreferences {
  const defaults = defaultEarningsPreferences();
  try {
    const saved: unknown = JSON.parse(
      (storage ?? window.localStorage).getItem(EARNINGS_PREFERENCES_KEY) ??
        "null",
    );
    if (!saved || typeof saved !== "object") return defaults;
    const record = saved as Record<string, unknown>;
    return {
      cap:
        earningsCapTiers.find((tier) => tier.value === record.cap)?.value ??
        defaults.cap,
      session:
        earningsSessions.find((session) => session.value === record.session)
          ?.value ?? defaults.session,
    };
  } catch {
    return defaults;
  }
}

export function saveEarningsPreferences(
  preferences: EarningsPreferences,
  storage?: Pick<Storage, "setItem">,
) {
  try {
    (storage ?? window.localStorage).setItem(
      EARNINGS_PREFERENCES_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    /* Private browsing can refuse storage; the filters still apply for this visit. */
  }
}

const weekday = (key: string) => new Date(`${key}T12:00:00.000Z`).getUTCDay();

/** Earnings weeks run Sunday to Saturday, like US market calendars. */
export function earningsWeekStart(key: string): string {
  return addCalendarDays(key, -weekday(key));
}

export function earningsWeekDays(start: string) {
  return Array.from({ length: 7 }, (_, index) => {
    const key = addCalendarDays(start, index);
    const date = new Date(`${key}T12:00:00.000Z`);
    const format = (options: Intl.DateTimeFormatOptions) =>
      date.toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
    return {
      key,
      weekday: format({ weekday: "short" }),
      date: format({ day: "numeric", month: "short" }),
      day: date.getUTCDate(),
      label: format({ weekday: "long", day: "numeric", month: "long" }),
    };
  });
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: CALENDAR_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

/** London clock time of the release, when TradingView has a real one. */
export const earningsTime = (report: EarningsReport) =>
  report.time ? timeFormatter.format(new Date(report.time)) : undefined;

export function filterEarnings(
  reports: readonly EarningsReport[],
  filters: EarningsFilters,
): EarningsReport[] {
  const query = filters.query.trim().toLowerCase();
  return reports.filter(
    (report) =>
      meetsEarningsCapTier(report, filters.cap) &&
      (filters.session === "all" || report.timing === filters.session) &&
      (!query ||
        report.ticker.toLowerCase().startsWith(query) ||
        report.name.toLowerCase().includes(query)),
  );
}

export async function loadEarningsWeek(
  start: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<EarningsCalendar> {
  const query = new URLSearchParams({
    from: start,
    to: addCalendarDays(start, 6),
  });
  const response = await fetcher(`/api/earnings-calendar?${query}`, {
    headers: { Accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error("The earnings feed is unavailable. Please try again.");
  return parseEarningsCalendar(await response.json());
}
