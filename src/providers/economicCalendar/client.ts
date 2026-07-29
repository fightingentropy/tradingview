import {
  ECONOMIC_CALENDAR_COUNTRIES,
  economicCalendarDayRange,
  parseEconomicCalendarEvents,
  type EconomicCalendarEvent,
} from '@/domain/economicCalendar';

const OFFICIAL_CALENDAR_URL = 'https://economic-calendar.tradingview.com/events';
const ECONOMIC_CALENDAR_URL =
  process.env.EXPO_PUBLIC_ECONOMIC_CALENDAR_URL?.trim() || OFFICIAL_CALENDAR_URL;
const MAJOR_ECONOMIES = ECONOMIC_CALENDAR_COUNTRIES.map((country) => country.code).join(',');

export async function loadEconomicCalendar(dateKey: string): Promise<EconomicCalendarEvent[]> {
  const { from, to } = economicCalendarDayRange(dateKey);
  const url = new URL(ECONOMIC_CALENDAR_URL);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('countries', MAJOR_ECONOMIES);
  url.searchParams.set('minImportance', '-1');

  const isOfficialEndpoint = url.origin === new URL(OFFICIAL_CALENDAR_URL).origin;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(isOfficialEndpoint
        ? {
            Origin: 'https://www.tradingview.com',
            Referer: 'https://www.tradingview.com/',
          }
        : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Economic calendar returned ${response.status}`);

  const raw = (await response.json()) as unknown;
  return parseEconomicCalendarEvents(raw);
}
