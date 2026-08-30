const SITE_ORIGIN_PLACEHOLDER = 'https://site-origin.invalid';
const ECONOMIC_CALENDAR_PATH = '/api/economic-calendar';
const ECONOMIC_CALENDAR_UPSTREAM = 'https://economic-calendar.tradingview.com/events';
const MAX_CALENDAR_RANGE_MS = 45 * 24 * 60 * 60 * 1000;
const ALLOWED_COUNTRIES = new Set([
  'US', 'GB', 'EU', 'CA', 'AU', 'JP', 'CN', 'DE', 'FR',
  'IT', 'CH', 'NZ', 'BR', 'MX', 'IN', 'KR', 'ZA', 'TR',
]);

const DYNAMIC_ROUTES = [
  { pattern: /^\/symbol\/[^/]+\/?$/, asset: '/symbol/%5Bid%5D.html' },
  { pattern: /^\/outcomes\/[^/]+\/?$/, asset: '/outcomes/%5Bid%5D.html' },
];

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

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

async function fetchAsset(request, assets, pathname) {
  return assets.fetch(assetRequest(request, pathname));
}

async function withSiteOrigin(response, request) {
  const contentType = response.headers.get('content-type') ?? '';
  if (request.method !== 'GET' || !contentType.includes('text/html')) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const html = (await response.text()).replaceAll(
    SITE_ORIGIN_PLACEHOLDER,
    new URL(request.url).origin,
  );

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === ECONOMIC_CALENDAR_PATH) {
      return handleEconomicCalendarRequest(request);
    }

    const direct = await env.ASSETS.fetch(request);
    if (direct.status !== 404 || !['GET', 'HEAD'].includes(request.method)) {
      return withSiteOrigin(direct, request);
    }

    const cleanPath = url.pathname === '/' ? '/index' : url.pathname.replace(/\/$/, '');
    const candidates = [`${cleanPath}.html`, `${cleanPath}/index.html`];
    const dynamicRoute = DYNAMIC_ROUTES.find(({ pattern }) => pattern.test(url.pathname));
    if (dynamicRoute) candidates.unshift(dynamicRoute.asset);

    for (const pathname of candidates) {
      const response = await fetchAsset(request, env.ASSETS, pathname);
      if (response.status !== 404) return withSiteOrigin(response, request);
    }

    const notFound = await fetchAsset(request, env.ASSETS, '/+not-found.html');
    const response = new Response(notFound.body, {
      status: 404,
      headers: notFound.headers,
    });
    return withSiteOrigin(response, request);
  },
};
