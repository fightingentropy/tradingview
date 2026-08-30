import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEconomicCalendarUpstreamUrl,
  handleEconomicCalendarRequest,
} from '../worker/web-app.mjs';

const VALID_QUERY = new URLSearchParams({
  from: '2026-08-24T00:00:00.000Z',
  to: '2026-08-31T00:00:00.000Z',
  countries: 'US,GB,EU',
  minImportance: '-1',
});

test('builds a bounded allowlisted TradingView calendar request', () => {
  const upstream = buildEconomicCalendarUpstreamUrl(
    `https://terminal.example/api/economic-calendar?${VALID_QUERY}`,
  );
  assert.equal(upstream.origin, 'https://economic-calendar.tradingview.com');
  assert.equal(upstream.pathname, '/events');
  assert.equal(upstream.searchParams.get('countries'), 'US,GB,EU');
  assert.equal(upstream.searchParams.get('minImportance'), '-1');
});

test('rejects invalid countries and oversized ranges before fetching upstream', () => {
  const invalidCountry = new URLSearchParams(VALID_QUERY);
  invalidCountry.set('countries', 'US,XX');
  assert.throws(
    () => buildEconomicCalendarUpstreamUrl(`https://terminal.example/api/economic-calendar?${invalidCountry}`),
    /invalid_countries/,
  );

  const oversized = new URLSearchParams(VALID_QUERY);
  oversized.set('to', '2026-11-01T00:00:00.000Z');
  assert.throws(
    () => buildEconomicCalendarUpstreamUrl(`https://terminal.example/api/economic-calendar?${oversized}`),
    /date_range_too_large/,
  );
});

test('streams calendar JSON with CORS and cache headers', async () => {
  let receivedUrl;
  let receivedInit;
  const response = await handleEconomicCalendarRequest(
    new Request(`http://127.0.0.1:8082/api/economic-calendar?${VALID_QUERY}`),
    async (url, init) => {
      receivedUrl = url;
      receivedInit = init;
      return Response.json({ result: [{ id: 'cpi' }] });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
  assert.equal(receivedUrl.origin, 'https://economic-calendar.tradingview.com');
  assert.equal(receivedInit.headers.Origin, 'https://www.tradingview.com');
  assert.deepEqual(await response.json(), { result: [{ id: 'cpi' }] });
});

test('answers calendar preflight without contacting the upstream', async () => {
  const response = await handleEconomicCalendarRequest(
    new Request(`http://127.0.0.1:8082/api/economic-calendar?${VALID_QUERY}`, { method: 'OPTIONS' }),
    async () => {
      throw new Error('fetch must not run for preflight');
    },
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});
