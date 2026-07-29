import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countryCodeToFlag,
  economicCalendarDateFromKey,
  economicCalendarDateKey,
  economicCalendarDayRange,
  economicCalendarEventDescriptor,
  filterEconomicCalendarEvents,
  formatEconomicCalendarValue,
  parseEconomicCalendarEvents,
} from '../src/domain/economicCalendar.ts';

test('parses and chronologically sorts valid economic events', () => {
  const events = parseEconomicCalendarEvents({
    result: [
      {
        id: 'fed',
        title: 'Fed Interest Rate Decision',
        country: 'us',
        date: '2026-07-29T18:00:00.000Z',
        actual: null,
        forecast: 3.75,
        previous: 3.75,
        importance: 1,
        unit: '%',
      },
      {
        id: 'cpi',
        title: 'Consumer Price Index',
        country: 'AU',
        date: '2026-07-29T01:30:00.000Z',
        actual: 3.8,
        forecast: 4,
        previous: 4,
        importance: 0,
        period: 'Jun',
      },
      { id: 'broken' },
    ],
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].id, 'cpi');
  assert.equal(events[1].country, 'US');
  assert.equal(events[1].importance, 1);
});

test('keeps local date keys and returns a one-day local range', () => {
  const date = economicCalendarDateFromKey('2026-07-29');
  assert.equal(economicCalendarDateKey(date), '2026-07-29');
  const range = economicCalendarDayRange('2026-07-29');
  assert.equal(
    (Date.parse(range.to) - Date.parse(range.from)) / (60 * 60 * 1000),
    24,
  );
});

test('formats values, flags, and event-only descriptors', () => {
  assert.equal(formatEconomicCalendarValue(3.75, '%'), '3.75%');
  assert.equal(formatEconomicCalendarValue(20, '£'), '£20');
  assert.equal(formatEconomicCalendarValue(null, '%'), '–');
  assert.equal(countryCodeToFlag('US'), '🇺🇸');
  assert.equal(
    economicCalendarEventDescriptor({
      id: 'press',
      title: 'FOMC Press Conference',
      country: 'US',
      date: '2026-07-29T18:30:00.000Z',
      actual: null,
      forecast: null,
      previous: null,
      importance: 1,
    }),
    'Speech',
  );
});

test('filters events by both country and severity', () => {
  const events = parseEconomicCalendarEvents({
    result: [
      {
        id: 'us-high',
        title: 'Fed Decision',
        country: 'US',
        date: '2026-07-29T18:00:00.000Z',
        importance: 1,
      },
      {
        id: 'us-low',
        title: 'Bill Auction',
        country: 'US',
        date: '2026-07-29T15:30:00.000Z',
        importance: -1,
      },
      {
        id: 'gb-high',
        title: 'BoE Decision',
        country: 'GB',
        date: '2026-07-29T11:00:00.000Z',
        importance: 1,
      },
    ],
  });

  assert.deepEqual(
    filterEconomicCalendarEvents(events, ['US'], [1]).map((event) => event.id),
    ['us-high'],
  );
  assert.deepEqual(
    filterEconomicCalendarEvents(events, ['US', 'GB'], [-1, 1]).map((event) => event.id),
    ['gb-high', 'us-low', 'us-high'],
  );
});
