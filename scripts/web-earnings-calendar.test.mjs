import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEarningsScannerRequest,
  earningsLines,
  earningsRange,
  earningsSummaryKey,
  fiscalQuarterLabel,
  parseEarningsCalendar,
  parseEarningsScannerResponse,
} from '../src/domain/earningsCalendar.ts';
import { attachEarningsSummaries, handleEarningsCalendarRequest } from '../worker/web-app.mjs';

const seconds = (iso) => Date.parse(iso) / 1000;
const COLUMNS = buildEarningsScannerRequest('2026-10-18', '2026-10-24').columns;
const row = (symbol, fields) => ({ s: symbol, d: COLUMNS.map((column) => fields[column] ?? null) });

const reportedRow = row('NYSE:PG', {
  name: 'PG',
  description: 'Procter & Gamble Company',
  logoid: 'procter-and-gamble',
  exchange: 'NYSE',
  market_cap_basic: 386e9,
  currency: 'USD',
  fiscal_period_end_fy: seconds('2026-06-30'),
  earnings_release_date: seconds('2026-10-22T11:00:00Z'),
  earnings_release_trading_date_fq: seconds('2026-10-22'),
  earnings_release_time: -1,
  earnings_release_calendar_date: seconds('2026-09-30'),
  earnings_per_share_fq: 2,
  earnings_per_share_forecast_fq: 1.8839,
  eps_surprise_percent_fq: 6.16,
  revenue_fq: 23.276e9,
  revenue_forecast_fq: 22.795e9,
  revenue_surprise_percent_fq: 2.11,
  earnings_release_next_date: seconds('2027-01-21T12:00:00Z'),
  earnings_release_next_trading_date_fq: seconds('2027-01-21'),
  earnings_release_next_time: -1,
  earnings_release_next_calendar_date: seconds('2026-12-31'),
  earnings_per_share_forecast_next_fq: 1.881,
  revenue_forecast_next_fq: 22.698e9,
});
const upcomingRow = row('NASDAQ:WDC', {
  name: 'WDC',
  description: 'Western Digital Corporation',
  market_cap_basic: 132e9,
  fiscal_period_end_fy: seconds('2026-07-03'),
  earnings_release_date: seconds('2026-08-06T20:02:00Z'),
  earnings_release_trading_date_fq: seconds('2026-08-06'),
  earnings_release_time: 1,
  earnings_release_calendar_date: seconds('2026-06-30'),
  earnings_per_share_fq: 3.56,
  earnings_per_share_forecast_fq: 3.31,
  eps_surprise_percent_fq: 7.54,
  earnings_release_next_date: seconds('2026-10-22T20:00:00Z'),
  earnings_release_next_trading_date_fq: seconds('2026-10-22'),
  earnings_release_next_time: 1,
  earnings_release_next_calendar_date: seconds('2026-09-30'),
  earnings_per_share_forecast_next_fq: 4.107,
  revenue_forecast_next_fq: 4.1438e9,
});
const unscheduledRow = row('OTC:TINY', {
  name: 'TINY',
  earnings_release_next_date: seconds('2026-10-23T12:00:00Z'),
  earnings_release_next_trading_date_fq: seconds('2026-10-23'),
  earnings_release_next_time: 0,
});
const outsideRow = row('NYSE:LATE', {
  name: 'LATE',
  earnings_release_next_trading_date_fq: seconds('2026-10-27'),
});

test('validates inclusive earnings ranges', () => {
  assert.deepEqual(earningsRange('2026-10-18', '2026-10-24'), { from: '2026-10-18', to: '2026-10-24' });
  assert.throws(() => earningsRange('2026-10-24', '2026-10-18'), /invalid_date_range/);
  assert.throws(() => earningsRange('2026-02-30', '2026-03-02'), /invalid_date_range/);
  assert.throws(() => earningsRange('2026-10-01', '2026-10-31'), /date_range_too_large/);
  assert.throws(() => earningsRange(null, '2026-10-24'), /invalid_date_range/);
});

test('names fiscal quarters by the year they close', () => {
  assert.equal(fiscalQuarterLabel(seconds('2026-09-30'), seconds('2025-12-31')), 'Q3 2026');
  assert.equal(fiscalQuarterLabel(seconds('2026-09-30'), seconds('2026-06-30')), 'Q1 2027');
  assert.equal(fiscalQuarterLabel(seconds('2026-09-26'), seconds('2025-09-27')), 'Q4 2026');
  assert.equal(fiscalQuarterLabel(seconds('2026-10-31'), seconds('2026-01-31')), 'Q3 2027');
  // 52/53-week years that close in the first days of a month count as the month before.
  assert.equal(fiscalQuarterLabel(seconds('2026-11-01'), seconds('2026-02-01')), 'Q3 2027');
  assert.equal(fiscalQuarterLabel(null, seconds('2025-12-31')), null);
});

test('maps reported and upcoming screener rows inside the range', () => {
  const reports = parseEarningsScannerResponse(
    { totalCount: 4, data: [upcomingRow, outsideRow, unscheduledRow, reportedRow, reportedRow] },
    '2026-10-18',
    '2026-10-24',
  );
  assert.deepEqual(reports.map((report) => report.ticker), ['PG', 'WDC', 'TINY']);

  const [pg, wdc, tiny] = reports;
  assert.equal(pg.reported, true);
  assert.equal(pg.date, '2026-10-22');
  assert.equal(pg.period, 'Q1 2027');
  assert.equal(pg.timing, 'before_open');
  assert.equal(pg.time, '2026-10-22T11:00:00.000Z');
  assert.deepEqual(pg.eps, { actual: 2, estimate: 1.8839, surprise: 6.16 });
  assert.equal(pg.context.kind, 'next');
  assert.equal(pg.context.period, 'Q2 2027');

  assert.equal(wdc.reported, false);
  assert.equal(wdc.period, 'Q1 2027');
  assert.deepEqual(wdc.eps, { actual: null, estimate: 4.107, surprise: null });
  assert.equal(wdc.context.kind, 'previous');
  assert.equal(wdc.context.period, 'Q4 2026');

  // An unconfirmed slot keeps TradingView's midday placeholder out of the UI.
  assert.equal(tiny.timing, 'unknown');
  assert.equal(tiny.time, null);
  assert.equal(tiny.context, null);
});

