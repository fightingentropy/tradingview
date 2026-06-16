import type { Candle, CandleInterval, Instrument, Quote, Source } from '@/domain/types';

export type Unsubscribe = () => void;

/** A single live last-price tick. */
export interface PriceTick {
  /** Provider-native coin key (e.g. `BTC`, `@107`, `xyz:TSLA`, `AAPL`). */
  coinKey: string;
  last: number;
}

export interface MarketSnapshot {
  instruments: Instrument[];
  /** Snapshot quotes (last, 24h change, volume) keyed by instrument id. */
  quotes: Record<string, Quote>;
}

/**
 * Unified market-data interface implemented per source (Hyperliquid, stocks).
 * The UI talks to providers only through this shape so it never branches on source.
 */
export interface MarketDataProvider {
  source: Source;

  /** Full catalog + a snapshot of stats in one shot. */
  loadMarkets(): Promise<MarketSnapshot>;

  /** Historical candles to seed a chart. */
  getCandles(instrument: Instrument, interval: CandleInterval): Promise<Candle[]>;

  /**
   * Stream live last prices for the given coin keys. Returns an unsubscribe fn.
   * Providers without streaming can omit this (the UI falls back to snapshot/polling).
   */
  subscribePrices?(coinKeys: string[], onTicks: (ticks: PriceTick[]) => void): Unsubscribe;

  /** Stream live candle updates for the open chart. */
  subscribeCandles?(
    instrument: Instrument,
    interval: CandleInterval,
    onCandle: (candle: Candle) => void,
  ): Unsubscribe;
}
