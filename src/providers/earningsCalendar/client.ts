import { parseEarningsCalendar, type EarningsCalendar } from '@/domain/earningsCalendar';

// The web Worker maps TradingView's screener and caches each week; the app never calls it directly.
const DEFAULT_EARNINGS_CALENDAR_URL =
  'https://tradingview-web.erlinhoxha.workers.dev/api/earnings-calendar';
const EARNINGS_CALENDAR_URL =
  process.env.EXPO_PUBLIC_EARNINGS_CALENDAR_URL?.trim() || DEFAULT_EARNINGS_CALENDAR_URL;

export async function loadEarningsCalendar(
  fromDateKey: string,
  toDateKey: string,
): Promise<EarningsCalendar> {
  const url = new URL(EARNINGS_CALENDAR_URL);
  url.searchParams.set('from', fromDateKey);
  url.searchParams.set('to', toDateKey);
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Earnings calendar returned ${response.status}`);
  return parseEarningsCalendar(await response.json());
}