test('writes factual result lines with surprises', () => {
  const [pg, wdc] = parseEarningsScannerResponse({ data: [reportedRow, upcomingRow] }, '2026-10-18', '2026-10-24');
  assert.deepEqual(earningsLines(pg), [
    { text: 'EPS $2.00 vs $1.88 est.', surprise: { label: 'beat by 6.2%', tone: 'beat' } },
    { text: 'Revenue $23.28B vs $22.80B est.', surprise: { label: 'beat by 2.1%', tone: 'beat' } },
    { text: 'Q2 2027 consensus: EPS $1.88, revenue $22.70B' },
  ]);
  assert.deepEqual(earningsLines(wdc).map((line) => line.text), [
    'Consensus: EPS $4.11, revenue $4.14B',
    'Q4 2026 EPS $3.56 vs $3.31 est.',
  ]);
});

test('round-trips the Worker response through the client parser', () => {
  const reports = parseEarningsScannerResponse({ data: [reportedRow] }, '2026-10-18', '2026-10-24');
  const parsed = parseEarningsCalendar(JSON.parse(JSON.stringify({
    from: '2026-10-18', to: '2026-10-24', updatedAt: '2026-10-22T19:00:00.000Z', reports: [...reports, { symbol: 'X' }],
  })));
  assert.deepEqual(parsed.reports, reports);
  assert.throws(() => parseEarningsCalendar({ error: 'nope' }), /invalid response/);
});

test('attaches stored summaries to reported companies only, and survives a KV failure', async () => {
  const [reported] = parseEarningsScannerResponse({ data: [reportedRow] }, '2026-10-18', '2026-10-24');
  const upcoming = { ...reported, symbol: 'NYSE:UPC', reported: false };
  const day = { [reported.symbol]: { bullets: ['EPS beat.', 'Guidance kept.'], generatedAt: '2026-10-22T21:00:00.000Z', checkedAt: '2026-10-22T21:00:00.000Z' },
    'NYSE:UPC': { bullets: ['Should not show.'], generatedAt: '2026-10-22T21:00:00.000Z' } };
  const store = { async get(key) { return key === earningsSummaryKey(reported.date) ? day : null; } };
  const [withSummary, without] = await attachEarningsSummaries([reported, upcoming], store);
  assert.deepEqual(withSummary.summary, { bullets: ['EPS beat.', 'Guidance kept.'], generatedAt: '2026-10-22T21:00:00.000Z' });
  assert.equal(without.summary, undefined);
  assert.deepEqual(parseEarningsCalendar({ reports: [withSummary] }).reports[0].summary, withSummary.summary);
  assert.deepEqual(earningsLines(withSummary), [{ text: 'EPS beat.' }, { text: 'Guidance kept.' }]);
  const broken = { async get() { throw new Error('KV down'); } };
  assert.deepEqual(await attachEarningsSummaries([reported], broken), [reported]);
});

test('proxies one bounded screener query and caches the mapped week', async () => {
  const stored = new Map();
  const cache = {
    match: async (request) => stored.get(request.url)?.clone(),
    put: async (request, response) => void stored.set(request.url, response),
  };
  let calls = 0;
  let receivedInit;
  const fetcher = async (url, init) => {
    calls += 1;
    receivedInit = init;
    assert.equal(String(url), 'https://scanner.tradingview.com/america/scan');
    return Response.json({ totalCount: 1, data: [reportedRow] });
  };
  const request = () => new Request('http://127.0.0.1:3000/api/earnings-calendar?from=2026-10-18&to=2026-10-24');

  const response = await handleEarningsCalendarRequest(request(), fetcher, cache);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(receivedInit.method, 'POST');
  assert.equal(receivedInit.headers.Origin, 'https://www.tradingview.com');
  const body = JSON.parse(receivedInit.body);
  assert.deepEqual(body.filter[0].right, [seconds('2026-10-18'), seconds('2026-10-24')]);
  const week = await response.json();
  assert.equal(week.from, '2026-10-18');
  assert.equal(week.reports[0].ticker, 'PG');

  const again = await handleEarningsCalendarRequest(request(), fetcher, cache);
  assert.equal((await again.json()).reports[0].ticker, 'PG');
  assert.equal(calls, 1);
});

test('rejects bad ranges and reports upstream failures without leaking them', async () => {
  const unused = async () => {
    throw new Error('fetch must not run');
  };
  const invalid = await handleEarningsCalendarRequest(
    new Request('http://x/api/earnings-calendar?from=2026-10-01&to=2026-10-31'),
    unused,
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'date_range_too_large' });

  const failed = await handleEarningsCalendarRequest(
    new Request('http://x/api/earnings-calendar?from=2026-10-18&to=2026-10-24'),
    async () => new Response('<html>blocked</html>', { status: 403, headers: { 'content-type': 'text/html' } }),
  );
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'earnings_upstream_unavailable' });

  const post = await handleEarningsCalendarRequest(new Request('http://x/api/earnings-calendar', { method: 'POST' }), unused);
  assert.equal(post.status, 405);
});
