import type { Candle, CandleInterval, Instrument, Quote } from '@/domain/types';

import type { MarketDataProvider, MarketSnapshot } from '../types';
import { fetchStockCandles, fetchStockQuotes } from './client';
import { micToVenue, STOCK_SEEDS } from './symbols';

/** Twelve Data interval names keyed by our CandleInterval. */
const TD_INTERVAL: Record<CandleInterval, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
  '1w': '1week',
};

// Module-level snapshot cache. useMarkets refetches often (for crypto), but the
// stocks free tier is tiny, so we only actually hit the proxy occasionally.
const SNAPSHOT_TTL = 10 * 60_000;
let cache: { ts: number; snapshot: MarketSnapshot } | null = null;

export const stocksProvider: MarketDataProvider = {
  source: 'stocks',

  async loadMarkets(): Promise<MarketSnapshot> {
    if (cache && Date.now() - cache.ts < SNAPSHOT_TTL) return cache.snapshot;

    const quotes = await fetchStockQuotes(STOCK_SEEDS.map((s) => s.symbol));
    const instruments: Instrument[] = [];
    const out: Record<string, Quote> = {};
    const ts = Date.now();

    for (const seed of STOCK_SEEDS) {
      const q = quotes[seed.symbol];
      if (!q || q.code || q.close === undefined) continue; // skip missing/errored
      const id = `stk:${seed.symbol}`;
      instruments.push({
        id,
        source: 'stocks',
        assetClass: 'equity',
        symbol: seed.symbol,
        name: q.name ?? seed.name,
        venue: micToVenue(q.mic_code, q.exchange),
        priceDecimals: 2,
        coinKey: seed.symbol,
        quoteCurrency: 'USD',
      });
      const last = Number(q.close);
      const prevClose = Number(q.previous_close);
      out[id] = {
        instrumentId: id,
        last,
        prevClose: Number.isFinite(prevClose) ? prevClose : null,
        change24hPct: q.percent_change !== undefined ? Number(q.percent_change) : null,
        dayVolume: q.volume !== undefined ? Number(q.volume) : null,
        ts,
      };
    }

    const snapshot: MarketSnapshot = { instruments, quotes: out };
    // Only cache a successful (non-empty) fetch so a transient failure retries.
    if (instruments.length > 0) cache = { ts, snapshot };
    return snapshot;
  },

  async getCandles(instrument: Instrument, interval: CandleInterval): Promise<Candle[]> {
    const values = await fetchStockCandles(instrument.coinKey, TD_INTERVAL[interval]);
    return values
      .map((v) => ({
        t: Date.parse(v.datetime.includes(':') ? v.datetime.replace(' ', 'T') : v.datetime),
        o: Number(v.open),
        h: Number(v.high),
        l: Number(v.low),
        c: Number(v.close),
        v: Number(v.volume),
      }))
      .filter((c) => Number.isFinite(c.t))
      .sort((a, b) => a.t - b.t);
  },
};
