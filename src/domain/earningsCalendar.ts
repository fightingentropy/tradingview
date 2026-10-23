// US earnings from TradingView's public screener, shared by the web Worker,
// the website and the iPhone app. The screener holds each company's latest
// and next report, so a week more than a quarter away is necessarily sparse.

export const EARNINGS_SCANNER_URL = 'https://scanner.tradingview.com/america/scan';
export const EARNINGS_LOGO_BASE_URL = 'https://s3-symbol-logo.tradingview.com';
export const MAX_EARNINGS_RANGE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EARNINGS_ROWS = 1500;
const SCANNER_COLUMNS = [
  'name',
  'description',
  'logoid',
  'exchange',
  'market_cap_basic',
  'currency',
  'fiscal_period_end_fy',
  'earnings_release_date',
  'earnings_release_trading_date_fq',
  'earnings_release_time',
  'earnings_release_calendar_date',
  'earnings_per_share_fq',
  'earnings_per_share_forecast_fq',
  'eps_surprise_percent_fq',
  'revenue_fq',
  'revenue_forecast_fq',
  'revenue_surprise_percent_fq',
  'earnings_release_next_date',
  'earnings_release_next_trading_date_fq',
  'earnings_release_next_time',
  'earnings_release_next_calendar_date',
  'earnings_per_share_forecast_next_fq',
  'revenue_forecast_next_fq',
] as const;

type ScannerColumn = (typeof SCANNER_COLUMNS)[number];
type ScannerRow = Record<ScannerColumn, unknown>;

export type EarningsTiming = 'before_open' | 'after_close' | 'unknown';

export type EarningsFigure = {
  actual: number | null;
  estimate: number | null;
  /** Surprise against the consensus, in percent. */
  surprise: number | null;
};

export type EarningsReport = {
  /** Exchange-qualified symbol, e.g. NYSE:PG. */
  symbol: string;
  ticker: string;
  name: string;
  /** TradingView logo id; see earningsLogoUrl. */
  logo: string | null;
  exchange: string;
  marketCap: number | null;
  currency: string;
  /** US trading day of the report, YYYY-MM-DD. */
  date: string;
  /** Release instant. Absent when TradingView has only a placeholder time. */
  time: string | null;
  timing: EarningsTiming;
  reported: boolean;
  /** Fiscal quarter of the report, e.g. "Q1 2027". */
  period: string | null;
  eps: EarningsFigure;
  revenue: EarningsFigure;
  /** Last quarter's results before a report, or next quarter's consensus after it. */
  context: {
    kind: 'previous' | 'next';
    period: string | null;
    eps: EarningsFigure;
    revenue: EarningsFigure;
  } | null;
  summary?: EarningsSummary;
};

/** Claude's three-bullet read of a reported quarter, for companies of $10B and more. */
export type EarningsSummary = {
  bullets: string[];
  generatedAt: string;
};

/** One KV entry per US trading day, keyed by exchange-qualified symbol. */
export const earningsSummaryKey = (date: string) => `earnings-summaries:v1:${date}`;


export type EarningsCalendar = {
  from: string;
  to: string;
  updatedAt: string;
  reports: EarningsReport[];
};

export type EarningsLine = {
  text: string;
  surprise?: { label: string; tone: 'beat' | 'miss' | 'inline' };
};

