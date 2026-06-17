/**
 * Stocks candles proxy. GET /api/stocks/candles?symbol=AAPL&interval=1h
 * `interval` is already a Twelve Data interval name (e.g. 1min, 1h, 1day).
 */
export async function GET(request: Request) {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) {
    return Response.json({ error: 'TWELVE_DATA_KEY not configured' }, { status: 503 });
  }
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  const interval = url.searchParams.get('interval') ?? '1h';
  if (!symbol) {
    return Response.json({ error: 'symbol query param required' }, { status: 400 });
  }

  const upstream =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}&outputsize=240&order=ASC&apikey=${key}`;
  try {
    const res = await fetch(upstream);
    if (!res.ok) {
      return Response.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
