import { Component, For, Show, createMemo, createSignal } from "solid-js";
import {
  calendarDays,
  economicCalendarEvents,
} from "../data/economicCalendar";
import type {
  CalendarCategory,
  CalendarCountry,
  CalendarImpact,
  EconomicCalendarEvent,
} from "../data/economicCalendar";

type DayFilter = "week" | (typeof calendarDays)[number]["date"];
type CountryFilter = "all" | CalendarCountry;
type CategoryFilter = "all" | CalendarCategory;

const IMPACT_LEVELS = [1, 2, 3] as const;

const countryMeta = {
  US: { flag: "🇺🇸", label: "United States" },
  CA: { flag: "🇨🇦", label: "Canada" },
} satisfies Record<CalendarCountry, { flag: string; label: string }>;

const impactLabel = (impact: CalendarImpact) => {
  if (impact === 3) return "High impact";
  if (impact === 2) return "Medium impact";
  return "Low impact";
};

const ImpactBars: Component<{ impact: CalendarImpact }> = (props) => (
  <span
    class="inline-flex h-4 items-end gap-[2px]"
    title={impactLabel(props.impact)}
    aria-hidden="true"
  >
    <For each={IMPACT_LEVELS}>
      {(level) => (
        <span
          class={`w-[3px] rounded-[1px] ${
            level <= props.impact
              ? props.impact === 3
                ? "bg-brand-red-400"
                : props.impact === 2
                  ? "bg-amber-300"
                  : "bg-brand-slate-500"
              : "bg-brand-border"
          }`}
          style={{ height: `${4 + level * 3}px` }}
        />
      )}
    </For>
  </span>
);

const CountryBadge: Component<{ event: EconomicCalendarEvent }> = (props) => (
  <span class="flex min-w-0 items-center gap-2.5">
    <span class="text-lg leading-none" aria-hidden="true">
      {countryMeta[props.event.country].flag}
    </span>
    <span class="min-w-0">
      <span class="block font-mono text-xs font-semibold text-slate-200">
        {props.event.currency}
      </span>
      <span class="block truncate text-[11px] text-brand-slate-500">
        {props.event.country}
      </span>
    </span>
  </span>
);

