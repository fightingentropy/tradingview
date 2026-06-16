/**
 * Stocks quote proxy. Keeps TWELVE_DATA_KEY server-side and adds a short cache.
 * GET /api/stocks/quote?symbols=AAPL,MSFT
 */
export async function GET(request: Request) {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) {
    return Response.json({ error: 'TWELVE_DATA_KEY not configured' }, { status: 503 });
  }
  const url = new URL(request.url);
  const symbols = url.searchParams.get('symbols');
  if (!symbols) {
    return Response.json({ error: 'symbols query param required' }, { status: 400 });
  }

  const upstream = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${key}`;
  try {
    const res = await fetch(upstream);
    const data = await res.json();
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, max-age=15' },
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
