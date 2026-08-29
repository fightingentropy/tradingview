import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';

import { useEconomicCalendar } from '@/data/useEconomicCalendar';
import {
  countryCodeToFlag,
  economicCalendarDateKey,
  economicCalendarEventDescriptor,
  filterEconomicCalendarEvents,
  formatEconomicCalendarValue,
  type EconomicCalendarImportance,
} from '@/domain/economicCalendar';
import { useEconomicCalendarFilters } from '@/store/economicCalendarFilters';

function offsetDate(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

const importanceLabel = (importance: EconomicCalendarImportance) => importance === 1 ? 'High' : importance === 0 ? 'Medium' : 'Low';

export default function WebEconomicCalendarScreen() {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [impact, setImpact] = useState<'all' | 'high'>('all');
  const dateKey = economicCalendarDateKey(selectedDate);
  const { data, isLoading, isError, refetch } = useEconomicCalendar(dateKey);
  const countries = useEconomicCalendarFilters((state) => state.selectedCountries);
  const storedImportances = useEconomicCalendarFilters((state) => state.selectedImportances);
  const events = useMemo(
    () =>
      filterEconomicCalendarEvents(
        data ?? [],
        countries,
        impact === 'high' ? ([1] as EconomicCalendarImportance[]) : storedImportances,
      ),
    [countries, data, impact, storedImportances],
  );
  const week = useMemo(() => Array.from({ length: 7 }, (_, index) => offsetDate(selectedDate, index - 3)), [selectedDate]);

  return (
    <div className="web-content-stack">
      <section className="web-calendar-header">
        <div><Link href="/news" className="web-back-link"><Ionicons name="arrow-back" size={15} color="currentColor" /> News pulse</Link><span className="web-section-kicker">ECONOMIC CALENDAR</span><h2>Events that can move the tape.</h2><p>Major releases and central-bank events, ordered in your local time.</p></div>
        <div className="web-calendar-actions"><button type="button" onClick={() => setSelectedDate(new Date())}>Today</button><button type="button" onClick={() => void refetch()} aria-label="Refresh calendar"><Ionicons name="refresh" size={16} color="currentColor" /></button></div>
      </section>

      <section className="web-calendar-week web-panel">
        {week.map((date) => {
          const active = economicCalendarDateKey(date) === dateKey;
          return <button key={economicCalendarDateKey(date)} type="button" className={active ? 'is-active' : ''} onClick={() => setSelectedDate(date)}><span>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)}</span><strong>{date.getDate()}</strong><small>{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date)}</small></button>;
        })}
      </section>

      <div className="web-calendar-layout">
        <section className="web-calendar-events web-panel">
          <div className="web-panel-heading"><div><span className="web-section-kicker">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(selectedDate).toUpperCase()}</span><h2>{events.length} events</h2></div><div className="web-mini-tabs"><button type="button" className={impact === 'all' ? 'is-active' : ''} onClick={() => setImpact('all')}>All impact</button><button type="button" className={impact === 'high' ? 'is-active' : ''} onClick={() => setImpact('high')}>High only</button></div></div>
          {isLoading ? Array.from({ length: 7 }, (_, index) => <span className="web-calendar-skeleton" key={index} />) : isError ? <div className="web-inline-state"><p>The calendar feed is unavailable.</p><button type="button" onClick={() => void refetch()}>Retry</button></div> : events.length === 0 ? <div className="web-inline-state"><p>No selected events for this date.</p></div> : events.map((event) => {
            const descriptor = economicCalendarEventDescriptor(event);
            return (
              <article className="web-calendar-event" key={event.id}>
                <time>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(event.date))}</time>
                <span className="web-calendar-flag" aria-label={event.country}>{countryCodeToFlag(event.country)}</span>
                <div className="web-calendar-event-body"><div><span className={`web-impact-bars is-${event.importance}`} aria-label={`${importanceLabel(event.importance)} impact`}><i /><i /><i /></span><h3>{event.title}{event.period && !event.title.includes(event.period) ? ` · ${event.period}` : ''}</h3></div>{descriptor ? <p>{descriptor}</p> : <div className="web-calendar-values"><span><small>Actual</small><strong>{formatEconomicCalendarValue(event.actual, event.unit)}</strong></span><span><small>Forecast</small><strong>{formatEconomicCalendarValue(event.forecast, event.unit)}</strong></span><span><small>Prior</small><strong>{formatEconomicCalendarValue(event.previous, event.unit)}</strong></span></div>}</div>
              </article>
            );
          })}
        </section>

        <aside className="web-calendar-side web-panel">
          <span className="web-section-kicker">FILTER SUMMARY</span>
          <div><span>Countries</span><strong>{countries.length}</strong></div>
          <div><span>Impact</span><strong>{impact === 'high' ? 'High' : 'Medium + high'}</strong></div>
          <div><span>Timezone</span><strong>{Intl.DateTimeFormat().resolvedOptions().timeZone}</strong></div>
          <p><Ionicons name="time-outline" size={15} color="currentColor" /> All event times are converted to your browser’s local timezone.</p>
        </aside>
      </div>
    </div>
  );
}
