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
import {
  addCalendarDays,
  calendarCategories,
  calendarCountries,
  calendarImpacts,
  calendarDateKey,
  calendarTimeZoneLabel,
  calendarWeekDays,
  calendarWeekLabel,
  calendarWeekStart,
  countryCodeToFlag,
  filterCalendarEvents,
  formatCalendarValue,
  loadCalendarWeek,
  type CalendarEvent,
  type CalendarFilters,
} from "../data/economicCalendar";
import {
  defaultCalendarPreferences,
  loadCalendarPreferences,
  saveCalendarPreferences,
} from "../data/calendarPreferences";
import "./EconomicCalendar.css";
import CalendarFilter from "./CalendarFilter";

const countryOptions = calendarCountries.map((country) => ({
  value: country.code,
  label: country.name,
  icon: countryCodeToFlag(country.code),
}));
const categoryOptions = calendarCategories.map((category) => ({
  value: category,
  label: category,
}));

type IconName =
  | "calendar"
  | "left"
  | "right"
  | "down"
  | "search"
  | "refresh"
  | "reset"
  | "filter"
  | "close"
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
    <Show when={props.name === "down"}>
      <path d="m6 9 6 6 6-6" />
    </Show>
    <Show when={props.name === "search"}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </Show>
    <Show when={props.name === "refresh"}>
      <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
    </Show>
    <Show when={props.name === "reset"}>
      <path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" />
    </Show>
    <Show when={props.name === "close"}>
      <path d="m6 6 12 12M6 18 18 6" />
    </Show>
    <Show when={props.name === "filter"}>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="2" fill="var(--color-brand-screen)" />
      <circle cx="15" cy="17" r="2" fill="var(--color-brand-screen)" />
    </Show>
    <Show when={props.name === "external"}>
      <path d="M14 4h6v6M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
    </Show>
  </svg>
);

const impactLabel = (importance: number) =>
  importance === 1
    ? "High impact"
    : importance === 0
      ? "Medium impact"
      : "Low impact";
const Impact: Component<{ importance: number }> = (props) => (
  <span
    class="calendar-impact"
    data-impact={props.importance}
    title={impactLabel(props.importance)}
    aria-label={impactLabel(props.importance)}
  >
    <For each={[0, 1, 2]}>
      {(level) => <i classList={{ filled: level <= props.importance + 1 }} />}
    </For>
  </span>
);
const eventValue = formatCalendarValue;
const eventCount = (count: number) =>
  `${count} ${count === 1 ? "event" : "events"}`;

const EventDetails: Component<{ event: CalendarEvent }> = (props) => (
  <div class="calendar-event-details" id={`calendar-details-${props.event.id}`}>
    <div>
      <span class="calendar-detail-label">About this release</span>
      <p>{props.event.description ?? "No release notes available."}</p>
      <Show when={props.event.source}>
        {(source) => (
          <a href={source().href} target="_blank" rel="noreferrer">
            {source().label}
            <Icon name="external" size={13} />
          </a>
        )}
      </Show>
    </div>
    <dl>
      <div>
        <dt>Country</dt>
        <dd>
          {calendarCountries.find(
            (country) => country.code === props.event.country,
          )?.name ?? props.event.country}
        </dd>
      </div>
      <div>
        <dt>Category</dt>
        <dd>{props.event.category}</dd>
      </div>
      <div>
        <dt>Impact</dt>
        <dd>{impactLabel(props.event.importance)}</dd>
      </div>
      <Show when={props.event.period}>
        <div>
          <dt>Reference period</dt>
          <dd>{props.event.period}</dd>
        </div>
      </Show>
    </dl>
  </div>
);

type WeekData = {
  week: string;
  events: CalendarEvent[];
  updatedAt?: number;
  error?: string;
};

