import { INTERVALS } from '@/domain/intervals';
import type { Candle, CandleInterval, Instrument } from '@/domain/types';

import type { MarketDataProvider, MarketSnapshot, PriceTick } from '../types';
import { buildPerps, buildSpot } from './coins';
import { fetchCandleSnapshot, fetchPerpMeta, fetchSpotMeta, XYZ_DEX, type HlCandle } from './rest';
import { subscribeAllMids, subscribeCandle } from './ws';

function mapCandle(c: HlCandle): Candle {
  return { t: c.t, o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c), v: Number(c.v) };
}

export const hyperliquidProvider: MarketDataProvider = {
  source: 'hyperliquid',

  async loadMarkets(): Promise<MarketSnapshot> {
    // These catalogs are independent. In particular, the spot payload is much
    // larger than either perp payload and can fail on a mobile connection while
    // the default + xyz dexes are healthy. Treating the three reads as one
    // Promise.all used to reject the entire provider in that case, leaving the
    // independently-loaded VIX as the only resolvable watchlist row.
    const [perpResult, spotResult, xyzResult] = await Promise.allSettled([
      fetchPerpMeta(),
      fetchSpotMeta(),
      fetchPerpMeta(XYZ_DEX),
    ]);

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

    if (
      perps.instruments.length === 0 &&
      spots.instruments.length === 0 &&
      xyzs.instruments.length === 0
    ) {
      const reasons = [perpResult, spotResult, xyzResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : String(result.reason),
        );
      throw new Error(
        `Hyperliquid market catalogs unavailable${reasons.length ? `: ${reasons.join('; ')}` : ''}`,
      );
    }

    return {
      instruments: [...perps.instruments, ...xyzs.instruments, ...spots.instruments],
      quotes: { ...perps.quotes, ...xyzs.quotes, ...spots.quotes },
    };
  },

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
    const needsXyz = coinKeys.some((k) => k.startsWith(`${XYZ_DEX}:`));
    const dexes: (string | undefined)[] = [undefined, ...(needsXyz ? [XYZ_DEX] : [])];

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
