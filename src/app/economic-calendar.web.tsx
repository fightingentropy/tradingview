import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, type ReactNode } from 'react';

import { useEconomicCalendarRange } from '@/data/useEconomicCalendar';
import {
  DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES,
  ECONOMIC_CALENDAR_COUNTRIES,
  ECONOMIC_CALENDAR_COUNTRY_CODES,
  countryCodeToFlag,
  economicCalendarDateFromKey,
  economicCalendarDateKey,
  economicCalendarEventDescriptor,
  filterEconomicCalendarEvents,
  formatEconomicCalendarValue,
  type EconomicCalendarEvent,
  type EconomicCalendarImportance,
} from '@/domain/economicCalendar';
import { useEconomicCalendarFilters } from '@/store/economicCalendarFilters';

type RangePreset = 'this-week' | 'this-month' | 'next-week' | 'next-month' | 'custom';

type CalendarRange = {
  from: Date;
  to: Date;
};

const MAX_CUSTOM_RANGE_DAYS = 45;

const IMPACTS: { value: EconomicCalendarImportance; label: string; className: string }[] = [
  { value: -1, label: 'Low', className: 'is-low' },
  { value: 0, label: 'Medium', className: 'is-medium' },
  { value: 1, label: 'High', className: 'is-high' },
];

const RANGE_PRESETS: { value: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
  { value: 'next-week', label: 'Next week' },
  { value: 'next-month', label: 'Next month' },
];

const COUNTRY_NAME = new Map<string, string>(
  ECONOMIC_CALENDAR_COUNTRIES.map(({ code, name }) => [code, name] as const),
);

function dateAtNoon(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function rangeForPreset(preset: Exclude<RangePreset, 'custom'>, today: Date): CalendarRange {
  if (preset === 'this-week') {
    const from = startOfWeek(today);
    return { from, to: addDays(from, 6) };
  }
  if (preset === 'next-week') {
    const from = addDays(startOfWeek(today), 7);
    return { from, to: addDays(from, 6) };
  }
  const monthOffset = preset === 'next-month' ? 1 : 0;
  const from = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1, 12);
  const to = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0, 12);
  return { from, to };
}

function sameSelection<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function formatRange({ from, to }: CalendarRange) {
  const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
  const start = new Intl.DateTimeFormat(undefined, sameMonth
    ? { day: 'numeric' }
    : { day: 'numeric', month: 'short' }).format(from);
  const end = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(to);
  return `${start} – ${end}`;
}

function formatGroupDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function impactMeta(importance: EconomicCalendarImportance) {
  return IMPACTS.find((option) => option.value === importance) ?? IMPACTS[0];
}

function ImpactBars({ importance, labelled = true }: { importance: EconomicCalendarImportance; labelled?: boolean }) {
  const meta = impactMeta(importance);
  return (
    <span
      className={`web-xyz-calendar-impact ${meta.className}`}
      aria-label={labelled ? `${meta.label} impact` : undefined}
      aria-hidden={labelled ? undefined : true}>
      <i /><i /><i />
    </span>
  );
}

function FilterCheck({
  checked,
  mixed = false,
  label,
  detail,
  onClick,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  detail?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`web-xyz-calendar-filter-option${detail ? ' has-detail' : ''}${checked ? ' is-checked' : ''}${mixed ? ' is-mixed' : ''}`}
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      onClick={onClick}>
      {detail}
      <span>{label}</span>
      <i aria-hidden="true"><Ionicons name={checked ? 'checkmark' : mixed ? 'remove' : 'checkmark'} size={12} color="currentColor" /></i>
    </button>
  );
}