const EconomicCalendar: Component = () => {
  const [now, setNow] = createSignal(new Date());
  const today = createMemo(() => calendarDateKey(now()));
  const currentWeek = createMemo(() => calendarWeekStart(today()));
  const [week, setWeek] = createSignal(currentWeek());
  const [day, setDay] = createSignal("week");
  const savedFilters = loadCalendarPreferences();
  const [countries, setCountries] = createSignal(savedFilters.countries);
  const [categories, setCategories] = createSignal(savedFilters.categories);
  const [impacts, setImpacts] = createSignal(savedFilters.impacts);
  const [query, setQuery] = createSignal("");
  const [expandedId, setExpandedId] = createSignal<string>();
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const [compact, setCompact] = createSignal(
    window.matchMedia("(max-width: 959px)").matches,
  );
  let filterDialog: HTMLDialogElement | undefined;
  const cache = new Map<string, WeekData>();
  let pending: AbortController | undefined;
  let eventsContainer: HTMLDivElement | undefined;

  createEffect(() => {
    saveCalendarPreferences({
      countries: countries(),
      categories: categories(),
      impacts: impacts(),
    });
  });

  const [calendar, { refetch }] = createResource(
    week,
    async (selectedWeek, info): Promise<WeekData> => {
      pending?.abort();
      const cached = cache.get(selectedWeek);
      if (
        !info.refetching &&
        cached?.updatedAt &&
        Date.now() - cached.updatedAt < 60_000
      )
        return cached;
      const controller = new AbortController();
      pending = controller;
      try {
        const events = await loadCalendarWeek(selectedWeek, controller.signal);
        const result = { week: selectedWeek, events, updatedAt: Date.now() };
        if (!controller.signal.aborted) {
          cache.set(selectedWeek, result);
          if (cache.size > 16) cache.delete(cache.keys().next().value!);
        }
        return result;
      } catch (error) {
        return {
          week: selectedWeek,
          events: cached?.events ?? [],
          updatedAt: cached?.updatedAt,
          error:
            error instanceof Error
              ? error.message
              : "The calendar could not be loaded.",
        };
      }
    },
  );
  const data = createMemo(() =>
    calendar.latest?.week === week() ? calendar.latest : undefined,
  );
  const events = createMemo(() => data()?.events ?? []);
  const filters = (): CalendarFilters => ({
    day: day(),
    countries: countries(),
    categories: categories(),
    impacts: impacts(),
    query: query(),
  });
  const weekEvents = createMemo(() =>
    filterCalendarEvents(events(), { ...filters(), day: "week" }),
  );
  const visibleEvents = createMemo(() =>
    filterCalendarEvents(events(), filters()),
  );
  const days = createMemo(() => calendarWeekDays(week()));
  const grouped = createMemo(() =>
    days()
      .map((item) => ({
        ...item,
        events: visibleEvents().filter((event) => event.day === item.key),
      }))
      .filter((item) => item.events.length),
  );
  const hasFilters = createMemo(
    () =>
      countries().length !== calendarCountries.length ||
      categories().length !== calendarCategories.length ||
      impacts().length !== 2 ||
      !impacts().includes("high") ||
      !impacts().includes("medium") ||
      query().trim() !== "" ||
      day() !== "week",
  );
  const emptySelection = createMemo(() =>
    !countries().length
      ? "countries"
      : !categories().length
        ? "categories"
        : !impacts().length
          ? "impact levels"
          : undefined,
  );

  const chooseWeek = (date: string) => {
    if (!date) return;
    try {
      setWeek(calendarWeekStart(date));
      setDay("week");
      setExpandedId(undefined);
      eventsContainer?.scrollTo({ top: 0 });
    } catch {
      /* A partially entered native date is not yet a valid selection. */
    }
  };
  const resetFilters = () => {
    const defaults = defaultCalendarPreferences();
    batch(() => {
      setCountries(defaults.countries);
      setCategories(defaults.categories);
      setImpacts(defaults.impacts);
      setQuery("");
      setDay("week");
    });
  };
  const selectDay = (value: string) => {
    setDay(value);
    setExpandedId(undefined);
    eventsContainer?.scrollTo({ top: 0 });
  };

  onMount(() => {
    const viewport = window.matchMedia("(max-width: 959px)");
    const updateViewport = () => setCompact(viewport.matches);
    viewport.addEventListener("change", updateViewport);
    onCleanup(() => viewport.removeEventListener("change", updateViewport));
    const refreshCurrentWeek = () => {
      setNow(new Date());
      if (!document.hidden && week() === currentWeek() && !calendar.loading)
        void refetch();
    };
    const timer = window.setInterval(refreshCurrentWeek, 60_000);
    document.addEventListener("visibilitychange", refreshCurrentWeek);
    onCleanup(() => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshCurrentWeek);
    });
  });
  onCleanup(() => pending?.abort());

  createEffect(() => {
    if (!compact()) {
      setFiltersOpen(false);
      return;
    }
    if (filtersOpen()) {
      if (filterDialog && !filterDialog.open) filterDialog.showModal();
    } else if (filterDialog?.open) {
      filterDialog.close();
    }
  });

  const FilterPanel: Component = () => (
    <div class="calendar-filter-panel">
      <header class="calendar-sidebar-heading">
        <h2>Filters</h2>
        <Show when={compact()}>
          <button
            type="button"
            class="calendar-icon-button"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
          >
            <Icon name="close" />
          </button>
        </Show>
      </header>
      <div class="calendar-sidebar-scroll">
        <CalendarFilter
          id="impacts"
          label="Impact"
          options={calendarImpacts.map((impact) => ({
            ...impact,
            icon: <Impact importance={impact.importance} />,
          }))}
          values={impacts()}
          onChange={setImpacts}
        />
        <CalendarFilter
          id="countries"
          label="Countries"
          options={countryOptions}
          values={countries()}
          onChange={setCountries}
        />
        <CalendarFilter
          id="categories"
          label="Categories"
          options={categoryOptions}
          values={categories()}
          onChange={setCategories}
        />
      </div>
      <footer class="calendar-sidebar-footer">
        <button
          type="button"
          class="calendar-reset-filters"
          disabled={!hasFilters()}
          onClick={resetFilters}
        >
          <Icon name="reset" size={14} />
          Reset filters
        </button>
        <Show when={compact()}>
          <button
            type="button"
            class="calendar-filter-done"
            onClick={() => setFiltersOpen(false)}
          >
            Done
          </button>
        </Show>
      </footer>
    </div>
  );

  return (
    <section
      class="economic-calendar"
      data-testid="calendar-view"
      aria-label="Economic calendar"
    >
      <h1 class="sr-only">Economic calendar</h1>
      <div class="calendar-window">
        <Show
          when={!compact()}
          fallback={
            <dialog
              ref={filterDialog}
              id="calendar-filter-dialog"
              class="calendar-filter-dialog"
              aria-label="Calendar filters"
              onClose={() => setFiltersOpen(false)}
              onClick={(event) => {
                if (event.target === event.currentTarget) setFiltersOpen(false);
              }}
            >
              <FilterPanel />
            </dialog>
          }
        >
          <aside class="calendar-sidebar" aria-label="Calendar filters">
            <FilterPanel />
          </aside>
        </Show>
        <div class="calendar-main">
          <div class="calendar-top">
            <header class="calendar-toolbar">
              <div
                class="calendar-range-presets"
                role="group"
                aria-label="Calendar range"
              >
                <button
                  type="button"
                  aria-pressed={week() === currentWeek()}
                  onClick={() => chooseWeek(today())}
                >
                  This week
                </button>
                <button
                  type="button"
                  aria-pressed={week() === addCalendarDays(currentWeek(), 7)}
                  onClick={() => chooseWeek(addCalendarDays(currentWeek(), 7))}
                >
                  Next week
                </button>
              </div>
              <div
                class="calendar-week-navigation"
                aria-label="Week navigation"
              >
                <button
                  class="calendar-icon-button"
                  type="button"
                  aria-label="Previous week"
                  title="Previous week"
                  onClick={() => chooseWeek(addCalendarDays(week(), -7))}
                >
                  <Icon name="left" />
                </button>
                <label class="calendar-date-picker" title="Jump to any week">
                  <Icon name="calendar" />
                  <span data-testid="calendar-week-label">
                    {calendarWeekLabel(week())}
                  </span>
                  <Icon name="down" size={12} />
                  <input
                    type="date"
                    aria-label="Jump to a date"
                    value={week()}
                    onChange={(event) => chooseWeek(event.currentTarget.value)}
                  />
                </label>
                <button
                  class="calendar-icon-button"
                  type="button"
                  aria-label="Next week"
                  title="Next week"
                  onClick={() => chooseWeek(addCalendarDays(week(), 7))}
                >
                  <Icon name="right" />
                </button>
              </div>
              <div class="calendar-toolbar-tools">
                <label class="calendar-search">
                  <Icon name="search" />
                  <input
                    type="search"
                    aria-label="Search events or countries"
                    placeholder="Search"
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                  />
                </label>
                <button
                  type="button"
                  class="calendar-icon-button calendar-mobile-filters"
                  aria-label="Show calendar filters"
                  aria-haspopup="dialog"
                  aria-expanded={filtersOpen()}
                  aria-controls="calendar-filter-dialog"
                  onClick={() => setFiltersOpen(true)}
                >
                  <Icon name="filter" />
                </button>
                <button
                  type="button"
                  class="calendar-icon-button calendar-refresh"
                  aria-label="Refresh calendar"
                  title="Refresh calendar"
                  disabled={calendar.loading}
                  onClick={() => void refetch()}
                >
                  <Show
                    when={calendar.loading}
                    fallback={<Icon name="refresh" />}
                  >
                    <span class="calendar-spinner" />
                  </Show>
                </button>
              </div>
            </header>
            <div class="calendar-day-bar">
              <div
                class="calendar-days"
                role="group"
                aria-label="Filter by day"
              >
                <button
                  type="button"
                  class="calendar-week-day"
                  aria-pressed={day() === "week"}
                  onClick={() => selectDay("week")}
                >
                  All week
                </button>
                <For each={days()}>
                  {(item) => {
                    const count = () =>
                      weekEvents().filter((event) => event.day === item.key)
                        .length;
                    return (
                      <button
                        type="button"
                        class="calendar-day"
                        classList={{ "is-today": item.key === today() }}
                        aria-label={`${item.label}${item.key === today() ? ", today" : ""}, ${eventCount(count())}`}
                        aria-pressed={day() === item.key}
                        title={eventCount(count())}
                        onClick={() => selectDay(item.key)}
                      >
                        <span>{item.weekday}</span>
                        <strong>{item.day}</strong>
                        <Show when={item.key === today()}>
                          <i class="calendar-today-dot" />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
              <span class="calendar-result-count" aria-live="polite">
                <Show
                  when={!(calendar.loading && !data())}
                  fallback={<span class="sr-only">Loading calendar</span>}
                >
                  {eventCount(visibleEvents().length)}
                </Show>
              </span>
            </div>
          </div>

          <div
            class="calendar-event-scroll"
            ref={eventsContainer}
            data-testid="calendar-events"
            aria-busy={calendar.loading}
          >
            <Show when={data()?.error}>
              <div class="calendar-error" role="alert">
                <div>
                  <strong>
                    {data()?.updatedAt
                      ? "Updates temporarily unavailable"
                      : "Unable to load this week"}
                  </strong>
                  <p>
                    {data()?.updatedAt
                      ? "Showing the last available data. Try refreshing in a moment."
                      : "The calendar provider did not respond. You can retry or choose another week."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={calendar.loading}
                  onClick={() => void refetch()}
                >
                  Try again
                </button>
              </div>
            </Show>
            <Show
              when={calendar.loading && !data()}
              fallback={
                <Show
                  when={visibleEvents().length > 0}
                  fallback={
                    <Show when={!data()?.error}>
                      <div class="calendar-empty">
                        <Icon name="calendar" size={28} />
                        <h2>
                          {emptySelection()
                            ? `Choose ${emptySelection()}`
                            : events().length > 0 || hasFilters()
                              ? "No matching events"
                              : "No releases published"}
                        </h2>
                        <p>
                          {emptySelection()
                            ? `Choose ${emptySelection()} in Filters.`
                            : events().length > 0 || hasFilters()
                              ? "Try another day, country or impact level."
                              : "Check another week or come back later."}
                        </p>
                        <Show when={hasFilters()}>
                          <button type="button" onClick={resetFilters}>
                            Reset filters
                          </button>
                        </Show>
                        <Show
                          when={
                            impacts().length < calendarImpacts.length &&
                            countries().length > 0 &&
                            categories().length > 0
                          }
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setImpacts(
                                calendarImpacts.map((impact) => impact.value),
                              );
                              setDay("week");
                            }}
                          >
                            Show all impact levels
                          </button>
                        </Show>
                      </div>
                    </Show>
                  }
                >
                  <div class="calendar-table-heading" aria-hidden="true">
                    <span>Time · {calendarTimeZoneLabel(week())}</span>
                    <span>Event</span>
                    <span>Impact</span>
                    <span>Actual</span>
                    <span>Forecast</span>
                    <span>Previous</span>
                    <span />
                  </div>
                  <For each={grouped()}>
                    {(group) => (
                      <section
                        class="calendar-event-group"
                        aria-label={group.label}
                      >
                        <h2 class="calendar-group-heading">
                          <span>
                            {group.label}
                            <Show when={group.key === today()}>
                              <small>Today</small>
                            </Show>
                          </span>
                        </h2>
                        <For each={group.events}>
                          {(event) => (
                            <article
                              class="calendar-event"
                              classList={{
                                "is-expanded": expandedId() === event.id,
                              }}
                            >
                              <button
                                type="button"
                                class="calendar-event-row"
                                data-testid={`calendar-event-${event.id}`}
                                aria-expanded={expandedId() === event.id}
                                aria-controls={`calendar-details-${event.id}`}
                                onClick={() =>
                                  setExpandedId((value) =>
                                    value === event.id ? undefined : event.id,
                                  )
                                }
                              >
                                <time
                                  class="calendar-event-time"
                                  dateTime={event.date}
                                >
                                  {event.time}
                                </time>
                                <span class="calendar-event-name">
                                  <span
                                    class="calendar-event-flag"
                                    role="img"
                                    aria-label={`${calendarCountries.find((country) => country.code === event.country)?.name ?? event.country} · ${event.currency ?? event.country}`}
                                    title={
                                      calendarCountries.find(
                                        (country) =>
                                          country.code === event.country,
                                      )?.name
                                    }
                                  >
                                    {countryCodeToFlag(event.country)}
                                  </span>
                                  <span class="calendar-event-title">
                                    <strong>{event.title}</strong>
                                    <Show when={event.period}>
                                      {" "}
                                      <span class="calendar-event-period">
                                        {event.period}
                                      </span>
                                    </Show>
                                  </span>
                                </span>
                                <span class="calendar-event-impact">
                                  <Impact importance={event.importance} />
                                </span>
                                <span
                                  class="calendar-value calendar-actual"
                                  classList={{
                                    "has-value": event.actual !== null,
                                  }}
                                >
                                  <small>Actual</small>
                                  {eventValue(event, "actual")}
                                </span>
                                <span class="calendar-value calendar-forecast">
                                  <small>Forecast</small>
                                  {eventValue(event, "forecast")}
                                </span>
                                <span class="calendar-value calendar-previous">
                                  <small>Previous</small>
                                  {eventValue(event, "previous")}
                                </span>
                                <span class="calendar-event-chevron">
                                  <Icon name="down" size={13} />
                                </span>
                              </button>
                              <Show when={expandedId() === event.id}>
                                <EventDetails event={event} />
                              </Show>
                            </article>
                          )}
                        </For>
                      </section>
                    )}
                  </For>
                </Show>
              }
            >
              <div
                class="calendar-loading"
                role="status"
                aria-label="Loading calendar"
              >
                <For each={[1, 2, 3, 4, 5, 6]}>
                  {() => (
                    <div>
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <footer class="calendar-footer">
            <span>
              Source:{" "}
              <a
                href="https://www.tradingview.com/economic-calendar/"
                target="_blank"
                rel="noreferrer"
              >
                TradingView
                <Icon name="external" size={11} />
              </a>
            </span>
            <Show when={data()?.updatedAt}>
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
      </div>
    </section>
  );
};

export default EconomicCalendar;
