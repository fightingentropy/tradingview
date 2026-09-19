import type { Instrument } from '@/domain/types';
import { isProtectiveStop } from '@/lib/accountRisk';
import { formatCompact, formatPrice, priceDecimalsFor } from '@/lib/format';
import type { OrderResult } from '@/lib/hyperliquid/exchange';
import type { HlOpenOrder, HlPosition } from '@/lib/hyperliquid/info';
import { outcomeAssetId } from '@/lib/outcomeMarkets';

/** Shown in place of any account value when privacy mode is on. */
export const MASK = '••••••';

export function qty(size: number): string {
  if (size >= 100_000) return formatCompact(size);
  const d = size >= 1000 ? 0 : size >= 1 ? 3 : 5;
  return String(Number(size.toFixed(d)));
}

export const ISOLATED_MARGIN_BUFFER_USD = 0.01;
export const LIQUIDATION_REVIEW_DRIFT_PCT = 0.1;
export const MARKET_ACTION_SLIPPAGE = 0.05;

/**
 * Hyperliquid retains at least the larger of initial margin and 10% of current
 * notional when margin is transferred out of an isolated position. Keep a cent
 * above that floor so the UI never presents all displayed margin as removable.
 * The exchange remains authoritative and the mutation rechecks this against a
 * fresh account snapshot immediately before signing.
 */
export function isolatedMarginRemovalSafetyLimit(p: HlPosition): number {
  if (
    !(p.marginUsed > 0) ||
    !(p.positionValue > 0) ||
    !(p.leverage > 0) ||
    !(p.markPx > 0) ||
    p.liquidationPx == null ||
    !(p.liquidationPx > 0)
  ) {
    return 0;
  }
  const initialMarginFloor = p.positionValue / p.leverage;
  const transferFloor = Math.max(initialMarginFloor, p.positionValue * 0.1);
  const rawLimit = Math.max(0, p.marginUsed - transferFloor - ISOLATED_MARGIN_BUFFER_USD);
  // The sheet displays cents; round down so the visible ceiling can never be
  // exceeded by a hidden fraction of a cent.
  return Math.floor(rawLimit * 100) / 100;
}

export function positionLiquidationDistancePct(p: HlPosition): number | null {
  if (!(p.markPx > 0) || p.liquidationPx == null || !(p.liquidationPx > 0)) return null;
  return (Math.abs(p.markPx - p.liquidationPx) / p.markPx) * 100;
}

/** Token balance amount, comma-grouped with adaptive precision. */
export function tokenAmt(v: number): string {
  if (v >= 1_000_000_000) return formatCompact(v);
  return formatPrice(v, v >= 1000 ? 2 : v >= 1 ? 4 : 6);
}

export function protectionAckIsAccepted(result: OrderResult | undefined): boolean {
  return !!result && result.status !== 'error' && result.status !== 'unknown';
}

export function protectionAckLabel(result: OrderResult | undefined): string {
  if (!result || result.status === 'unknown') return 'Not confirmed';
  if (result.status === 'error') return `Rejected · ${result.error ?? 'exchange error'}`;
  if (result.status === 'waitingForFill') return 'Acknowledged · waiting for fill';
  if (result.status === 'waitingForTrigger') return 'Acknowledged · waiting for trigger';
  if (result.status === 'resting') return 'Acknowledged · resting';
  if (result.status === 'filled') return 'Filled';
  return 'Acknowledged · success';
}

export class ProtectionPreflightError extends Error {}

export class AccountPreflightError extends Error {}

export class AccountMutationStatusUnknownError extends Error {
  constructor(
    readonly action: 'close' | 'reverse' | 'margin' | 'cancel',
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : 'Unknown exchange error');
  }
}

/** Outcome balances use `+encoding`, while books/orders/catalog entries use `#encoding`. */
export function marketCoinKey(coin: string): string {
  const token = /^\+(\d+)$/.exec(coin);
  return token ? `#${token[1]}` : coin;
}

/** Clean ticker for a position/token coin without exposing machine-only outcome ids as a symbol. */
export const cleanCoin = (coin: string) => {
  const normalized = marketCoinKey(coin);
  const outcome = /^#(\d+)$/.exec(normalized);
  return outcome ? `Outcome #${outcome[1]}` : normalized.replace(/^xyz:/, '');
};