function dateFromKey(key: string): number {
  const time = Date.parse(`${key}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== key) {
    throw new RangeError('invalid_date');
  }
  return time;
}

/** Validates an inclusive YYYY-MM-DD range of at most MAX_EARNINGS_RANGE_DAYS days. */
export function earningsRange(from: string | null, to: string | null): { from: string; to: string } {
  if (!from || !to) throw new RangeError('invalid_date_range');
  let fromTime: number;
  let toTime: number;
  try {
    fromTime = dateFromKey(from);
    toTime = dateFromKey(to);
  } catch {
    throw new RangeError('invalid_date_range');
  }
  if (toTime < fromTime) throw new RangeError('invalid_date_range');
  if ((toTime - fromTime) / DAY_MS + 1 > MAX_EARNINGS_RANGE_DAYS) throw new RangeError('date_range_too_large');
  return { from, to };
}

/** Primary US listings of common shares and depositary receipts, largest first. */
export function buildEarningsScannerRequest(from: string, to: string) {
  const range = earningsRange(from, to);
  return {
    markets: ['america'],
    filter: [
      {
        left: 'earnings_release_trading_date_fq,earnings_release_next_trading_date_fq',
        operation: 'in_range',
        right: [dateFromKey(range.from) / 1000, dateFromKey(range.to) / 1000],
      },
      { left: 'is_primary', operation: 'equal', right: true },
      { left: 'type', operation: 'in_range', right: ['stock', 'dr'] },
      { left: 'subtype', operation: 'not_in_range', right: ['preferred'] },
    ],
    options: { lang: 'en' },
    columns: [...SCANNER_COLUMNS],
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
    range: [0, MAX_EARNINGS_ROWS],
  };
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const dayKey = (seconds: unknown): string | null => {
  const value = finite(seconds);
  return value === null ? null : new Date(value * 1000).toISOString().slice(0, 10);
};

/** Year and month of a period end. Early-month ends (52/53-week years) count as the previous month. */
function periodMonth(seconds: number) {
  const date = new Date(seconds * 1000);
  if (date.getUTCDate() <= 10) date.setUTCDate(0);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Fiscal quarter label from a quarter's end and the fiscal year's end, named by the year it closes. */
export function fiscalQuarterLabel(periodEnd: unknown, fiscalYearEnd: unknown): string | null {
  const end = finite(periodEnd);
  if (end === null) return null;
  const quarterEnd = periodMonth(end);
  const yearEnd = finite(fiscalYearEnd);
  const closingMonth = yearEnd === null ? 12 : periodMonth(yearEnd).month;
  const monthsIntoYear = (quarterEnd.month - closingMonth + 12) % 12;
  const quarter = monthsIntoYear === 0 ? 4 : Math.ceil(monthsIntoYear / 3);
  const year = quarterEnd.month <= closingMonth ? quarterEnd.year : quarterEnd.year + 1;
  return `Q${quarter} ${year}`;
}

function timingFromCode(code: unknown): EarningsTiming {
  return code === -1 ? 'before_open' : code === 1 ? 'after_close' : 'unknown';
}

function figure(actual: unknown, estimate: unknown, surprise: unknown): EarningsFigure {
  return { actual: finite(actual), estimate: finite(estimate), surprise: finite(surprise) };
}

function reportFromRow(symbol: string, row: ScannerRow, from: string, to: string): EarningsReport | null {
  const lastDay = dayKey(row.earnings_release_trading_date_fq);
  const nextDay = dayKey(row.earnings_release_next_trading_date_fq);
  const inRange = (day: string | null): day is string => day !== null && day >= from && day <= to;
  const reported = inRange(lastDay);
  if (!reported && !inRange(nextDay)) return null;

  const ticker = text(row.name) ?? symbol.split(':').pop()!;
  const fiscalYearEnd = row.fiscal_period_end_fy;
  const lastPeriod = fiscalQuarterLabel(row.earnings_release_calendar_date, fiscalYearEnd);
  const nextPeriod = fiscalQuarterLabel(row.earnings_release_next_calendar_date, fiscalYearEnd);
  const lastEps = figure(row.earnings_per_share_fq, row.earnings_per_share_forecast_fq, row.eps_surprise_percent_fq);
  const lastRevenue = figure(row.revenue_fq, row.revenue_forecast_fq, row.revenue_surprise_percent_fq);
  const nextEps = figure(null, row.earnings_per_share_forecast_next_fq, null);
  const nextRevenue = figure(null, row.revenue_forecast_next_fq, null);
  const timing = timingFromCode(reported ? row.earnings_release_time : row.earnings_release_next_time);
  const releasedAt = finite(reported ? row.earnings_release_date : row.earnings_release_next_date);
  // An unscheduled release carries a midday placeholder rather than a real time.
  const time = releasedAt !== null && (reported || timing !== 'unknown')
    ? new Date(releasedAt * 1000).toISOString()
    : null;
  const hasFigures = (eps: EarningsFigure, revenue: EarningsFigure) =>
    [eps.actual, eps.estimate, revenue.actual, revenue.estimate].some((value) => value !== null);

  return {
    symbol,
    ticker,
    name: text(row.description) ?? ticker,
    logo: text(row.logoid),
    exchange: text(row.exchange) ?? symbol.split(':')[0],
    marketCap: finite(row.market_cap_basic),
    currency: text(row.currency) ?? 'USD',
    date: reported ? lastDay : nextDay!,
    time,
    timing,
    reported,
    period: reported ? lastPeriod : nextPeriod,
    eps: reported ? lastEps : nextEps,
    revenue: reported ? lastRevenue : nextRevenue,
    context: reported
      ? hasFigures(nextEps, nextRevenue) ? { kind: 'next', period: nextPeriod, eps: nextEps, revenue: nextRevenue } : null
      : hasFigures(lastEps, lastRevenue) ? { kind: 'previous', period: lastPeriod, eps: lastEps, revenue: lastRevenue } : null,
  };
}

/** Maps the screener's positional rows to reports inside the inclusive range, largest first. */
export function parseEarningsScannerResponse(raw: unknown, from: string, to: string): EarningsReport[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { data?: unknown }).data)) {
    throw new Error('invalid_scanner_response');
  }
  const seen = new Set<string>();
  const reports: EarningsReport[] = [];
  for (const item of (raw as { data: unknown[] }).data) {
    if (!item || typeof item !== 'object') continue;
    const { s: symbol, d: values } = item as { s?: unknown; d?: unknown };
    if (typeof symbol !== 'string' || !Array.isArray(values) || seen.has(symbol)) continue;
    const row = Object.fromEntries(SCANNER_COLUMNS.map((column, index) => [column, values[index]])) as ScannerRow;
    const report = reportFromRow(symbol, row, from, to);
    if (!report) continue;
    seen.add(symbol);
    reports.push(report);
  }
  return reports.sort((left, right) => (right.marketCap ?? 0) - (left.marketCap ?? 0));
}

function parseFigure(value: unknown): EarningsFigure {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return figure(record.actual, record.estimate, record.surprise);
}

function parseReport(value: unknown): EarningsReport | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const symbol = text(record.symbol);
  const ticker = text(record.ticker);
  const date = text(record.date);
  if (!symbol || !ticker || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = text(record.time);
  const context = record.context && typeof record.context === 'object'
    ? (record.context as Record<string, unknown>)
    : null;
  return {
    symbol,
    ticker,
    name: text(record.name) ?? ticker,
    logo: text(record.logo),
    exchange: text(record.exchange) ?? symbol.split(':')[0],
    marketCap: finite(record.marketCap),
    currency: text(record.currency) ?? 'USD',
    date,
    time: time && Number.isFinite(Date.parse(time)) ? time : null,
    timing: record.timing === 'before_open' || record.timing === 'after_close' ? record.timing : 'unknown',
    reported: record.reported === true,
    period: text(record.period),
    eps: parseFigure(record.eps),
    revenue: parseFigure(record.revenue),
    context: context && (context.kind === 'previous' || context.kind === 'next')
      ? { kind: context.kind, period: text(context.period), eps: parseFigure(context.eps), revenue: parseFigure(context.revenue) }
      : null,
    ...parseSummary(record.summary),
  };
}

function parseSummary(value: unknown): { summary?: EarningsSummary } {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  const bullets = Array.isArray(record?.bullets)
    ? record.bullets.flatMap((bullet) => text(bullet) ?? []).slice(0, 3)
    : [];
  const generatedAt = text(record?.generatedAt);
  return bullets.length && generatedAt && Number.isFinite(Date.parse(generatedAt)) ? { summary: { bullets, generatedAt } } : {};
}

/** Validates the Worker's response for the website and the app. */
export function parseEarningsCalendar(value: unknown): EarningsCalendar {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { reports?: unknown }).reports)) {
    throw new Error('The earnings calendar returned an invalid response.');
  }
  const record = value as Record<string, unknown>;
  return {
    from: text(record.from) ?? '',
    to: text(record.to) ?? '',
    updatedAt: text(record.updatedAt) ?? new Date().toISOString(),
    reports: (record.reports as unknown[])
      .map(parseReport)
      .filter((report): report is EarningsReport => report !== null),
  };
}

export const earningsLogoUrl = (logo: string) =>
  `${EARNINGS_LOGO_BASE_URL}/${encodeURIComponent(logo)}.svg`;

function currencyFormat(currency: string, options: Intl.NumberFormatOptions) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, ...options });
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...options });
  }
}

export function formatEarningsPerShare(value: number, currency = 'USD'): string {
  return currencyFormat(currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatEarningsRevenue(value: number, currency = 'USD'): string {
  return currencyFormat(currency, {
    notation: 'compact',
    minimumFractionDigits: Math.abs(value) >= 1e9 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) >= 1e9 ? 2 : 1,
  }).format(value);
}

export function formatMarketCap(value: number, currency = 'USD'): string {
  return currencyFormat(currency, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function earningsSurprise(value: number | null): EarningsLine['surprise'] {
  if (value === null) return undefined;
  const size = Math.abs(value);
  if (size < 0.05) return { label: 'in line', tone: 'inline' };
  const amount = size >= 100 ? Math.round(size).toLocaleString('en-US') : size.toFixed(1);
  return value > 0
    ? { label: `beat by ${amount}%`, tone: 'beat' }
    : { label: `missed by ${amount}%`, tone: 'miss' };
}

function resultLine(label: string, value: EarningsFigure, format: (value: number) => string): EarningsLine | null {
  if (value.actual === null) {
    return value.estimate === null ? null : { text: `${label} estimate ${format(value.estimate)}` };
  }
  return {
    text: value.estimate === null
      ? `${label} ${format(value.actual)}`
      : `${label} ${format(value.actual)} vs ${format(value.estimate)} est.`,
    surprise: earningsSurprise(value.surprise),
  };
}

/**
 * Up to three lines: Claude's summary once a $10B+ report has one, otherwise
 * factual lines (results against consensus, then the quarter before or after).
 */
export function earningsLines(report: EarningsReport): EarningsLine[] {
  if (report.summary?.bullets.length) return report.summary.bullets.slice(0, 3).map((text) => ({ text }));
  const eps = (value: number) => formatEarningsPerShare(value, report.currency);
  const revenue = (value: number) => formatEarningsRevenue(value, report.currency);
  const lines: (EarningsLine | null)[] = [];
  if (report.reported) {
    lines.push(resultLine('EPS', report.eps, eps), resultLine('Revenue', report.revenue, revenue));
    const next = report.context;
    const estimates = next && [
      next.eps.estimate === null ? null : `EPS ${eps(next.eps.estimate)}`,
      next.revenue.estimate === null ? null : `revenue ${revenue(next.revenue.estimate)}`,
    ].filter(Boolean);
    if (next && estimates?.length) lines.push({ text: `${next.period ?? 'Next quarter'} consensus: ${estimates.join(', ')}` });
  } else {
    const estimates = [
      report.eps.estimate === null ? null : `EPS ${eps(report.eps.estimate)}`,
      report.revenue.estimate === null ? null : `revenue ${revenue(report.revenue.estimate)}`,
    ].filter(Boolean);
    if (estimates.length) lines.push({ text: `Consensus: ${estimates.join(', ')}` });
    const previous = report.context;
    if (previous) {
      const label = previous.period ? `${previous.period}` : 'Last quarter';
      lines.push(
        resultLine(`${label} EPS`, previous.eps, eps),
        resultLine(`${label} revenue`, previous.revenue, revenue),
      );
    }
  }
  return lines.filter((line): line is EarningsLine => line !== null).slice(0, 3);
}

// Micro caps include shells and bankrupt OTC listings, so clients start at small caps.
export const EARNINGS_CAP_TIERS = [
  { value: 'all', label: 'All', min: 0 },
  { value: 'small', label: '$300M+', min: 3e8 },
  { value: 'mid', label: '$2B+', min: 2e9 },
  { value: 'large', label: '$10B+', min: 1e10 },
  { value: 'mega', label: '$200B+', min: 2e11 },
] as const;
export type EarningsCapTier = (typeof EARNINGS_CAP_TIERS)[number]['value'];
export const DEFAULT_EARNINGS_CAP_TIER: EarningsCapTier = 'small';

export function meetsEarningsCapTier(report: EarningsReport, tier: EarningsCapTier): boolean {
  const min = EARNINGS_CAP_TIERS.find((item) => item.value === tier)?.min ?? 0;
  return min === 0 || (report.marketCap ?? 0) >= min;
}

export type EarningsStatus = 'reported' | 'awaiting' | 'scheduled';

/** A release time that has passed without figures is still waiting on TradingView. */
export function earningsStatus(report: EarningsReport, now = Date.now()): EarningsStatus {
  if (report.reported) return 'reported';
  return report.time && Date.parse(report.time) <= now ? 'awaiting' : 'scheduled';
}

export const earningsTimingLabel = (timing: EarningsTiming) =>
  timing === 'before_open' ? 'Before the US open' : timing === 'after_close' ? 'After the US close' : 'Time not confirmed';
