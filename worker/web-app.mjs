const ECONOMIC_CALENDAR_PATH = '/api/economic-calendar';
const ECONOMIC_CALENDAR_UPSTREAM = 'https://economic-calendar.tradingview.com/events';
const MAX_CALENDAR_RANGE_MS = 45 * 24 * 60 * 60 * 1000;
const ALLOWED_COUNTRIES = new Set([
  'US', 'GB', 'EU', 'CA', 'AU', 'JP', 'CN', 'DE', 'FR',
  'IT', 'CH', 'NZ', 'BR', 'MX', 'IN', 'KR', 'ZA', 'TR',
]);

const LEGACY_ROUTES = new Map([
  ['/account', '/portfolio'],
  ['/economic-calendar', '/calendar'],
  ['/news', '/brief'],
  ['/markets', '/trade'],
]);

export function legacyWebPath(pathname) {
  const path = pathname.replace(/\/$/, '');
  const route = LEGACY_ROUTES.get(path);
  if (route) return route;
  const match = path.match(/^\/symbol\/([^/]+)$/);
  if (!match) return null;
  let id;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return '/trade';
  }
  // These instrument IDs have an exact counterpart in the imported terminal.
  // Leave other instruments at market selection instead of guessing a ticker.
  const perp = id.match(/^hl:perp:([A-Za-z0-9._-]+)$/);
  if (perp) return `/trade/${perp[1]}`;
  const xyz = id.match(/^hl:xyz:([A-Za-z0-9._-]+)$/);
  if (xyz) return `/trade/${xyz[1]}`;
  return '/trade';
}

function calendarHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
}

function calendarError(status, code) {
  return Response.json(
    { error: code },
    { status, headers: calendarHeaders() },
  );
}

export function buildEconomicCalendarUpstreamUrl(requestUrl) {
  const incoming = new URL(requestUrl);
  const from = incoming.searchParams.get('from');
  const to = incoming.searchParams.get('to');
  const fromTime = from ? Date.parse(from) : Number.NaN;
  const toTime = to ? Date.parse(to) : Number.NaN;

  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime <= fromTime) {
    throw new RangeError('invalid_date_range');
  }
  if (toTime - fromTime > MAX_CALENDAR_RANGE_MS) {
    throw new RangeError('date_range_too_large');
  }

  const requestedCountries = (incoming.searchParams.get('countries') ?? '')
    .split(',')
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
  const countries = [...new Set(requestedCountries)];
  if (countries.length === 0 || countries.some((country) => !ALLOWED_COUNTRIES.has(country))) {
    throw new RangeError('invalid_countries');
  }

  const minImportance = incoming.searchParams.get('minImportance') ?? '-1';
  if (!['-1', '0', '1'].includes(minImportance)) {
    throw new RangeError('invalid_importance');
  }

  const upstream = new URL(ECONOMIC_CALENDAR_UPSTREAM);
  upstream.searchParams.set('from', from);
  upstream.searchParams.set('to', to);
  upstream.searchParams.set('countries', countries.join(','));
  upstream.searchParams.set('minImportance', minImportance);
  return upstream;
}

export async function handleEconomicCalendarRequest(request, fetcher = fetch) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...calendarHeaders(),
        'Access-Control-Allow-Headers': 'Accept',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (request.method !== 'GET') {
    return calendarError(405, 'method_not_allowed');
  }

  let upstreamUrl;
  try {
    upstreamUrl = buildEconomicCalendarUpstreamUrl(request.url);
  } catch (error) {
    const code = error instanceof RangeError ? error.message : 'invalid_request';
    return calendarError(400, code);
  }

  try {
    const upstream = await fetcher(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/',
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 60,
      },
    });
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !contentType.includes('application/json')) {
      await upstream.body?.cancel();
      console.error(JSON.stringify({
        message: 'economic calendar upstream failed',
        status: upstream.status,
        contentType,
      }));
      return calendarError(502, 'calendar_upstream_unavailable');
    }

    const headers = new Headers(upstream.headers);
    for (const [name, value] of Object.entries(calendarHeaders())) headers.set(name, value);
    headers.delete('set-cookie');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'economic calendar proxy error',
      error: error instanceof Error ? error.message : String(error),
    }));
    return calendarError(502, 'calendar_upstream_unavailable');
  }
}

export async function handleDailyBriefRequest(request, storage) {
  const path = new URL(request.url).pathname;
  const id = path.match(/^\/api\/daily-briefs\/(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (path !== '/api/daily-briefs' && !id) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  try {
    if (!storage) throw new Error('Missing daily brief binding');
    const body = await storage.get(id ? `edition:v1:${id}` : 'index:v1', { type: 'stream', cacheTtl: 60 });
    if (!body) {
      return Response.json({ error: id ? 'edition_not_found' : 'brief_unavailable' }, { status: id ? 404 : 503, headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method === 'HEAD') await body.cancel();
    return new Response(request.method === 'HEAD' ? null : body, { headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=60',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    console.error(JSON.stringify({ message: 'daily brief storage unavailable', error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: 'brief_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === ECONOMIC_CALENDAR_PATH) {
      return handleEconomicCalendarRequest(request);
    }

    if (url.pathname === '/api/daily-briefs' || url.pathname.startsWith('/api/daily-briefs/')) {
      return handleDailyBriefRequest(request, env.DAILY_BRIEFS);
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const legacyPath = legacyWebPath(url.pathname);
    if (legacyPath) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      url.pathname = legacyPath;
      return Response.redirect(url, 308);
    }
    return env.ASSETS.fetch(request);
  },
};
