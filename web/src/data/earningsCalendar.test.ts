import { describe, expect, test } from "bun:test";
import {
  earningsStatus,
  earningsTime,
  earningsWeekDays,
  earningsWeekStart,
  filterEarnings,
  loadEarningsPreferences,
  loadEarningsWeek,
  type EarningsReport,
} from "./earningsCalendar";

const report = (ticker: string, extra: Partial<EarningsReport> = {}): EarningsReport => ({
  symbol: `NYSE:${ticker}`,
  ticker,
  name: `${ticker} Holdings`,
  logo: null,
  exchange: "NYSE",
  marketCap: 5e9,
  currency: "USD",
  date: "2026-10-22",
  time: "2026-10-22T20:00:00.000Z",
  timing: "after_close",
  reported: false,
  period: "Q3 2026",
  eps: { actual: null, estimate: 1, surprise: null },
  revenue: { actual: null, estimate: 1e9, surprise: null },
  context: null,
  ...extra,
});

describe("earnings weeks", () => {
  test("run Sunday to Saturday", () => {
    expect(earningsWeekStart("2026-10-22")).toBe("2026-10-18");
    expect(earningsWeekStart("2026-10-18")).toBe("2026-10-18");
    expect(earningsWeekStart("2026-10-24")).toBe("2026-10-18");
    const days = earningsWeekDays("2026-10-18");
    expect(days.map((day) => day.weekday)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(days[4]).toMatchObject({ key: "2026-10-22", date: "22 Oct", day: 22 });
  });

  test("show London clock times across the clock change", () => {
    expect(earningsTime(report("WDC"))).toBe("21:00");
    expect(earningsTime(report("WELL", { time: "2026-10-26T20:00:00.000Z" }))).toBe("20:00");
    expect(earningsTime(report("TBC", { time: null }))).toBeUndefined();
  });

  test("mark releases that are due but have no figures", () => {
    const now = Date.parse("2026-10-22T20:30:00.000Z");
    expect(earningsStatus(report("A"), now)).toBe("awaiting");
    expect(earningsStatus(report("B", { time: "2026-10-22T21:00:00.000Z" }), now)).toBe("scheduled");
    expect(earningsStatus(report("C", { reported: true }), now)).toBe("reported");
  });
});

describe("earnings filters", () => {
  const reports = [
    report("BIG", { marketCap: 3e11, timing: "before_open" }),
    report("MID", { marketCap: 5e9 }),
    report("SHELL", { marketCap: 5e4, name: "Shell Corp" }),
  ];

  test("apply market cap, session and search", () => {
    const tickers = (list: EarningsReport[]) => list.map((item) => item.ticker);
    expect(tickers(filterEarnings(reports, { cap: "all", session: "all", query: "" }))).toEqual(["BIG", "MID", "SHELL"]);
    expect(tickers(filterEarnings(reports, { cap: "small", session: "all", query: "" }))).toEqual(["BIG", "MID"]);
    expect(tickers(filterEarnings(reports, { cap: "all", session: "after_close", query: "" }))).toEqual(["MID", "SHELL"]);
    expect(tickers(filterEarnings(reports, { cap: "all", session: "all", query: "shell" }))).toEqual(["SHELL"]);
    expect(tickers(filterEarnings(reports, { cap: "all", session: "all", query: "mi" }))).toEqual(["MID"]);
  });

  test("restore saved preferences and ignore stale values", () => {
    const storage = (value: string | null) => ({ getItem: () => value });
    expect(loadEarningsPreferences(storage(null))).toEqual({ cap: "small", session: "all" });
    expect(loadEarningsPreferences(storage('{"cap":"large","session":"before_open"}'))).toEqual({ cap: "large", session: "before_open" });
    expect(loadEarningsPreferences(storage('{"cap":"huge"}'))).toEqual({ cap: "small", session: "all" });
    expect(loadEarningsPreferences(storage("not json"))).toEqual({ cap: "small", session: "all" });
  });
});

test("loads one Sunday-to-Saturday week from the Worker", async () => {
  let requested = "";
  const calendar = await loadEarningsWeek("2026-10-18", undefined, (async (url: string) => {
    requested = url;
    return Response.json({ from: "2026-10-18", to: "2026-10-24", updatedAt: "2026-10-22T19:00:00.000Z", reports: [report("PG")] });
  }) as typeof fetch);
  expect(requested).toBe("/api/earnings-calendar?from=2026-10-18&to=2026-10-24");
  expect(calendar.reports.map((item) => item.ticker)).toEqual(["PG"]);

  const failing = (async () => new Response("nope", { status: 502 })) as unknown as typeof fetch;
  await expect(loadEarningsWeek("2026-10-18", undefined, failing)).rejects.toThrow("unavailable");
});
