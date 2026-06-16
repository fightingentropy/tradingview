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
    const [perp, spot, xyz] = await Promise.all([
      fetchPerpMeta(),
      fetchSpotMeta(),
      fetchPerpMeta(XYZ_DEX).catch(() => null),
    ]);

    const perps = buildPerps(perp, 'default');
    const spots = buildSpot(spot);
    const xyzs = xyz ? buildPerps(xyz, 'xyz') : { instruments: [], quotes: {} };

    return {
      instruments: [...perps.instruments, ...xyzs.instruments, ...spots.instruments],
      quotes: { ...perps.quotes, ...xyzs.quotes, ...spots.quotes },
    };
  },

  async getCandles(instrument: Instrument, interval: CandleInterval): Promise<Candle[]> {
    const meta = INTERVALS[interval];
    const endTime = Date.now();
    const startTime = endTime - meta.ms * meta.count;
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