export default function WebEconomicCalendarScreen() {
  const today = useMemo(() => dateAtNoon(new Date()), []);
  const [preset, setPreset] = useState<RangePreset>('this-week');
  const [range, setRange] = useState<CalendarRange>(() => rangeForPreset('this-week', today));
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => economicCalendarDateKey(range.from));
  const [customTo, setCustomTo] = useState(() => economicCalendarDateKey(range.to));

  const selectedCountries = useEconomicCalendarFilters((state) => state.selectedCountries);
  const selectedImportances = useEconomicCalendarFilters((state) => state.selectedImportances);
  const setFilters = useEconomicCalendarFilters((state) => state.setFilters);
  const [draftCountries, setDraftCountries] = useState<string[]>(() => [...selectedCountries]);
  const [draftImportances, setDraftImportances] = useState<EconomicCalendarImportance[]>(() => [...selectedImportances]);

  const fromDateKey = economicCalendarDateKey(range.from);
  const toDateKey = economicCalendarDateKey(range.to);
  const { data = [], isLoading, isError, refetch, isRefetching } =
    useEconomicCalendarRange(fromDateKey, toDateKey);

  const events = useMemo(
    () => filterEconomicCalendarEvents(data, selectedCountries, selectedImportances),
    [data, selectedCountries, selectedImportances],
  );

  const groups = useMemo(() => {
    const grouped = new Map<string, EconomicCalendarEvent[]>();
    events.forEach((event) => {
      const key = economicCalendarDateKey(new Date(event.date));
      const existing = grouped.get(key);
      if (existing) existing.push(event);
      else grouped.set(key, [event]);
    });
    return [...grouped.entries()].map(([key, groupedEvents]) => ({
      key,
      date: economicCalendarDateFromKey(key),
      events: groupedEvents,
    }));
  }, [events]);

  const allImpactsSelected = draftImportances.length === IMPACTS.length;
  const allCountriesSelected = draftCountries.length === ECONOMIC_CALENDAR_COUNTRY_CODES.length;
  const hasValidDraft = draftImportances.length > 0 && draftCountries.length > 0;
  const filtersDirty = !sameSelection(draftCountries, selectedCountries)
    || !sameSelection(draftImportances, selectedImportances);
  const customRangeValid = Boolean(customFrom && customTo)
    && customFrom <= customTo
    && (Date.parse(customTo) - Date.parse(customFrom)) / (24 * 60 * 60 * 1000)
      < MAX_CUSTOM_RANGE_DAYS;
  const customMaxTo = customFrom
    ? economicCalendarDateKey(addDays(economicCalendarDateFromKey(customFrom), MAX_CUSTOM_RANGE_DAYS - 1))
    : undefined;

  const selectPreset = (nextPreset: Exclude<RangePreset, 'custom'>) => {
    const nextRange = rangeForPreset(nextPreset, today);
    setPreset(nextPreset);
    setRange(nextRange);
    setCustomFrom(economicCalendarDateKey(nextRange.from));
    setCustomTo(economicCalendarDateKey(nextRange.to));
    setCustomOpen(false);
  };

  const applyCustomRange = () => {
    if (!customRangeValid) return;
    setRange({
      from: economicCalendarDateFromKey(customFrom),
      to: economicCalendarDateFromKey(customTo),
    });
    setPreset('custom');
    setCustomOpen(false);
  };

  const toggleImpact = (importance: EconomicCalendarImportance) => {
    setDraftImportances((current) => current.includes(importance)
      ? current.filter((item) => item !== importance)
      : [...current, importance]);
  };

  const toggleCountry = (country: string) => {
    setDraftCountries((current) => current.includes(country)
      ? current.filter((item) => item !== country)
      : [...current, country]);
  };

  const applyFilters = () => {
    if (!hasValidDraft) return;
    setFilters(draftCountries, draftImportances);
  };

  const resetFilters = () => {
    const countries = [...ECONOMIC_CALENDAR_COUNTRY_CODES];
    const importances = [...DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES];
    setDraftCountries(countries);
    setDraftImportances(importances);
    setFilters(countries, importances);
  };

  return (
    <div className="web-xyz-calendar-page">
      <div className="web-xyz-calendar-shell">
        <aside className="web-xyz-calendar-filters" aria-label="Calendar filters">
          <div className="web-xyz-calendar-filter-heading"><span>Filters</span><small>{events.length} events</small></div>

          <section>
            <header><span>Impact</span><small>{draftImportances.length} selected</small></header>
            <FilterCheck
              label="All impact"
              checked={allImpactsSelected}
              mixed={!allImpactsSelected && draftImportances.length > 0}
              onClick={() => setDraftImportances(allImpactsSelected ? [] : IMPACTS.map(({ value }) => value))}
            />
            {IMPACTS.map((option) => (
              <FilterCheck
                key={option.value}
                label={option.label}
                checked={draftImportances.includes(option.value)}
                detail={<ImpactBars importance={option.value} labelled={false} />}
                onClick={() => toggleImpact(option.value)}
              />
            ))}
          </section>

          <section className="web-xyz-calendar-region-filter">
            <header><span>Region</span><small>{draftCountries.length} selected</small></header>
            <FilterCheck
              label="All regions"
              checked={allCountriesSelected}
              mixed={!allCountriesSelected && draftCountries.length > 0}
              detail={<span className="web-xyz-calendar-globe"><Ionicons name="globe-outline" size={16} color="currentColor" /></span>}
              onClick={() => setDraftCountries(allCountriesSelected ? [] : [...ECONOMIC_CALENDAR_COUNTRY_CODES])}
            />
            <div className="web-xyz-calendar-country-list">
              {ECONOMIC_CALENDAR_COUNTRIES.map((country) => (
                <FilterCheck
                  key={country.code}
                  label={country.name}
                  checked={draftCountries.includes(country.code)}
                  detail={<span className="web-xyz-calendar-filter-flag">{countryCodeToFlag(country.code)}</span>}
                  onClick={() => toggleCountry(country.code)}
                />
              ))}
            </div>
          </section>

          <div className="web-xyz-calendar-filter-actions">
            <button type="button" className="is-apply" disabled={!hasValidDraft || !filtersDirty} onClick={applyFilters}>
              Apply
            </button>
            <button type="button" className="is-reset" onClick={resetFilters}>Reset filters</button>
          </div>
        </aside>

        <main className="web-xyz-calendar-main">
          <div className="web-xyz-calendar-toolbar">
            <nav aria-label="Calendar date presets">
              {RANGE_PRESETS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={preset === option.value ? 'is-active' : ''}
                  onClick={() => selectPreset(option.value)}>
                  {option.label}
                </button>
              ))}
            </nav>
            <div className="web-xyz-calendar-date-control">
              <button type="button" className={preset === 'custom' ? 'is-active' : ''} aria-expanded={customOpen} onClick={() => setCustomOpen((open) => !open)}>
                <Ionicons name="calendar-clear-outline" size={14} color="currentColor" /> {formatRange(range)} <Ionicons name="chevron-down" size={12} color="currentColor" />
              </button>
              {customOpen ? (
                <div className="web-xyz-calendar-date-popover">
                  <label><span>From</span><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
                  <label><span>To</span><input type="date" min={customFrom} max={customMaxTo} value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
                  <small>Choose up to {MAX_CUSTOM_RANGE_DAYS} days.</small>
                  <button type="button" disabled={!customRangeValid} onClick={applyCustomRange}>Apply range</button>
                </div>
              ) : null}
            </div>
            <button className="web-xyz-calendar-refresh" type="button" onClick={() => void refetch()} disabled={isRefetching} aria-label="Refresh calendar">
              <Ionicons name="refresh" size={15} color="currentColor" />
            </button>
          </div>

          <div className="web-xyz-calendar-table" role="table" aria-label="Economic calendar events">
            <div className="web-xyz-calendar-table-head" role="row">
              <span role="columnheader">Time</span>
              <span role="columnheader">Event</span>
              <span role="columnheader">Impact</span>
              <span role="columnheader">Actual</span>
              <span role="columnheader">Forecast</span>
              <span role="columnheader">Prior</span>
            </div>

            {isLoading ? (
              <div className="web-xyz-calendar-loading" aria-label="Loading calendar events">
                {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
              </div>
            ) : isError ? (
              <div className="web-xyz-calendar-state">
                <Ionicons name="cloud-offline-outline" size={22} color="currentColor" />
                <h2>Calendar feed unavailable</h2>
                <p>The live macro feed could not be loaded. Your filters were kept.</p>
                <button type="button" onClick={() => void refetch()}>Try again</button>
              </div>
            ) : groups.length === 0 ? (
              <div className="web-xyz-calendar-state">
                <Ionicons name="filter-outline" size={22} color="currentColor" />
                <h2>No matching events</h2>
                <p>Try a wider date range or change the filters on the left.</p>
              </div>
            ) : groups.map((group) => (
              <section className="web-xyz-calendar-day" key={group.key} role="rowgroup">
                <header><h2>{formatGroupDate(group.date)}</h2><span>{group.events.length} {group.events.length === 1 ? 'event' : 'events'}</span></header>
                {group.events.map((event) => {
                  const descriptor = economicCalendarEventDescriptor(event);
                  const meta = impactMeta(event.importance);
                  return (
                    <div className="web-xyz-calendar-row" role="row" key={event.id}>
                      <time role="cell">{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(event.date))}</time>
                      <div className="web-xyz-calendar-event-name" role="cell">
                        <span className="web-xyz-calendar-event-flag" aria-label={COUNTRY_NAME.get(event.country) ?? event.country}>{countryCodeToFlag(event.country)}</span>
                        <div><strong>{event.title}{event.period && !event.title.includes(event.period) ? ` (${event.period})` : ''}</strong><small>{COUNTRY_NAME.get(event.country) ?? event.country}{event.currency ? ` · ${event.currency}` : ''}{descriptor ? ` · ${descriptor}` : ''}</small></div>
                      </div>
                      <div className="web-xyz-calendar-impact-cell" role="cell"><ImpactBars importance={event.importance} /><small>{meta.label}</small></div>
                      <strong className={event.actual !== null ? 'web-xyz-calendar-actual has-value' : 'web-xyz-calendar-actual'} role="cell">{formatEconomicCalendarValue(event.actual, event.unit)}</strong>
                      <span role="cell">{formatEconomicCalendarValue(event.forecast, event.unit)}</span>
                      <span role="cell">{formatEconomicCalendarValue(event.previous, event.unit)}</span>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
