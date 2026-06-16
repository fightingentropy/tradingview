/**
 * Hyperliquid Info-endpoint client (public, no auth). All numeric fields are
 * returned as strings by the API and parsed by callers.
 */
import type { CandleInterval } from '@/domain/types';

export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';
export const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws';

/** trade.xyz markets ride this HIP-3 perp dex. */
export const XYZ_DEX = 'xyz';

async function info<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(HL_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid ${String(body.type)} -> HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ----- Response shapes (only the fields we use) -----

export interface PerpUniverseItem {
  name: string;
  szDecimals: number;
  maxLeverage?: number;
  isDelisted?: boolean;
  onlyIsolated?: boolean;
}
export interface PerpAssetCtx {
  markPx: string;
  midPx?: string;
  prevDayPx: string;
  dayNtlVlm: string;
  funding?: string;
  openInterest?: string;
}
export type MetaAndAssetCtxs = [{ universe: PerpUniverseItem[] }, PerpAssetCtx[]];

export interface SpotToken {
  name: string;
  szDecimals: number;
  index: number;
  isCanonical: boolean;
}
export interface SpotUniverseItem {
  name: string;
  tokens: [number, number];
  index: number;
  isCanonical: boolean;
}
export interface SpotAssetCtx {
  markPx: string;
  midPx?: string;
  prevDayPx: string;
  dayNtlVlm: string;
  coin?: string;
}
export type SpotMetaAndAssetCtxs = [
  { universe: SpotUniverseItem[]; tokens: SpotToken[] },
  SpotAssetCtx[],
];

export interface HlCandle {
  t: number;
  T: number;
  /** coin (present on websocket candle frames) */
  s?: string;
  /** interval (present on websocket candle frames) */
  i?: string;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
}

export function fetchPerpMeta(dex?: string) {
  return info<MetaAndAssetCtxs>({ type: 'metaAndAssetCtxs', ...(dex ? { dex } : {}) });
}

export function fetchSpotMeta() {
  return info<SpotMetaAndAssetCtxs>({ type: 'spotMetaAndAssetCtxs' });
}

export function fetchCandleSnapshot(coin: string, interval: CandleInterval, startTime: number, endTime: number) {
  return info<HlCandle[]>({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  });
}