export interface OrderAssetMeta {
  assetIndex: number;
  szDecimals: number;
  isPerp: boolean;
}

/** Resolve both perp and outcome order assets for byte-exact cancellation checks. */
export function orderAssetMeta(
  coin: string,
  perpMeta: Readonly<Record<string, { assetIndex: number; szDecimals: number }>> | undefined,
): OrderAssetMeta | null {
  const normalized = marketCoinKey(coin);
  const encoded = /^#(\d+)$/.exec(normalized);
  if (encoded) {
    const value = Number(encoded[1]);
    const side = value % 10;
    const outcome = Math.floor(value / 10);
    if (!Number.isSafeInteger(value) || outcome < 0 || (side !== 0 && side !== 1)) return null;
    return { assetIndex: outcomeAssetId(outcome, side), szDecimals: 0, isPerp: false };
  }
  const asset = perpMeta?.[coin];
  return asset ? { ...asset, isPerp: true } : null;
}

export function displayPriceDecimals(
  coin: string,
  instrument: Instrument | undefined,
  price: number,
): number {
  const declared = marketCoinKey(coin).startsWith('#')
    ? 5
    : (instrument?.priceDecimals ?? 6);
  return priceDecimalsFor(declared, price);
}

export interface PositionProtectionLevels {
  readonly takeProfitPx: number | null;
  readonly stopLossPx: number | null;
}

/** Nearest live reduce-only TP and SL levels for the position card. */
export function protectionLevelsForPosition(
  position: HlPosition,
  orders: readonly HlOpenOrder[],
): PositionProtectionLevels {
  const closingSide = position.side === 'long' ? 'sell' : 'buy';
  const live = orders
    .filter(
      (order) =>
        order.coin === position.coin &&
        order.side === closingSide &&
        order.reduceOnly &&
        order.isTrigger &&
        (order.triggerPx ?? order.limitPx) > 0,
    )
    .sort(
      (a, b) =>
        Math.abs((a.triggerPx ?? a.limitPx) - position.markPx) -
        Math.abs((b.triggerPx ?? b.limitPx) - position.markPx),
    );
  const takeProfit = live.find((order) => !isProtectiveStop(order, position));
  const stopLoss = live.find((order) => isProtectiveStop(order, position));
  return {
    takeProfitPx: takeProfit?.triggerPx ?? takeProfit?.limitPx ?? null,
    stopLossPx: stopLoss?.triggerPx ?? stopLoss?.limitPx ?? null,
  };
}

export const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Compact timestamp: "HH:MM" for today, else "Mon D" (Intl-free for Hermes). */
export function whenLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Fuller timestamp for an expanded row: "Jun 18, 16:45:48". */
export function fullWhen(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Token-denominated account delta with enough precision for hourly funding/interest. */
export function historyTokenAmount(value: number, sign: '+' | '-' | 'auto' = 'auto'): string {
  const absolute = Math.abs(value);
  const decimals = absolute >= 100 ? 2 : absolute >= 1 ? 4 : 6;
  const prefix = sign === 'auto' ? (value > 0 ? '+' : value < 0 ? '-' : '') : sign;
  return `${prefix}${formatPrice(absolute, decimals)}`;
}

/**
 * Money for the expanded trade breakdown. Sub-$10 amounts (small PnLs and
 * sub-cent fees) get up to 4 dp so the gross − fee = net arithmetic visibly
 * reconciles and tiny fees aren't hidden by cent-rounding; larger amounts stay
 * at 2 dp. Always at least 2 dp.
 */
export function moneyExact(v: number): string {
  const a = Math.abs(v);
  if (a >= 10 || a === 0) return a.toFixed(2);
  const trimmed = a.toFixed(4).replace(/0+$/, '');
  const decimals = trimmed.length - trimmed.indexOf('.') - 1;
  return decimals < 2 ? a.toFixed(2) : trimmed;
}
export const usdExact = (v: number) => '$' + moneyExact(v);
export const signMoneyExact = (v: number) => (v >= 0 ? '+' : '-') + '$' + moneyExact(v);
