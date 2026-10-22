import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import { usePageActive } from "./PageView";
import MarketAvatar from "./MarketAvatar";
import {
  addCalendarDays,
  calendarDateKey,
  calendarWeekLabel,
} from "../data/economicCalendar";
import {
  defaultEarningsPreferences,
  earningsCapTiers,
  earningsLines,
  earningsSessions,
  earningsStatus,
  earningsTime,
  earningsTimingLabel,
  earningsWeekDays,
  earningsWeekStart,
  filterEarnings,
  formatMarketCap,
  loadEarningsPreferences,
  loadEarningsWeek,
  saveEarningsPreferences,
  type EarningsCalendar as EarningsWeek,
  type EarningsReport,
} from "../data/earningsCalendar";
import "./EarningsCalendar.css";

type IconName =
  | "calendar"
  | "left"
  | "right"
  | "filter"
  | "search"
  | "sun"
  | "moon"
  | "external";
const Icon: Component<{ name: IconName; size?: number }> = (props) => (
  <svg
    width={props.size ?? 16}
    height={props.size ?? 16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <Show when={props.name === "calendar"}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" />
    </Show>
    <Show when={props.name === "left"}>
      <path d="m14 6-6 6 6 6" />
    </Show>
    <Show when={props.name === "right"}>
      <path d="m10 6 6 6-6 6" />
    </Show>
    <Show when={props.name === "filter"}>
      <path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" />
    </Show>
    <Show when={props.name === "search"}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </Show>
    <Show when={props.name === "sun"}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Show>
    <Show when={props.name === "moon"}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </Show>
    <Show when={props.name === "external"}>
      <path d="M14 4h6v6M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
    </Show>
  </svg>
);

const reportCount = (count: number) =>
  count === 0 ? "No reports" : `${count} ${count === 1 ? "report" : "reports"}`;

const sessionGroups = (["before_open", "after_close", "unknown"] as const).map(
  (timing) => ({ timing, label: earningsTimingLabel(timing) }),
);

const EarningsWhen: Component<{ report: EarningsReport; now: number }> = (
  props,
) => {
  const status = () => earningsStatus(props.report, props.now);
  const time = () => earningsTime(props.report);
  const title = () =>
    status() === "reported"
      ? `Reported${time() ? ` at ${time()}` : ""} London time`
      : status() === "awaiting"
        ? `Due at ${time()} London time; figures are not in yet`
        : time()
          ? `${earningsTimingLabel(props.report.timing)}, ${time()} London time`
          : "Release time not confirmed";
  return (
    <span class="earnings-when" data-status={status()} title={title()}>
      <Show
        when={status() === "scheduled"}
        fallback={
          <>
            <i class="earnings-dot" />
            {status() === "reported" ? "Reported" : "Awaiting"}
          </>
        }
      >
        <Show when={time()} fallback="TBC">
          <Show when={props.report.timing !== "unknown"}>
            <Icon
              name={props.report.timing === "before_open" ? "sun" : "moon"}
              size={13}
            />
          </Show>
          {time()}
        </Show>
      </Show>
    </span>
  );
};

const EarningsRow: Component<{ report: EarningsReport; now: number }> = (
  props,
) => {
  const lines = createMemo(() => earningsLines(props.report));
  return (
    <article class="earnings-row" data-testid={`earnings-${props.report.ticker}`}>
      <MarketAvatar
        symbol={props.report.symbol}
        logo={props.report.logo}
        size={40}
      />
      <div class="earnings-company">
        <h3 title={props.report.name}>{props.report.name}</h3>
        <p>
          <span class="earnings-ticker">{props.report.ticker}</span>
          <Show when={props.report.marketCap}>
            {(cap) => (
              <span>{formatMarketCap(cap(), props.report.currency)}</span>
            )}
          </Show>
        </p>
      </div>
      <div class="earnings-pill">
        <Show when={props.report.period}>
          <span class="earnings-period">{props.report.period}</span>
        </Show>
        <EarningsWhen report={props.report} now={props.now} />
      </div>
      <ul class="earnings-lines">
        <For
          each={lines()}
          fallback={<li class="is-muted">No consensus estimates yet.</li>}
        >
          {(line) => (
            <li>
              {line.text}
              <Show when={line.surprise}>
                {(surprise) => (
                  <>
                    {" · "}
                    <span class="earnings-surprise" data-tone={surprise().tone}>
                      {surprise().label}
                    </span>
                  </>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </article>
  );
};

type WeekData = { week: string; calendar?: EarningsWeek; error?: string };

const EarningsCalendar: Component = () => {
  const pageActive = usePageActive();
  const [now, setNow] = createSignal(Date.now());
  const today = createMemo(() => calendarDateKey(new Date(now())));
  const currentWeek = createMemo(() => earningsWeekStart(today()));
  const [week, setWeek] = createSignal(currentWeek());
  const [day, setDay] = createSignal(today());
  // Until a day is picked, the strip settles on the next day with reports.
  const [dayChosen, setDayChosen] = createSignal(false);
  const saved = loadEarningsPreferences();
  const [cap, setCap] = createSignal(saved.cap);
  const [session, setSession] = createSignal(saved.session);
  const [query, setQuery] = createSignal("");
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const cache = new Map<string, WeekData>();
  let pending: AbortController | undefined;
  let scroller: HTMLElement | undefined;
  let filterAnchor: HTMLDivElement | undefined;

  createEffect(() => saveEarningsPreferences({ cap: cap(), session: session() }));

  const [earnings, { refetch }] = createResource(
    week,
    async (selectedWeek, info): Promise<WeekData> => {
      pending?.abort();
      const cached = cache.get(selectedWeek);
      if (
        !info.refetching &&
        cached?.calendar &&
        Date.now() - Date.parse(cached.calendar.updatedAt) < 120_000
      )
        return cached;
      const controller = new AbortController();
      pending = controller;
      try {
        const calendar = await loadEarningsWeek(selectedWeek, controller.signal);
        const result = { week: selectedWeek, calendar };
        if (!controller.signal.aborted) {
          cache.set(selectedWeek, result);
          if (cache.size > 12) cache.delete(cache.keys().next().value!);
        }
        return result;
      } catch (error) {
        return {
          week: selectedWeek,
          calendar: cached?.calendar,
          error:
            error instanceof Error
              ? error.message
              : "The earnings calendar could not be loaded.",
        };
      }
    },
    { initialValue: { week: "" } as WeekData },
  );
  const data = createMemo(() =>
    earnings.latest?.week === week() ? earnings.latest : undefined,
  );
  const days = createMemo(() => earningsWeekDays(week()));
  const reports = createMemo(() =>
    filterEarnings(data()?.calendar?.reports ?? [], {
      cap: cap(),
      session: session(),
      query: query(),
    }),
  );
  const reportsByDay = createMemo(() => {
    const byDay = new Map<string, EarningsReport[]>();
    for (const report of reports())
      byDay.set(report.date, [...(byDay.get(report.date) ?? []), report]);
    return byDay;
  });
  const dayReports = createMemo(() => reportsByDay().get(day()) ?? []);
  const groups = createMemo(() =>
    sessionGroups
      .map((group) => ({
        ...group,
        reports: dayReports().filter((report) => report.timing === group.timing),
      }))
      .filter((group) => group.reports.length),
  );
  const selectedDay = createMemo(() =>
    days().find((item) => item.key === day()),
  );
  const filtered = createMemo(() => {
    const defaults = defaultEarningsPreferences();
    return cap() !== defaults.cap || session() !== defaults.session;
  });

  createEffect(() => {
    if (dayChosen() || !data()?.calendar) return;
    const keys = days().map((item) => item.key);
    const has = (key: string) => (reportsByDay().get(key)?.length ?? 0) > 0;
    const start = keys.includes(today()) ? today() : keys[0];
    setDay(
      keys.find((key) => key >= start && has(key)) ??
        keys.find(has) ??
        (keys.includes(today()) ? today() : keys[1]),
    );
  });

  const showWeek = (start: string, selected?: string) => {
    batch(() => {
      setWeek(start);
      setDay(selected ?? addCalendarDays(start, 1));
      setDayChosen(Boolean(selected));
    });
    scroller?.scrollTo({ top: 0 });
  };
  const showToday = () => {
    batch(() => {
      setWeek(currentWeek());
      setDay(today());
      setDayChosen(true);
    });
  };
  const chooseDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    showWeek(earningsWeekStart(value), value);
  };
  const resetFilters = () =>
    batch(() => {
      const defaults = defaultEarningsPreferences();
      setCap(defaults.cap);
      setSession(defaults.session);
      setQuery("");
    });

  onMount(() => {
    let ticks = 0;
    const tick = () => {
      setNow(Date.now());
      ticks += 1;
      if (
        ticks % 2 === 0 &&
        pageActive() &&
        !document.hidden &&
        week() === currentWeek() &&
        !earnings.loading
      )
        void refetch();
    };
    const timer = window.setInterval(tick, 60_000);
    onCleanup(() => window.clearInterval(timer));
  });
  onCleanup(() => pending?.abort());

  createEffect(() => {
    if (!filtersOpen()) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setFiltersOpen(false);
      } else if (!filterAnchor?.contains(event.target as Node)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    onCleanup(() => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    });
  });

  return (
    <section
      class="earnings-calendar"
      ref={scroller}
      data-testid="earnings-view"
      aria-label="Earnings calendar"
    >
      <div class="earnings-inner">
        <header class="earnings-toolbar">
          <div class="earnings-title">
            <h1>Earnings Calendar</h1>
            <p>{calendarWeekLabel(week())} · London time</p>
          </div>
          <div class="earnings-controls">
            <div class="earnings-filter-anchor" ref={filterAnchor}>
              <button
                type="button"
                class="earnings-icon-button"
                classList={{ "has-filters": filtered() }}
                aria-label="Filter earnings"
                title="Filter earnings"
                aria-haspopup="dialog"
                aria-expanded={filtersOpen()}
                aria-controls="earnings-filters"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <Icon name="filter" />
              </button>
              <Show when={filtersOpen()}>
                <div
                  id="earnings-filters"
                  class="earnings-filter-panel"
                  role="dialog"
                  aria-label="Earnings filters"
                >
                  <section>
                    <h2 id="earnings-filter-cap">Market cap</h2>
                    <div
                      class="earnings-chips"
                      role="group"
                      aria-labelledby="earnings-filter-cap"
                    >
                      <For each={earningsCapTiers}>
                        {(tier) => (
                          <button
                            type="button"
                            aria-pressed={cap() === tier.value}
                            onClick={() => setCap(tier.value)}
                          >
                            {tier.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </section>
                  <section>
                    <h2 id="earnings-filter-session">Reporting</h2>
                    <div
                      class="earnings-chips"
                      role="group"
                      aria-labelledby="earnings-filter-session"
                    >
                      <For each={earningsSessions}>
                        {(option) => (
                          <button
                            type="button"
                            aria-pressed={session() === option.value}
                            onClick={() => setSession(option.value)}
                          >
                            {option.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </section>
                  <footer>
                    <button
                      type="button"
                      disabled={!filtered()}
                      onClick={resetFilters}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      class="earnings-filter-done"
                      onClick={() => setFiltersOpen(false)}
                    >
                      Done
                    </button>
                  </footer>
                </div>
              </Show>
            </div>
            <label class="earnings-icon-button earnings-date-picker" title="Jump to a date">
              <Icon name="calendar" />
              <input
                type="date"
                aria-label="Jump to a date"
                value={day()}
                onChange={(event) => chooseDate(event.currentTarget.value)}
              />
            </label>
            <div class="earnings-week-nav" aria-label="Week navigation">
              <button
                type="button"
                class="earnings-icon-button"
                aria-label="Previous week"
                title="Previous week"
                onClick={() => showWeek(addCalendarDays(week(), -7))}
              >
                <Icon name="left" />
              </button>
              <button
                type="button"
                class="earnings-today"
                aria-pressed={week() === currentWeek() && day() === today()}
                onClick={showToday}
              >
                Today
              </button>
              <button
                type="button"
                class="earnings-icon-button"
                aria-label="Next week"
                title="Next week"
                onClick={() => showWeek(addCalendarDays(week(), 7))}
              >
                <Icon name="right" />
              </button>
            </div>
          </div>
        </header>

        <div class="earnings-days" role="group" aria-label="Choose a day">
          <For each={days()}>
            {(item) => {
              const dayList = () => reportsByDay().get(item.key) ?? [];
              const loaded = () => Boolean(data()?.calendar);
              return (
                <button
                  type="button"
                  class="earnings-day"
                  classList={{
                    "is-today": item.key === today(),
                    "is-empty": loaded() && dayList().length === 0,
                  }}
                  aria-pressed={day() === item.key}
                  aria-label={`${item.label}${item.key === today() ? ", today" : ""}${loaded() ? `, ${reportCount(dayList().length)}` : ""}`}
                  onClick={() => {
                    setDay(item.key);
                    setDayChosen(true);
                  }}
                >
                  <span class="earnings-day-name">{item.weekday}</span>
                  <strong class="earnings-day-date">
                    <span class="earnings-day-long">{item.date}</span>
                    <span class="earnings-day-short">{item.day}</span>
                  </strong>
                  <span class="earnings-day-meta">
                    <Show
                      when={loaded()}
                      fallback={<span class="earnings-day-skeleton" />}
                    >
                      <span class="earnings-day-logos" aria-hidden="true">
                        <For each={dayList().slice(0, 3)}>
                          {(report) => (
                            <MarketAvatar
                              symbol={report.symbol}
                              logo={report.logo}
                              size={22}
                            />
                          )}
                        </For>
                      </span>
                      <span class="earnings-day-long">
                        {reportCount(dayList().length)}
                      </span>
                      <span class="earnings-day-short">
                        {dayList().length || "–"}
                      </span>
                    </Show>
                  </span>
                </button>
              );
            }}
          </For>
        </div>

        <div class="earnings-list-header">
          <h2>
            {selectedDay()?.label}
            <Show when={day() === today()}>
              <small>Today</small>
            </Show>
          </h2>
          <span class="earnings-list-count" aria-live="polite">
            <Show when={data()?.calendar}>{reportCount(dayReports().length)}</Show>
          </span>
          <label class="earnings-search">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search company or ticker"
              placeholder="Search company or ticker"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>

        <Show when={data()?.error}>
          <div class="earnings-error" role="alert">
            <div>
              <strong>
                {data()?.calendar
                  ? "Updates temporarily unavailable"
                  : "Unable to load this week"}
              </strong>
              <p>
                {data()?.calendar
                  ? "Showing the last available data. Try again in a moment."
                  : "The earnings provider did not respond. Retry or choose another week."}
              </p>
            </div>
            <button
              type="button"
              disabled={earnings.loading}
              onClick={() => void refetch()}
            >
              Try again
            </button>
          </div>
        </Show>

        <div
          class="earnings-list"
          data-testid="earnings-list"
          aria-busy={earnings.loading}
        >
          <Show
            when={data()?.calendar || !earnings.loading}
            fallback={
              <div class="earnings-loading" role="status" aria-label="Loading earnings">
                <For each={[1, 2, 3, 4, 5]}>
                  {() => (
                    <div>
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </For>
              </div>
            }
          >
            <Show
              when={groups().length}
              fallback={
                <Show when={data()?.calendar}>
                  <div class="earnings-empty">
                    <Icon name="calendar" size={28} />
                    <h2>
                      {query().trim() || filtered()
                        ? "No matching reports"
                        : (data()?.calendar?.reports.length ?? 0) === 0
                          ? "No earnings listed this week"
                          : `No reports on ${selectedDay()?.weekday ?? "this day"}`}
                    </h2>
                    <p>
                      {query().trim() || filtered()
                        ? "Try another day, a wider market-cap range or a different search."
                        : (data()?.calendar?.reports.length ?? 0) === 0
                          ? "TradingView lists each company's latest and next report, so weeks far from today are incomplete."
                          : "Choose another day in the strip above."}
                    </p>
                    <Show when={query().trim() || filtered()}>
                      <button type="button" onClick={resetFilters}>
                        Reset filters
                      </button>
                    </Show>
                  </div>
                </Show>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <section class="earnings-group" aria-label={group.label}>
                    <h3 class="earnings-group-heading">
                      <span>{group.label}</span>
                      <span>{reportCount(group.reports.length)}</span>
                    </h3>
                    <For each={group.reports}>
                      {(report) => <EarningsRow report={report} now={now()} />}
                    </For>
                  </section>
                )}
              </For>
            </Show>
          </Show>
        </div>

        <footer class="earnings-footer">
          <span>
            Source:{" "}
            <a
              href="https://www.tradingview.com/markets/stocks-usa/earnings/"
              target="_blank"
              rel="noreferrer"
            >
              TradingView
              <Icon name="external" size={11} />
            </a>
            {" · "}Estimates are analyst consensus
          </span>
          <Show when={data()?.calendar?.updatedAt}>
            {(updatedAt) => (
              <span>
                Updated{" "}
                {new Date(updatedAt()).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Europe/London",
                  timeZoneName: "short",
                })}
              </span>
            )}
          </Show>
        </footer>
      </div>
    </section>
  );
};

export default EarningsCalendar;
