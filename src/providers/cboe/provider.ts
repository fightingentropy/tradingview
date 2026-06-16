import { INTERVALS } from '@/domain/intervals';
import type { Candle, CandleInterval, Instrument, Quote } from '@/domain/types';

import type { MarketDataProvider, MarketSnapshot } from '../types';
import {
  fetchCboeDaily,
  fetchCboeIntraday,
  fetchCboeQuote,
  type CboeDailyBar,
  type CboeIntradayBar,
} from './client';

/** Cboe index seeds. `cboeKey` is the CDN's underscore symbol form (e.g. "_VIX"). */
interface CboeSeed {
  symbol: string;
  cboeKey: string;
  name: string;
  priceDecimals: number;
}

const CBOE_SEEDS: CboeSeed[] = [
  { symbol: 'VIX', cboeKey: '_VIX', name: 'CBOE Volatility Index', priceDecimals: 2 },
];

// Keyless CDN, but useMarkets refetches ~every 30s; a short cache avoids redundant hits.
const SNAPSHOT_TTL = 15_000;
let cache: { ts: number; snapshot: MarketSnapshot } | null = null;

function num(v?: string | number | null): number {
  return typeof v === 'number' ? v : Number(v);
}

/** Treat Cboe's tz-less ISO datetimes as UTC so parsing is device-independent. */
function parseIso(dt: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(dt) ? dt : `${dt}Z`);
}

/** Bucket a sorted-ascending series into `bucketMs` windows, merging OHLCV. */
function aggregate(src: Candle[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of src) {
    const b = Math.floor(c.t / bucketMs) * bucketMs;
    if (!cur || b !== cur.t) {
      cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
      out.push(cur);
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v;
    }
  }
  return out;
}

function dailyToCandles(bars: CboeDailyBar[]): Candle[] {
  return bars
    .map((b) => ({
      t: Date.parse(`${b.date}T00:00:00Z`),
      o: num(b.open),
      h: num(b.high),
      l: num(b.low),
      c: num(b.close),
      v: num(b.volume) || 0,
    }))
    .filter((c) => Number.isFinite(c.t) && c.c > 0)
    .sort((a, b) => a.t - b.t);
}

function intradayToCandles(bars: CboeIntradayBar[]): Candle[] {
  return bars
    .map((b) => ({
      t: parseIso(b.datetime),
      o: b.price?.open ?? 0,
      h: b.price?.high ?? 0,
      l: b.price?.low ?? 0,
      c: b.price?.close ?? 0,
      v: 0,
    }))
    .filter((c) => Number.isFinite(c.t) && c.o > 0 && c.c > 0)
    .sort((a, b) => a.t - b.t);
}

/**
 * Real CBOE indices (VIX) via Cboe's free delayed-quotes CDN. Quote-only (no
 * websocket) — the watchlist shows the snapshot, refreshed on the markets poll.
 */
export const cboeProvider: MarketDataProvider = {
  source: 'cboe',

  async loadMarkets(): Promise<MarketSnapshot> {
    if (cache && Date.now() - cache.ts < SNAPSHOT_TTL) return cache.snapshot;

    const instruments: Instrument[] = [];
    const quotes: Record<string, Quote> = {};
    const ts = Date.now();

    const results = await Promise.all(
      CBOE_SEEDS.map(async (seed) => ({ seed, quote: await fetchCboeQuote(seed.cboeKey) })),
    );

    for (const { seed, quote } of results) {
      if (!quote || typeof quote.current_price !== 'number') continue; // skip missing/errored
      const id = `cboe:${seed.symbol}`;
      instruments.push({
        id,
        source: 'cboe',
        assetClass: 'index',
        symbol: seed.symbol,
        name: seed.name,
        venue: 'Cboe',
        priceDecimals: seed.priceDecimals,
        coinKey: seed.cboeKey,
      });
      quotes[id] = {
        instrumentId: id,
        last: quote.current_price,
        prevClose: typeof quote.prev_day_close === 'number' ? quote.prev_day_close : null,
        change24hPct:
          typeof quote.price_change_percent === 'number' ? quote.price_change_percent : null,
        dayVolume: null, // an index has no volume
        ts,
      };
    }

    const snapshot: MarketSnapshot = { instruments, quotes };
    if (instruments.length > 0) cache = { ts, snapshot };
    return snapshot;
  },

  async getCandles(instrument: Instrument, interval: CandleInterval): Promise<Candle[]> {
    const { ms, count } = INTERVALS[interval];
    const wantsIntraday = interval !== '1d' && interval !== '1w';

    // Intraday for sub-daily timeframes when the market is open; otherwise (and
    // for 1d/1w) fall back to the daily series so the chart always renders.
    let series: Candle[] = wantsIntraday
      ? intradayToCandles(await fetchCboeIntraday(instrument.coinKey))
      : [];
    if (series.length < 2) {
      series = dailyToCandles(await fetchCboeDaily(instrument.coinKey));
    }

    return aggregate(series, ms).slice(-count);
  },
};
