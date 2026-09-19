import type { OrderResult, TriggerLeg } from './hyperliquid/exchange';
import type { HlNetwork } from './hyperliquid/info';
import type { SignedTradingIdentityBinding } from './hyperliquid/tradingIdentity';
import type { TradeSizeMode } from './tradeTicket';

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type SizeMode = TradeSizeMode;
export type RiskUnit = 'usd' | 'percent';

export interface TradeSubmission {
  results: OrderResult[];
  legTypes: TriggerLeg['tpsl'][];
  coin: string;
  network: HlNetwork;
  connectionAddress: string | null;
  requestedSize: number;
  szDecimals: number;
  action: string;
  orderType: OrderType;
  limitPrice?: number;
  fullClose: boolean;
  reduceOnly: boolean;
}

export interface PositionDraft {
  readonly side: 'long' | 'short';
  readonly size: number;
}

export interface ActiveSettingsDraft {
  readonly leverage: number;
  readonly isCross: boolean;
}

export interface TradeDraft {
  readonly network: HlNetwork;
  readonly connectionAddress: string | null;
  readonly identity: SignedTradingIdentityBinding;
  readonly coin: string;
  readonly assetIndex: number;
  readonly szDecimals: number;
  readonly side: Side;
  readonly action: string;
  readonly size: number;
  readonly reduceOnly: boolean;
  readonly closing: boolean;
  readonly fullClose: boolean;
  readonly orderType: OrderType;
  readonly limitPrice?: number;
  readonly postOnly: boolean;
  readonly slippage: number;
  readonly executionMidPx: number;
  readonly hardIocPx: number;
  readonly triggerMarkPx: number;
  readonly riskEntryPx: number;
  readonly leverage: number;
  readonly isCross: boolean;
  readonly needsLeverageUpdate: boolean;
  readonly expectedActive: ActiveSettingsDraft | null;
  readonly expectedPosition: PositionDraft | null;
  readonly triggers: readonly Readonly<TriggerLeg>[];
}

export class TradePreflightError extends Error {
  override name = 'TradePreflightError';
}

export class TradeSubmissionUnknownError extends Error {
  override name = 'TradeSubmissionUnknownError';

  constructor(
    message: string,
    readonly leveragePostAttempted: boolean,
    readonly leveragePostSucceeded: boolean,
    readonly orderPostAttempted: boolean,
  ) {
    super(message);
  }
}

export const num = (s: string) => {
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return isFinite(v) ? v : 0;
};

export const floorSize = (size: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.floor(Math.max(0, size) * factor) / factor;
};

export const compactNumber = (value: number, decimals: number) =>
  Number(value.toFixed(decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals });

// Tier-0 perp taker fees are currently 0.045%. HIP-3 deployer fee scaling can make
// that materially higher, so risk previews reserve 0.05%/fill for core and
// 0.30%/fill for HIP-3. Actual user-tier/referral fees may be lower.
export const CORE_FEE_ALLOWANCE = 0.0005;
export const HIP3_FEE_ALLOWANCE = 0.003;

export const adverseEntryBound = (mark: number, isBuy: boolean, slippage: number) =>
  isBuy ? mark * (1 + slippage) : mark * (1 - slippage);

export const lotQuantized = (size: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(size * factor) / factor;
};

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unknown trading error';

export function triggerLegIsValid(
  leg: Readonly<TriggerLeg>,
  side: Side,
  riskEntryPx: number,
  triggerMarkPx: number,
  slippage: number,
) {
  const isBuy = side === 'buy';
  if (leg.tpsl === 'tp') {
    return isBuy
      ? leg.triggerPx > riskEntryPx && leg.triggerPx > triggerMarkPx
      : leg.triggerPx < riskEntryPx && leg.triggerPx < triggerMarkPx;
  }
  const stopFillPx = isBuy
    ? leg.triggerPx * (1 - slippage)
    : leg.triggerPx * (1 + slippage);
  const losesAtBound = isBuy ? stopFillPx < riskEntryPx : stopFillPx > riskEntryPx;
  const waitsForTrigger = isBuy ? leg.triggerPx < triggerMarkPx : leg.triggerPx > triggerMarkPx;
  return losesAtBound && waitsForTrigger;
}

export function lossPerCoinAtBounds({
  entryPx,
  stopTriggerPx,
  isBuy,
  slippage,
  feeRate,
}: {
  entryPx: number;
  stopTriggerPx: number;
  isBuy: boolean;
  slippage: number;
  feeRate: number;
}) {
  const stopFillPx = isBuy
    ? stopTriggerPx * (1 - slippage)
    : stopTriggerPx * (1 + slippage);
  const priceLossPerCoin = isBuy ? entryPx - stopFillPx : stopFillPx - entryPx;
  if (!(entryPx > 0) || !(stopFillPx > 0) || !(priceLossPerCoin > 0)) {
    return { stopFillPx, priceLossPerCoin: 0, feesPerCoin: 0, totalPerCoin: 0 };
  }
  const feesPerCoin = (entryPx + stopFillPx) * feeRate;
  return {
    stopFillPx,
    priceLossPerCoin,
    feesPerCoin,
    totalPerCoin: priceLossPerCoin + feesPerCoin,
  };
}

/** Derive risk size only from prices the wire order can permit, never a likely VWAP. */
export function deriveRiskCoinSize({
  budget,
  isBuy,
  orderType,
  limitPx,
  executionMidPx,
  stopTriggerPx,
  slippage,
  feeRate,
  sizeDecimals,
}: {
  budget: number;
  isBuy: boolean;
  orderType: OrderType;
  limitPx: number;
  executionMidPx: number;
  stopTriggerPx: number;
  slippage: number;
  feeRate: number;
  sizeDecimals: number;
}) {
  if (!(budget > 0) || !(stopTriggerPx > 0) || !(executionMidPx > 0)) return 0;
  const entryPx =
    orderType === 'limit'
      ? limitPx
      : adverseEntryBound(executionMidPx, isBuy, slippage);
  const loss = lossPerCoinAtBounds({ entryPx, stopTriggerPx, isBuy, slippage, feeRate });
  return loss.totalPerCoin > 0 ? floorSize(budget / loss.totalPerCoin, sizeDecimals) : 0;
}

/** A short ladder of leverage presets up to (and including) the asset's max. */
export function levPresets(maxLev: number): number[] {
  const base = [1, 2, 5, 10, 20].filter((x) => x < maxLev);
  return Array.from(new Set([...base, Math.max(1, maxLev)])).sort((a, b) => a - b);
}
