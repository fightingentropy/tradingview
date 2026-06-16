export type Source = 'hyperliquid' | 'stocks' | 'cboe';

export type AssetClass =
  | 'crypto-perp'
  | 'crypto-spot'
  | 'equity-perp'
  | 'equity'
  | 'fx'
  | 'commodity'
  | 'index';

/** A tradable market shown in lists and on the chart screen. */
export interface Instrument {
  /** Stable unique id, e.g. `hl:perp:BTC`, `hl:spot:@107`, `hl:xyz:XYZ100`, `stk:AAPL`. */
  id: string;
  source: Source;
  assetClass: AssetClass;
  /** Display ticker, e.g. `BTC`, `AAPL`. */
  symbol: string;
  /** Full/long name when known. */
  name: string;
  /** Where it trades — shown as the venue badge. e.g. `Hyperliquid`, `trade.xyz`, `NASDAQ`. */
  venue: string;
  /** Decimals to render prices with. */
  priceDecimals: number;
  /** Provider-native key used for candle + websocket subscriptions (`BTC`, `@107`, `xyz:XYZ100`, `AAPL`). */
  coinKey: string;
  /** Quote currency, e.g. `USD`, `USDC`. */
  quoteCurrency?: string;
}

export interface Quote {
  instrumentId: string;
  last: number;
  prevClose: number | null;
  change24hPct: number | null;
  /** 24h notional volume in quote currency. */
  dayVolume: number | null;
  /** Current hourly funding rate as a fraction (e.g. 0.0000125 = 0.00125%/hr). Perps only; null otherwise. */
  funding?: number | null;
  ts: number;
}

export interface Candle {
  /** Open time, ms epoch. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '1h' | '2h' | '4h' | '8h' | '1d' | '1w' | '1M';

/** Which direction of move arms a price alert. */
export type AlertDirection = 'up' | 'down' | 'both';

/**
 * A user-armed price-move alert. Fires once the live price moves `pct`% away
 * from `anchorPrice` (the price captured when the alert was created), in the
 * configured direction.
 */
export interface PriceAlert {
  id: string;
  instrumentId: string;
  /** Denormalized ticker so the alert renders without a markets lookup. */
  symbol: string;
  /** Percent magnitude that triggers, e.g. 10 means a ±10% move. */
  pct: number;
  direction: AlertDirection;
  /** Price at the moment the alert was armed; the move is measured from here. */
  anchorPrice: number;
  createdAt: number;
  /** When the move fired; null while still armed. */
  triggeredAt: number | null;
  /** Price at the moment it fired; null while still armed. */
  triggeredPrice: number | null;
}
