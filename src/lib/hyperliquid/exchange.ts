/**
 * Hyperliquid trading (the authenticated /exchange endpoint). Builds order
 * actions, signs them with the stored agent key, and submits. Market orders are
 * sent as aggressive IOC limits (mark ± slippage) the way the official SDK does.
 *
 * Every call here moves real funds on mainnet — callers must gate it behind an
 * explicit user confirmation.
 */
import { fetchWithTimeout, HL_API, type HlNetwork } from './info';
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

/**
 * Strictly-increasing nonce. Hyperliquid rejects a reused nonce, so two orders
 * fired in the same millisecond (a close-then-reverse, or a quick retry) must
 * not collide on `Date.now()`. We hand out the later of wall-clock time and
 * lastNonce + 1, then remember it.
 */
let lastNonce = 0;
function nextNonce(): number {
  lastNonce = Math.max(Date.now(), lastNonce + 1);
  return lastNonce;
}

async function exchangePost(
  network: HlNetwork,
  action: object,
  signature: object,
  nonce: number,
): Promise<unknown[]> {
  const res = await fetchWithTimeout(`${HL_API[network]}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });
  if (!res.ok) throw new Error(`Hyperliquid exchange ${res.status}`);
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
  // status:'ok' with no statuses means the order neither rested nor filled —
  // don't report a phantom success to the caller.
  if (statuses.length === 0) throw new Error('Hyperliquid returned no order status');
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
  const nonce = nextNonce();
  const signature = signL1Action(key, action, nonce, isMainnet, null);

  const statuses = await exchangePost(p.network, action, signature, nonce);
  const first = statuses[0];
  if (first === undefined) throw new Error('Hyperliquid returned no order status');
  return normalizeStatus(first);
}

export interface UpdateLeverageParams {
  network: HlNetwork;
  /** Order asset-id (same scheme as orders — incl. the xyz 110000+ offset). */
  assetIndex: number;
  isCross: boolean;
  /** Integer leverage, 1..maxLeverage. */
  leverage: number;
}

/**
 * Set the account's leverage + margin mode for an asset (Hyperliquid's `updateLeverage`).
 * Asset-level setting that applies to the next order and any open position on that asset,
 * so it's gated behind the same confirm as the order itself. Real funds on mainnet.
 */
export async function updateLeverage(p: UpdateLeverageParams): Promise<void> {
  const key = getAgentKey();
  if (!key) throw new Error('No API wallet key set. Add one in Settings to trade.');

  const action = {
    type: 'updateLeverage',
    asset: p.assetIndex,
    isCross: p.isCross,
    leverage: Math.round(p.leverage),
  };
  const nonce = nextNonce();
  const signature = signL1Action(key, action, nonce, p.network === 'mainnet', null);

  const res = await fetchWithTimeout(`${HL_API[p.network]}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });
  if (!res.ok) throw new Error(`Hyperliquid exchange ${res.status}`);
  const json = (await res.json()) as { status?: string; response?: unknown };
  if (json.status !== 'ok') {
    throw new Error(
      typeof json.response === 'string' ? json.response : `Couldn't set leverage (${res.status})`,
    );
  }
}

export interface UpdateIsolatedMarginParams {
  network: HlNetwork;
  /** Order asset-id (same scheme as orders — incl. the xyz 110000+ offset). */
  assetIndex: number;
  /** USD to move: positive tops up the position's margin, negative pulls it back. */
  usd: number;
}

/**
 * Add or remove isolated margin on an open position (Hyperliquid's
 * `updateIsolatedMargin`). `ntli` is the signed amount in micro-USD (1e6) — a
 * positive value moves free collateral into the position's isolated margin, a
 * negative value pulls margin back to the available balance. Isolated positions
 * only; the exchange rejects a removal that would breach maintenance margin.
 * Real funds on mainnet — gate behind a confirm. (`isBuy` is a fixed field the
 * API requires; direction is carried by the sign of `ntli`.)
 */
export async function updateIsolatedMargin(p: UpdateIsolatedMarginParams): Promise<void> {
  const key = getAgentKey();
  if (!key) throw new Error('No API wallet key set. Add one in Settings to trade.');

  const action = {
    type: 'updateIsolatedMargin',
    asset: p.assetIndex,
    isBuy: true,
    ntli: Math.round(p.usd * 1e6),
  };
  const nonce = nextNonce();
  const signature = signL1Action(key, action, nonce, p.network === 'mainnet', null);

  // Like updateLeverage, this returns {status:'ok', response:{type:'default'}} with
  // no per-order statuses, so it doesn't go through exchangePost.
  const res = await fetchWithTimeout(`${HL_API[p.network]}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });
  if (!res.ok) throw new Error(`Hyperliquid exchange ${res.status}`);
  const json = (await res.json()) as { status?: string; response?: unknown };
  if (json.status !== 'ok') {
    throw new Error(
      typeof json.response === 'string' ? json.response : `Couldn't adjust margin (${res.status})`,
    );
  }
}

export interface CancelOrderParams {
  network: HlNetwork;
  /** Order asset-id (same scheme as placing — incl. the xyz 110000+ offset). */
  assetIndex: number;
  oid: number;
}

/** Cancel a single resting order. Real funds on mainnet — gate behind a confirm. */
export async function cancelOrder(p: CancelOrderParams): Promise<void> {
  const key = getAgentKey();
  if (!key) throw new Error('No API wallet key set. Add one in Settings to trade.');

  const action = { type: 'cancel', cancels: [{ a: p.assetIndex, o: p.oid }] };
  const nonce = nextNonce();
  const signature = signL1Action(key, action, nonce, p.network === 'mainnet', null);
  // exchangePost throws on a non-ok response or an errored status (e.g. already filled/canceled).
  await exchangePost(p.network, action, signature, nonce);
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