const ExternalLinkIcon: Component = () => (
  <svg
    aria-hidden="true"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

const EventDetails: Component<{ event: EconomicCalendarEvent }> = (props) => (
  <div class="grid gap-4 border-t border-brand-border/70 bg-brand-screen px-4 py-4 md:grid-cols-2 md:pl-[216px] md:pr-4 lg:pl-[232px] lg:pr-8">
    <div>
      <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-slate-500">
        Indicator
      </p>
      <p class="mt-1.5 text-[13px] leading-5 text-brand-slate-400">
        {props.event.description}
      </p>
    </div>
    <div>
      <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-slate-500">
        Market read
      </p>
      <p class="mt-1.5 text-[13px] leading-5 text-slate-300">
        {props.event.marketRead}
      </p>
      <a
        href={props.event.source.href}
        target="_blank"
        rel="noreferrer"
        class="mt-2 inline-flex items-center gap-1.5 text-xs text-brand-slate-400 transition-colors hover:text-slate-200"
      >
        {props.event.source.label}
        <ExternalLinkIcon />
      </a>
    </div>
  </div>
);

const CalendarIcon: Component = () => (
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
  </svg>
);

const SearchIcon: Component = () => (
  <svg
    aria-hidden="true"
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

const ChevronIcon: Component<{ open?: boolean }> = (props) => (
  <svg
    aria-hidden="true"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={`transition-transform ${props.open ? "rotate-180" : ""}`}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const EconomicCalendar: Component = () => {
  const [dayFilter, setDayFilter] = createSignal<DayFilter>("week");
  const [countryFilter, setCountryFilter] =
    createSignal<CountryFilter>("all");
  const [categoryFilter, setCategoryFilter] =
    createSignal<CategoryFilter>("all");
  const [highImpactOnly, setHighImpactOnly] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [selectedEventId, setSelectedEventId] = createSignal<string>();

  const filteredEvents = createMemo(() => {
    const normalizedQuery = query().trim().toLowerCase();

    return economicCalendarEvents.filter((event) => {
      if (dayFilter() !== "week" && event.date !== dayFilter()) return false;
      if (countryFilter() !== "all" && event.country !== countryFilter()) {
        return false;
      }
      if (categoryFilter() !== "all" && event.category !== categoryFilter()) {
        return false;
      }
      if (highImpactOnly() && event.impact !== 3) return false;
      if (
        normalizedQuery &&
        !`${event.event} ${event.currency} ${event.country} ${countryMeta[event.country].label} ${event.category}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });
  });

  const groupedEvents = createMemo(() =>
    calendarDays
      .map((day) => ({
        ...day,
        events: filteredEvents().filter((event) => event.date === day.date),
      }))
      .filter((day) => day.events.length > 0),
  );

  const highImpactCount = createMemo(
    () => filteredEvents().filter((event) => event.impact === 3).length,
  );

  const hasActiveFilters = createMemo(
    () =>
      dayFilter() !== "week" ||
      countryFilter() !== "all" ||
      categoryFilter() !== "all" ||
      highImpactOnly() ||
      query().trim().length > 0,
  );

  const resetFilters = () => {
    setDayFilter("week");
    setCountryFilter("all");
    setCategoryFilter("all");
    setHighImpactOnly(false);
    setQuery("");
  };

  const toggleEvent = (id: string) => {
    setSelectedEventId((current) => (current === id ? undefined : id));
  };

  return (
    <section
      data-testid="calendar-view"
      class="flex h-full min-h-0 flex-col overflow-hidden bg-brand-screen text-slate-200"
    >
      <header class="shrink-0 border-b border-brand-border bg-brand-screen px-4 py-5 sm:px-6 lg:px-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex items-start gap-4">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-brand-border bg-brand-surface text-brand-slate-300">
              <CalendarIcon />
            </span>
            <div>
              <h1 class="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">
                Economic calendar
              </h1>
            </div>
          </div>

          <div class="flex items-center gap-6 border-l border-brand-border py-1 pl-5 pr-1">
            <div>
              <p class="font-mono text-[10px] uppercase tracking-[0.08em] text-brand-slate-500">
                Events
              </p>
              <p class="mt-0.5 font-mono text-base font-semibold text-slate-100">
                {filteredEvents().length}
              </p>
            </div>
            <div class="h-9 w-px bg-brand-border" />
            <div>
              <p class="font-mono text-[10px] uppercase tracking-[0.08em] text-brand-slate-500">
                High impact
              </p>
              <p class="mt-0.5 font-mono text-base font-semibold text-brand-red-400">
                {highImpactCount()}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div class="shrink-0 border-b border-brand-border bg-brand-screen px-4 sm:px-6 lg:px-8">
        <div class="flex items-stretch overflow-x-auto">
          <button
            type="button"
            data-testid="calendar-day-week"
            class={`shrink-0 border-b-2 px-4 py-3 text-left transition-colors ${
              dayFilter() === "week"
                ? "border-brand-accent text-slate-100"
                : "border-transparent text-brand-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setDayFilter("week")}
          >
            <span class="block font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
              Week
            </span>
            <span class="mt-0.5 block text-xs">31 Aug–4 Sep</span>
          </button>
          <For each={calendarDays}>
            {(day) => (
              <button
                type="button"
                data-testid={`calendar-day-${day.date}`}
                class={`min-w-20 shrink-0 border-b-2 px-4 py-3 text-center transition-colors ${
                  dayFilter() === day.date
                    ? "border-brand-accent text-slate-100"
                    : "border-transparent text-brand-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setDayFilter(day.date)}
              >
                <span class="block font-mono text-[11px] font-semibold tracking-[0.08em]">
                  {day.weekday}
                </span>
                <span class="mt-0.5 block font-mono text-xs">
                  {day.day} {day.month}
                </span>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="shrink-0 border-b border-brand-border bg-brand-screen px-4 py-3 sm:px-6 lg:px-8">
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-3 py-2.5 text-brand-slate-500 transition-colors focus-within:border-brand-slate-600">
            <SearchIcon />
            <span class="sr-only">Search events</span>
            <input
              data-testid="calendar-search"
              type="search"
              value={query()}
              placeholder="Search events"
              class="min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-brand-slate-500"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>

          <label class="relative">
            <span class="sr-only">Country</span>
            <select
              data-testid="calendar-country-filter"
              value={countryFilter()}
              class="appearance-none rounded-md border border-brand-border bg-brand-surface py-2.5 pl-3 pr-9 text-sm text-slate-300 outline-none transition-colors hover:border-brand-slate-600 focus:border-brand-slate-600"
              onChange={(event) =>
                setCountryFilter(event.currentTarget.value as CountryFilter)
              }
            >
              <option value="all">All countries</option>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
            </select>
            <span class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-slate-500">
              <ChevronIcon />
            </span>
          </label>

          <label class="relative">
            <span class="sr-only">Category</span>
            <select
              data-testid="calendar-category-filter"
              value={categoryFilter()}
              class="appearance-none rounded-md border border-brand-border bg-brand-surface py-2.5 pl-3 pr-9 text-sm text-slate-300 outline-none transition-colors hover:border-brand-slate-600 focus:border-brand-slate-600"
              onChange={(event) =>
                setCategoryFilter(event.currentTarget.value as CategoryFilter)
              }
            >
              <option value="all">All categories</option>
              <option value="Labour">Labour</option>
              <option value="Growth">Growth</option>
              <option value="Central bank">Central bank</option>
            </select>
            <span class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-slate-500">
              <ChevronIcon />
            </span>
          </label>

          <button
            type="button"
            data-testid="calendar-high-impact-filter"
            aria-pressed={highImpactOnly()}
            class={`inline-flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm transition-colors ${
              highImpactOnly()
                ? "border-brand-red-400/40 bg-brand-surface text-brand-red-400"
                : "border-brand-border bg-brand-surface text-brand-slate-400 hover:border-brand-slate-600 hover:text-slate-200"
            }`}
            onClick={() => setHighImpactOnly((current) => !current)}
          >
            <ImpactBars impact={3} />
            High impact
          </button>

          <span class="inline-flex items-center rounded-md border border-brand-border bg-brand-surface px-3 py-2.5 font-mono text-xs text-brand-slate-500">
            BST · UTC+1
          </span>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto" data-testid="calendar-events">
        <Show
          when={filteredEvents().length > 0}
          fallback={
            <div class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <span class="flex h-10 w-10 items-center justify-center rounded border border-brand-border bg-brand-surface text-brand-slate-500">
                <CalendarIcon />
              </span>
              <p class="mt-4 text-base font-semibold text-slate-200">
                No events match these filters
              </p>
              <p class="mt-1 max-w-sm text-sm leading-5 text-brand-slate-500">
                Reset the period, country, category and impact controls to see
                the complete week.
              </p>
              <Show when={hasActiveFilters()}>
                <button
                  type="button"
                  class="mt-4 rounded-md border border-brand-border px-3 py-2 text-sm text-slate-300 transition-colors hover:border-brand-slate-600 hover:text-slate-100"
                  onClick={resetFilters}
                >
                  Reset filters
                </button>
              </Show>
            </div>
          }
        >
          <div class="hidden min-w-[820px] md:block">
            <div class="sticky top-0 z-20 grid grid-cols-[84px_116px_minmax(300px,1fr)_92px_92px_92px] border-b border-brand-border bg-brand-surface px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-slate-500 lg:px-8">
              <span>Time</span>
              <span>Country</span>
              <span>Event</span>
              <span class="text-right">Actual</span>
              <span class="text-right">Forecast</span>
              <span class="text-right">Prior</span>
            </div>

            <For each={groupedEvents()}>
              {(group) => (
                <section>
                  <div class="sticky top-[35px] z-10 flex items-center justify-between border-b border-brand-border bg-brand-screen px-4 py-2 lg:px-8">
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300">
                        {group.weekday} · {group.day} {group.month}
                      </span>
                      <span class="font-mono text-[10px] text-brand-slate-500">
                        2026
                      </span>
                    </div>
                    <span class="font-mono text-[10px] text-brand-slate-500">
                      {group.events.length} {group.events.length === 1 ? "event" : "events"}
                    </span>
                  </div>

                  <For each={group.events}>
                    {(event) => (
                      <article class="border-b border-brand-border/70">
                        <button
                          type="button"
                          data-testid={`calendar-event-${event.id}`}
                          aria-expanded={selectedEventId() === event.id}
                          class="group grid w-full grid-cols-[84px_116px_minmax(300px,1fr)_92px_92px_92px] items-center px-4 py-3.5 text-left transition-colors hover:bg-brand-surface/45 lg:px-8"
                          onClick={() => toggleEvent(event.id)}
                        >
                          <span class="font-mono text-sm font-semibold text-slate-200">
                            {event.time}
                          </span>
                          <CountryBadge event={event} />
                          <span class="flex min-w-0 items-center gap-3 pr-5">
                            <ImpactBars impact={event.impact} />
                            <span class="min-w-0">
                              <span class="flex min-w-0 items-center gap-2">
                                <span class="truncate text-sm font-medium text-slate-100 group-hover:text-white">
                                  {event.event}
                                </span>
                                <span class="shrink-0 rounded border border-brand-border px-1.5 py-0.5 font-mono text-[10px] text-brand-slate-500">
                                  {event.period}
                                </span>
                              </span>
                              <span class="mt-1 block font-mono text-[11px] text-brand-slate-500">
                                {event.category} · {impactLabel(event.impact)}
                              </span>
                            </span>
                          </span>
                          <span class="text-right font-mono text-[13px] font-semibold text-brand-accent">
                            {event.actual ?? "—"}
                          </span>
                          <span class="text-right font-mono text-[13px] text-slate-300">
                            {event.forecast ?? "—"}
                          </span>
                          <span class="flex items-center justify-end gap-2 text-right font-mono text-[13px] text-brand-slate-400">
                            {event.prior ?? "—"}
                            <ChevronIcon open={selectedEventId() === event.id} />
                          </span>
                        </button>
                        <Show when={selectedEventId() === event.id}>
                          <EventDetails event={event} />
                        </Show>
                      </article>
                    )}
                  </For>
                </section>
              )}
            </For>
          </div>

          <div class="md:hidden">
            <For each={groupedEvents()}>
              {(group) => (
                <section>
                  <div class="sticky top-0 z-10 flex items-center justify-between border-b border-brand-border bg-brand-screen px-4 py-2.5">
                    <span class="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300">
                      {group.weekday} · {group.day} {group.month}
                    </span>
                    <span class="font-mono text-[10px] text-brand-slate-500">
                      {group.events.length} {group.events.length === 1 ? "event" : "events"}
                    </span>
                  </div>
                  <For each={group.events}>
                    {(event) => (
                      <article class="border-b border-brand-border/70">
                        <button
                          type="button"
                          aria-expanded={selectedEventId() === event.id}
                          class="w-full px-4 py-4 text-left transition-colors hover:bg-brand-surface/50"
                          onClick={() => toggleEvent(event.id)}
                        >
                          <div class="flex items-start justify-between gap-3">
                            <div class="flex items-center gap-3">
                              <span class="font-mono text-sm font-semibold text-slate-100">
                                {event.time}
                              </span>
                              <CountryBadge event={event} />
                            </div>
                            <div class="flex items-center gap-3">
                              <ImpactBars impact={event.impact} />
                              <ChevronIcon open={selectedEventId() === event.id} />
                            </div>
                          </div>
                          <div class="mt-3">
                            <div class="flex items-center gap-2">
                              <span class="text-[15px] font-medium text-slate-100">
                                {event.event}
                              </span>
                              <span class="rounded border border-brand-border px-1.5 py-0.5 font-mono text-[10px] text-brand-slate-500">
                                {event.period}
                              </span>
                            </div>
                            <p class="mt-1 font-mono text-[11px] text-brand-slate-500">
                              {event.category} · {impactLabel(event.impact)}
                            </p>
                          </div>
                          <div class="mt-3 grid grid-cols-3 border-y border-brand-border bg-brand-surface">
                            <For
                              each={[
                                ["Actual", event.actual ?? "—"],
                                ["Forecast", event.forecast ?? "—"],
                                ["Prior", event.prior ?? "—"],
                              ]}
                            >
                              {(value, index) => (
                                <span
                                  class={`px-3 py-2 ${index() > 0 ? "border-l border-brand-border" : ""}`}
                                >
                                  <span class="block font-mono text-[10px] uppercase tracking-[0.08em] text-brand-slate-500">
                                    {value[0]}
                                  </span>
                                  <span
                                    class={`mt-1 block font-mono text-[13px] ${index() === 0 ? "text-brand-accent" : "text-slate-300"}`}
                                  >
                                    {value[1]}
                                  </span>
                                </span>
                              )}
                            </For>
                          </div>
                        </button>
                        <Show when={selectedEventId() === event.id}>
                          <EventDetails event={event} />
                        </Show>
                      </article>
                    )}
                  </For>
                </section>
              )}
            </For>
          </div>
        </Show>
      </div>

      <footer class="shrink-0 border-t border-brand-border bg-brand-screen px-4 py-2.5 font-mono text-[11px] leading-5 text-brand-slate-500 sm:px-6 lg:px-8">
        Scheduled times are converted to Europe/London from BLS, ISM and Bank
        of Canada calendars. Consensus is shown only where explicitly sourced.
        Data is not live.
      </footer>
    </section>
  );
};

export default EconomicCalendar;
