import { INTERVALS } from '@/domain/intervals';
import type { Candle, CandleInterval, Instrument } from '@/domain/types';

import type { MarketDataProvider, MarketSnapshot, PriceTick } from '../types';
import { buildOutcomes, buildPerps, buildSpot } from './coins';
import {
  fetchCandleSnapshot,
  fetchOutcomeMeta,
  fetchPerpMeta,
  fetchSpotMeta,
  XYZ_DEX,
  type HlCandle,
} from './rest';
import { hlSocket, subscribeAllMids, subscribeCandle } from './ws';

function mapCandle(c: HlCandle): Candle {
  return { t: c.t, o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c), v: Number(c.v) };
}

export const hyperliquidProvider: MarketDataProvider = {
  source: 'hyperliquid',

  async loadMarkets(): Promise<MarketSnapshot> {
    // These catalogs are independent. In particular, the spot payload is much
    // larger than either perp payload and can fail on a mobile connection while
    // the default + xyz dexes are healthy. Treating the independent reads as one
    // Promise.all used to reject the entire provider in that case, leaving the
    // independently-loaded VIX as the only resolvable watchlist row.
    const [perpResult, spotResult, xyzResult, outcomeResult, ratesResult] = await Promise.allSettled([
      fetchPerpMeta(),
      fetchSpotMeta(),
      fetchPerpMeta(XYZ_DEX),
      fetchOutcomeMeta(),
      fetchPerpMeta('para'),
    ]);
    const marketErrors: Record<string, string> = {};
    for (const [segment, result] of [
      ['hyperliquid:perp', perpResult], ['hyperliquid:spot', spotResult],
      ['hyperliquid:xyz', xyzResult], ['hyperliquid:outcome', outcomeResult],
      ['hyperliquid:para', ratesResult],
    ] as const) {
      if (result.status === 'rejected') marketErrors[segment] =
        result.reason instanceof Error ? result.reason.message : 'Market data unavailable';
    }

    const perps =
      perpResult.status === 'fulfilled'
        ? buildPerps(perpResult.value, 'default')
        : { instruments: [], quotes: {} };
    const spots =
      spotResult.status === 'fulfilled'
        ? buildSpot(spotResult.value)
        : { instruments: [], quotes: {} };
    const xyzs =
      xyzResult.status === 'fulfilled'
        ? buildPerps(xyzResult.value, 'xyz')
        : { instruments: [], quotes: {} };
    const rates = ratesResult.status === 'fulfilled'
      ? buildPerps(ratesResult.value, 'para')
      : { instruments: [], quotes: {} };
    const outcomes =
      outcomeResult.status === 'fulfilled' && spotResult.status === 'fulfilled'
        ? buildOutcomes(outcomeResult.value, spotResult.value[1])
        : { instruments: [], quotes: {}, events: [] };
    const outcomeMarketsError =
      outcomeResult.status === 'rejected'
        ? outcomeResult.reason instanceof Error
          ? outcomeResult.reason.message
          : String(outcomeResult.reason)
        : spotResult.status === 'rejected'
          ? 'Hyperliquid outcome price contexts are unavailable.'
          : null;
    if (outcomeMarketsError) marketErrors['hyperliquid:outcome'] = outcomeMarketsError;

    if (
      perps.instruments.length === 0 &&
      spots.instruments.length === 0 &&
      xyzs.instruments.length === 0 &&
      rates.instruments.length === 0 &&
      outcomes.instruments.length === 0
    ) {
      const reasons = [perpResult, spotResult, xyzResult, outcomeResult, ratesResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : String(result.reason),
        );
      throw new Error(
        `Hyperliquid market catalogs unavailable${reasons.length ? `: ${reasons.join('; ')}` : ''}`,
      );
    }

    return {
      instruments: [
        ...perps.instruments,
        ...xyzs.instruments,
        ...rates.instruments,
        ...spots.instruments,
        ...outcomes.instruments,
      ],
      quotes: { ...perps.quotes, ...xyzs.quotes, ...rates.quotes, ...spots.quotes, ...outcomes.quotes },
      outcomeEvents: outcomes.events,
      outcomeMarketsError,
      marketErrors,
    };
  },

  subscribeConnection: (onStatus) => hlSocket.subscribeConnection(onStatus),

  async getCandles(
    instrument: Instrument,
    interval: CandleInterval,
    count = INTERVALS[interval].count,
  ): Promise<Candle[]> {
    const endTime = Date.now();
    const startTime = endTime - INTERVALS[interval].ms * count;
    const raw = await fetchCandleSnapshot(instrument.coinKey, interval, startTime, endTime);
    return raw.map(mapCandle).sort((a, b) => a.t - b.t);
  },

  subscribePrices(coinKeys: string[], onTicks: (ticks: PriceTick[]) => void) {
    const wanted = new Set(coinKeys);
    const dexes = [...new Set(coinKeys.map((key) => key.includes(':') ? key.split(':')[0] : undefined))];

    return subscribeAllMids(dexes, (mids) => {
      const ticks: PriceTick[] = [];
      for (const key of wanted) {
        const px = mids[key];
        if (px !== undefined) ticks.push({ coinKey: key, last: Number(px) });
      }
      if (ticks.length) onTicks(ticks);
    });
  },

  subscribeCandles(instrument: Instrument, interval: CandleInterval, onCandle: (c: Candle) => void) {
    return subscribeCandle(instrument.coinKey, interval, (c) => onCandle(mapCandle(c)));
  },
};
