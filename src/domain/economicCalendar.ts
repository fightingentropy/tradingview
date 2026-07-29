export const ECONOMIC_CALENDAR_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'EU', name: 'Euro Area' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'JP', name: 'Japan' },
  { code: 'CN', name: 'China' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'IN', name: 'India' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'TR', name: 'Türkiye' },
] as const;

export type EconomicCalendarImportance = -1 | 0 | 1;

export const ECONOMIC_CALENDAR_COUNTRY_CODES = ECONOMIC_CALENDAR_COUNTRIES.map(
  ({ code }) => code,
);

export const DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES: EconomicCalendarImportance[] = [0, 1];

const VALID_ECONOMIC_CALENDAR_COUNTRY_CODES = new Set<string>(
  ECONOMIC_CALENDAR_COUNTRY_CODES,
);
const VALID_ECONOMIC_CALENDAR_IMPORTANCES = new Set<EconomicCalendarImportance>([-1, 0, 1]);

export type EconomicCalendarEvent = {
  id: string;
  title: string;
  country: string;
  period?: string;
  date: string;
  actual: number | string | null;
  forecast: number | string | null;
  previous: number | string | null;
  unit?: string;
  currency?: string;
  importance: EconomicCalendarImportance;
};

type UnknownRecord = Record<string, unknown>;

export function normalizeEconomicCalendarCountries(value: unknown): string[] {
  if (!Array.isArray(value)) return [...ECONOMIC_CALENDAR_COUNTRY_CODES];
  const countries = [...new Set(
    value
      .filter((country): country is string => typeof country === 'string')
      .map((country) => country.toUpperCase())
      .filter((country) => VALID_ECONOMIC_CALENDAR_COUNTRY_CODES.has(country)),
  )];
  return countries.length > 0 ? countries : [...ECONOMIC_CALENDAR_COUNTRY_CODES];
}

export function normalizeEconomicCalendarImportances(
  value: unknown,
): EconomicCalendarImportance[] {
  if (!Array.isArray(value)) return [...DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES];
  const importances = [...new Set(
    value.filter(
      (importance): importance is EconomicCalendarImportance =>
        typeof importance === 'number' &&
        VALID_ECONOMIC_CALENDAR_IMPORTANCES.has(importance as EconomicCalendarImportance),
    ),
  )].sort((left, right) => left - right);
  return importances.length > 0
    ? importances
    : [...DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES];
}

function parseValue(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function parseEvent(value: unknown): EconomicCalendarEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as UnknownRecord;
  if (
    typeof event.id !== 'string' ||
    typeof event.title !== 'string' ||
    typeof event.country !== 'string' ||
    typeof event.date !== 'string' ||
    !Number.isFinite(Date.parse(event.date))
  ) {
    return null;
  }

  const rawImportance =
    typeof event.importance === 'number' && Number.isFinite(event.importance)
      ? Math.round(event.importance)
      : -1;

  return {
    id: event.id,
    title: event.title,
    country: event.country.toUpperCase(),
    period: typeof event.period === 'string' && event.period.trim()
      ? event.period.trim()
      : undefined,
    date: event.date,
    actual: parseValue(event.actual),
    forecast: parseValue(event.forecast),
    previous: parseValue(event.previous),
    unit: typeof event.unit === 'string' && event.unit.trim() ? event.unit.trim() : undefined,
    currency:
      typeof event.currency === 'string' && event.currency.trim()
        ? event.currency.trim()
        : undefined,
    importance: Math.max(-1, Math.min(1, rawImportance)) as -1 | 0 | 1,
  };
}

export function parseEconomicCalendarEvents(value: unknown): EconomicCalendarEvent[] {
  if (!value || typeof value !== 'object') return [];
  const result = (value as UnknownRecord).result;
  if (!Array.isArray(result)) return [];

  return result
    .map(parseEvent)
    .filter((event): event is EconomicCalendarEvent => event !== null)
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

export function filterEconomicCalendarEvents(
  events: EconomicCalendarEvent[],
  countries: readonly string[],
  importances: readonly EconomicCalendarImportance[],
): EconomicCalendarEvent[] {
  const selectedCountries = new Set(countries);
  const selectedImportances = new Set(importances);
  return events.filter(
    (event) =>
      selectedCountries.has(event.country) && selectedImportances.has(event.importance),
  );
}

export function economicCalendarDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function economicCalendarDateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error('Invalid economic calendar date');
  }
  return new Date(year, month - 1, day, 12);
}

export function economicCalendarDayRange(dateKey: string): { from: string; to: string } {
  const selectedDate = economicCalendarDateFromKey(dateKey);
  const from = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate(),
  );
  const to = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate() + 1,
  );
  return { from: from.toISOString(), to: to.toISOString() };
}

export function formatEconomicCalendarValue(
  value: number | string | null,
  unit?: string,
): string {
  if (value === null) return '–';
  const formatted =
    typeof value === 'number'
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)
      : value;
  if (!unit) return formatted;
  return /^[£$€¥]$/.test(unit) ? `${unit}${formatted}` : `${formatted}${unit}`;
}

export function economicCalendarEventDescriptor(event: EconomicCalendarEvent): string {
  if (event.actual !== null || event.forecast !== null || event.previous !== null) return '';
  if (
    /\b(speech|speaks|press conference|statement|testimony|minutes|meeting)\b/i.test(
      event.title,
    )
  ) {
    return 'Speech';
  }
  return 'Event';
}

export function countryCodeToFlag(countryCode: string): string {
  if (!/^[A-Z]{2}$/.test(countryCode)) return '🌐';
  return String.fromCodePoint(
    ...[...countryCode].map((character) => 127397 + character.charCodeAt(0)),
  );
}
