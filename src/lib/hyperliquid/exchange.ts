/**
 * Hyperliquid trading (the authenticated /exchange endpoint). Builds order
 * actions, signs them with the stored agent key, and submits. Market orders are
 * sent as aggressive IOC limits (mark ± slippage) the way the official SDK does.
 *
 * Every call here moves real funds on mainnet — callers must gate it behind an
 * explicit user confirmation.
 */
import { HL_API, type HlNetwork } from './info';
import { getAgentKey } from './keyStore';
import { priceToWire, signL1Action, sizeToWire } from './sign';

interface OrderWire {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t: { limit: { tif: 'Gtc' | 'Ioc' | 'Alo' } };
}

export interface OrderResult {
  status: 'filled' | 'resting';
  oid?: number;
  avgPx?: number;
  totalSz?: number;
}

const DEFAULT_SLIPPAGE = 0.05;

async function exchangePost(
  network: HlNetwork,
  action: object,
  signature: object,
  nonce: number,
): Promise<unknown[]> {
  const res = await fetch(`${HL_API[network]}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });
  const json = (await res.json()) as {
    status?: string;
    response?: string | { data?: { statuses?: unknown[] } };
  };

  if (json.status !== 'ok') {
    const msg = typeof json.response === 'string' ? json.response : `Hyperliquid error (${res.status})`;
    throw new Error(msg);
  }

  const statuses =
    typeof json.response === 'object' && json.response?.data?.statuses
      ? json.response.data.statuses
      : [];
  const errored = statuses.find(
    (s): s is { error: string } => !!s && typeof s === 'object' && 'error' in s,
  );
  if (errored) throw new Error(errored.error);
  return statuses;
}

function normalizeStatus(raw: unknown): OrderResult {
  const s = raw as {
    resting?: { oid: number };
    filled?: { oid: number; avgPx: string; totalSz: string };
  };
  if (s?.filled) {
    return {
      status: 'filled',
      oid: s.filled.oid,
      avgPx: Number(s.filled.avgPx),
      totalSz: Number(s.filled.totalSz),
    };
  }
  return { status: 'resting', oid: s?.resting?.oid };
}

export interface PlaceOrderParams {
  network: HlNetwork;
  assetIndex: number;
  szDecimals: number;
  isBuy: boolean;
  /** Order size in coins. */
  size: number;
  reduceOnly?: boolean;
  /** Provide for a limit order; omit for a market order. */
  limitPrice?: number;
  /** Required for a market order — the current mark used to derive the IOC cap. */
  markPx?: number;
  slippage?: number;
}

export async function placeOrder(p: PlaceOrderParams): Promise<OrderResult> {
  const key = getAgentKey();
  if (!key) throw new Error('No API wallet key set. Add one in Settings to trade.');

  const isMainnet = p.network === 'mainnet';
  const isMarket = p.limitPrice === undefined;

  let px: number;
  let tif: 'Gtc' | 'Ioc';
  if (isMarket) {
    if (!p.markPx) throw new Error('Missing mark price for market order.');
    const slip = p.slippage ?? DEFAULT_SLIPPAGE;
    px = p.isBuy ? p.markPx * (1 + slip) : p.markPx * (1 - slip);
    tif = 'Ioc';
  } else {
    px = p.limitPrice as number;
    tif = 'Gtc';
  }

  const order: OrderWire = {
    a: p.assetIndex,
    b: p.isBuy,
    p: priceToWire(px, p.szDecimals),
    s: sizeToWire(p.size, p.szDecimals),
    r: !!p.reduceOnly,
    t: { limit: { tif } },
  };
  const action = { type: 'order', orders: [order], grouping: 'na' };
  const nonce = Date.now();
  const signature = signL1Action(key, action, nonce, isMainnet, null);

  const statuses = await exchangePost(p.network, action, signature, nonce);
  return normalizeStatus(statuses[0]);
}

export interface MarketCloseParams {
  network: HlNetwork;
  assetIndex: number;
  szDecimals: number;
  /** Direction of the position being closed. */
  positionIsLong: boolean;
  size: number;
  markPx: number;
  slippage?: number;
}

/** Flatten a position with a reduce-only market order on the opposite side. */
export async function marketClose(p: MarketCloseParams): Promise<OrderResult> {
  return placeOrder({
    network: p.network,
    assetIndex: p.assetIndex,
    szDecimals: p.szDecimals,
    isBuy: !p.positionIsLong,
    size: p.size,
    reduceOnly: true,
    markPx: p.markPx,
    slippage: p.slippage,
  });
}

/**
 * Flip a position to the opposite side at the same size: a single **2× market
 * order** on the opposite side (NOT reduce-only) closes the current position and
 * opens an equal one the other way — e.g. long 5 → sell 10 → short 5. Needs free
 * collateral for the new side, so the exchange may reject it; gate behind confirm.
 */
export async function reversePosition(p: MarketCloseParams): Promise<OrderResult> {
  return placeOrder({
    network: p.network,
    assetIndex: p.assetIndex,
    szDecimals: p.szDecimals,
    isBuy: !p.positionIsLong,
    size: p.size * 2,
    reduceOnly: false,
    markPx: p.markPx,
    slippage: p.slippage,
  });
}
