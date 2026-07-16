import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useActiveAsset } from '@/data/useActiveAsset';
import { useHlAccount, useTradingIdentity } from '@/data/useHlAccount';
import { useHlMeta } from '@/data/useHlMeta';
import { useOrderBook } from '@/data/useOrderBook';
import { estimateExecution } from '@/domain/execution';
import {
  placeBracket,
  placeOrder,
  updateLeverage,
  type OrderResult,
  type TriggerLeg,
} from '@/lib/hyperliquid/exchange';
import type { HlNetwork } from '@/lib/hyperliquid/info';
import {
  assertTradingIdentityCurrent,
  signedIdentityBinding,
  type SignedTradingIdentityBinding,
} from '@/lib/hyperliquid/tradingIdentity';
import { formatPrice, signedUsd, usd } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { defaultTradeSizeMode, type TradeSizeMode } from '@/lib/tradeTicket';
import { materiallyDifferentMid } from '@/lib/tradePreflight';
import { useHlConnection } from '@/store/hlConnection';

type Side = 'buy' | 'sell';
type OrderType = 'market' | 'limit';
type SizeMode = TradeSizeMode;
type RiskUnit = 'usd' | 'percent';

interface TradeSubmission {
  results: OrderResult[];
  legTypes: TriggerLeg['tpsl'][];
  coin: string;
  network: HlNetwork;
  connectionAddress: string | null;
  requestedSize: number;
  szDecimals: number;
  action: string;
  fullClose: boolean;
  reduceOnly: boolean;
  /** undefined = refresh unavailable/context changed; null = confirmed flat. */
  remainingPosition?: PositionDraft | null;
}

interface PositionDraft {
  readonly side: 'long' | 'short';
  readonly size: number;
}

interface ActiveSettingsDraft {
  readonly leverage: number;
  readonly isCross: boolean;
}

interface TradeDraft {
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

class TradePreflightError extends Error {
  override name = 'TradePreflightError';
}

class TradeSubmissionUnknownError extends Error {
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

export interface TradeTicketProps {
  visible: boolean;
  onClose: () => void;
  /** Catalog coin key used to resolve the order asset-id from meta (e.g. "BTC", "xyz:MU"). */
  coin: string;
  /** Clean ticker for display (e.g. "MU"). Defaults to {@link coin}. */
  symbol?: string;
  /** Hyperliquid mark-price fallback used for TP/SL trigger validation. */
  markPx: number;
  /** Optional allMids/chart midpoint fallback for market IOC pricing. */
  executionMidPx?: number;
  priceDecimals: number;
  initialSide?: Side;
  /** Start on Market or Limit (default Market). */
  initialType?: OrderType;
  /** Keep the initial side fixed (used by contextual Add actions). */
  lockSide?: boolean;
  /** Optional sheet heading for contextual actions. */
  title?: string;
  /** Optional verb used by the review and submit actions (e.g. "Reduce"). */
  actionLabel?: string;
  /** Prefill the size, in coins (switches the size field to coin mode). */
  initialSizeCoin?: number;
  /** Close mode: lock reduce-only on, fix the side, label the action "Close". */
  closing?: boolean;
}

/** Conservative default; the user can adjust it under Advanced up to 5%. */
const DEFAULT_SLIPPAGE_PCT = '0.5';

/** Ties the numeric fields to their keyboard accessory bar (decimal-pads have no Done key). */
const ACCESSORY_ID = 'trade-ticket-kb';

const LIQUID_GLASS = isLiquidGlassAvailable();
// Translucent fills so the dark glass reads through the grouped panels.
const GLASS_FILL = 'rgba(255,255,255,0.06)';
const GLASS_FILL_STRONG = 'rgba(255,255,255,0.13)';
const GLASS_INSET = 'rgba(0,0,0,0.28)';
const GLASS_HAIRLINE = 'rgba(255,255,255,0.10)';

/** The sheet surface: iOS 26 dark Liquid Glass when available, else a near-black panel. */
function SheetSurface({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  if (LIQUID_GLASS) {
    return (
      <GlassView style={style} glassEffectStyle="regular" colorScheme="dark">
        {children}
      </GlassView>
    );
  }
  return <View style={[style, styles.sheetFallback]}>{children}</View>;
}

const num = (s: string) => {
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return isFinite(v) ? v : 0;
};

const floorSize = (size: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.floor(Math.max(0, size) * factor) / factor;
};

const compactNumber = (value: number, decimals: number) =>
  Number(value.toFixed(decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals });

// Tier-0 perp taker fees are currently 0.045%. HIP-3 deployer fee scaling can make
// that materially higher, so risk previews reserve 0.05%/fill for core and
// 0.30%/fill for HIP-3. Actual user-tier/referral fees may be lower.
const CORE_FEE_ALLOWANCE = 0.0005;
const HIP3_FEE_ALLOWANCE = 0.003;

const adverseEntryBound = (mark: number, isBuy: boolean, slippage: number) =>
  isBuy ? mark * (1 + slippage) : mark * (1 - slippage);

const lotQuantized = (size: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(size * factor) / factor;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unknown trading error';

function triggerLegIsValid(
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

function lossPerCoinAtBounds({
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
function deriveRiskCoinSize({
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
function levPresets(maxLev: number): number[] {
  const base = [1, 2, 5, 10, 20].filter((x) => x < maxLev);
  return Array.from(new Set([...base, Math.max(1, maxLev)])).sort((a, b) => a - b);
}

export function TradeTicket({
  visible,
  onClose,
  coin,
  symbol,
  markPx,
  executionMidPx,
  priceDecimals,
  initialSide,
  initialType,
  lockSide,
  title,
  actionLabel,
  initialSizeCoin,
  closing,
}: TradeTicketProps) {
  const label = symbol ?? coin;
  const qc = useQueryClient();
  const network = useHlConnection((s) => s.network);
  const connectionAddress = useHlConnection((s) => s.address);
  const hasKey = useHlConnection((s) => s.hasKey);
  const demo = useHlConnection((s) => s.demo);
  const { data: tradingIdentity } = useTradingIdentity();
  const authenticatedIdentity = signedIdentityBinding(tradingIdentity);
  const { data: meta } = useHlMeta();
  const { data: account, refetch: refetchAccount } = useHlAccount();
  const {
    data: active,
    isLoading: activeLoading,
    isError: activeError,
    refetch: refetchActive,
  } = useActiveAsset(coin);
  const { data: orderBook, refetch: refetchOrderBook } = useOrderBook(
    visible ? coin : undefined,
  );
  const liveContextRef = useRef({ coin, visible, mounted: true });
  useEffect(() => {
    liveContextRef.current = { coin, visible, mounted: true };
    return () => {
      liveContextRef.current.mounted = false;
    };
  }, [coin, visible]);

  const [side, setSide] = useState<Side>(initialSide ?? 'buy');
  const [orderType, setOrderType] = useState<OrderType>(initialType ?? 'market');
  // Start in the asset's native unit (for example, SNDK). USD and risk sizing
  // remain explicit alternatives, while prefilled closes keep their exact coin size.
  const [sizeMode, setSizeMode] = useState<SizeMode>(defaultTradeSizeMode);
  const [riskUnit, setRiskUnit] = useState<RiskUnit>('usd');
  const [amount, setAmount] = useState(initialSizeCoin != null ? String(initialSizeCoin) : '');
  const [limitPrice, setLimitPrice] = useState('');
  // In close mode reduce-only is forced on and not user-toggleable.
  const [reduceOnly, setReduceOnly] = useState(!!closing);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [slippagePct, setSlippagePct] = useState(DEFAULT_SLIPPAGE_PCT);
  // Leverage / margin overrides — null means "follow the account's current setting".
  const [levOverride, setLevOverride] = useState<number | null>(null);
  const [crossOverride, setCrossOverride] = useState<boolean | null>(null);
  const [result, setResult] = useState<TradeSubmission | null>(null);
  // Optional bracket: take-profit / stop-loss to attach to a new entry.
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  // Which numeric field owns the keyboard, so the accessory steppers nudge the right one.
  const [focused, setFocused] = useState<'size' | 'limit' | 'tp' | 'sl' | 'slippage' | null>(null);

  const assetMeta = meta?.[coin];
  const maxLev = Math.max(1, assetMeta?.maxLeverage ?? 1);
  const isBuy = side === 'buy';
  const limitNum = num(limitPrice);
  const tpNum = num(tpPrice);
  const slNum = num(slPrice);
  const slippagePctNum = num(slippagePct);
  const marketSlippage = slippagePctNum / 100;
  // activeAssetData exposes Hyperliquid's actual mark, which is what TP/SL orders
  // trigger on. The prop remains a resilient fallback while that query loads.
  const triggerMarkPx = active?.markPx && active.markPx > 0 ? active.markPx : markPx;
  const bestBidPx = orderBook?.bids[0]?.price;
  const bestAskPx = orderBook?.asks[0]?.price;
  const bookMidPx =
    bestBidPx && bestBidPx > 0 && bestAskPx && bestAskPx > 0
      ? (bestBidPx + bestAskPx) / 2
      : null;
  // Market IOC prices follow executable market context, not the trigger mark:
  // fresh book midpoint → chart/allMids prop → mark only as a final fallback.
  const resolvedExecutionMidPx =
    bookMidPx ??
    (executionMidPx && executionMidPx > 0 ? executionMidPx : null) ??
    triggerMarkPx;
  const touchPx = isBuy ? bestAskPx : bestBidPx;
  const sizingPx =
    orderType === 'limit' && limitNum > 0 ? limitNum : (touchPx ?? resolvedExecutionMidPx);
  const feeRate = coin.startsWith('xyz:') ? HIP3_FEE_ALLOWANCE : CORE_FEE_ALLOWANCE;

  // Effective leverage / margin mode: an explicit user pick wins, else the live
  // account setting. If that lookup is unavailable we enforce 1x isolated before
  // opening, rather than silently inheriting an unknown high-risk account setting.
  const leverage = levOverride ?? active?.leverage ?? 1;
  const isCross = crossOverride ?? active?.isCross ?? false;
  const userSetLev = levOverride !== null || crossOverride !== null;

  // Account risk follows the mode-aware collateral base (Standard, Unified, or
  // Portfolio Margin) rather than total portfolio equity or inaccessible vaults.
  const riskBase = Math.max(0, account?.riskSizingBase ?? 0);
  const percentageRiskUnavailable = account?.abstractionMode === 'portfolioMargin';
  const riskBudget =
    sizeMode === 'risk'
      ? riskUnit === 'usd'
        ? num(amount)
        : (riskBase * num(amount)) / 100
      : 0;
  const rawCoinSize =
    sizeMode === 'usd'
      ? sizingPx > 0
        ? num(amount) / sizingPx
        : 0
      : sizeMode === 'risk'
        ? deriveRiskCoinSize({
            budget: riskBudget,
            isBuy,
            orderType,
            limitPx: limitNum,
            executionMidPx: resolvedExecutionMidPx,
            stopTriggerPx: slNum,
            slippage: marketSlippage,
            feeRate,
            sizeDecimals: assetMeta?.szDecimals ?? 4,
          })
        : num(amount);
  // Hyperliquid sizes have a fixed decimal precision. Round down in the UI so the
  // review values exactly match the wire order and never exceed a risk/capacity limit.
  const coinSize = floorSize(rawCoinSize, assetMeta?.szDecimals ?? 4);
  const execution = estimateExecution(orderBook, isBuy, coinSize);
  const marketEntryBoundPx = adverseEntryBound(
    resolvedExecutionMidPx,
    isBuy,
    marketSlippage,
  );
  const likelyEntryPx =
    orderType === 'limit'
      ? limitNum > 0
        ? limitNum
        : sizingPx
      : execution?.sufficientDepth
        ? execution.averagePrice
        : (touchPx ?? resolvedExecutionMidPx);
  const refPx =
    orderType === 'limit'
      ? limitNum > 0
        ? limitNum
        : sizingPx
      : marketEntryBoundPx;
  const stopLoss = lossPerCoinAtBounds({
    entryPx: refPx,
    stopTriggerPx: slNum,
    isBuy,
    slippage: marketSlippage,
    feeRate,
  });
  const tpOk =
    tpNum <= 0 ||
    triggerLegIsValid(
      { tpsl: 'tp', triggerPx: tpNum },
      side,
      refPx,
      triggerMarkPx,
      marketSlippage,
    );
  const slOk =
    slNum <= 0 ||
    triggerLegIsValid(
      { tpsl: 'sl', triggerPx: slNum },
      side,
      refPx,
      triggerMarkPx,
      marketSlippage,
    );
  const stopDistance = slOk ? stopLoss.priceLossPerCoin : 0;
  const notional = coinSize * refPx;
  const marginRequired = leverage > 0 ? notional / leverage : 0;
  const sideColor = side === 'buy' ? Colors.up : Colors.down;

  // Buying power for this side, and the largest order it supports at this leverage.
  const avail = active
    ? side === 'buy'
      ? active.availBuy
      : active.availSell
    : (account?.freeCollateral ?? 0);
  const maxSz = active && !userSetLev
    ? side === 'buy'
      ? active.maxSzBuy
      : active.maxSzSell
    : refPx > 0
      ? (avail * leverage) / refPx
      : 0;
  const capacityKnown = !!active || !!account;

  const currentPosition = account?.positions.find((p) => p.coin === coin);
  const currentSigned = currentPosition
    ? currentPosition.side === 'long'
      ? currentPosition.size
      : -currentPosition.size
    : 0;
  const orderDelta = isBuy ? coinSize : -coinSize;
  const projectedSigned = reduceOnly
    ? currentSigned > 0 && orderDelta < 0
      ? Math.max(0, currentSigned + orderDelta)
      : currentSigned < 0 && orderDelta > 0
        ? Math.min(0, currentSigned + orderDelta)
        : currentSigned
    : currentSigned + orderDelta;
  const formatPosition = (signed: number) => {
    const tolerance = 1 / 10 ** (assetMeta?.szDecimals ?? 4);
    if (Math.abs(signed) < tolerance) return 'Flat';
    return `${signed > 0 ? 'Long' : 'Short'} ${compactNumber(
      Math.abs(signed),
      assetMeta?.szDecimals ?? 4,
    )} ${label}`;
  };
  const positionImplication = account
    ? `${formatPosition(currentSigned)} → ${formatPosition(projectedSigned)}`
    : null;

  // Estimated liquidation for a *new isolated* position. Cross margin depends on the
  // whole account, so — like the official app — we show N/A.
  const liqPrice = (() => {
    if (closing || reduceOnly || currentPosition || isCross) return null;
    if (!(notional > 0) || !(refPx > 0) || leverage <= 0) return null;
    const mmf = 1 / (2 * maxLev); // maintenance margin fraction ≈ half initial at max leverage
    const s = side === 'buy' ? 1 : -1;
    const denom = 1 - mmf * s;
    if (denom === 0) return null;
    const liq = refPx - (s * refPx * (1 / leverage - mmf)) / denom;
    return liq > 0 ? liq : null;
  })();

  const tradable = hasKey && !demo && !!authenticatedIdentity;
  const validSize =
    coinSize > 0 && refPx > 0 && (orderType === 'market' || num(limitPrice) > 0);

  // Optional bracket (open orders only). A trigger must sit on the correct side of
  // the entry — TP in profit, SL in loss — or the exchange fires/rejects it at once.
  const hasBracket = !closing && !reduceOnly && (tpNum > 0 || slNum > 0);
  const bracketOk = closing || reduceOnly || (tpOk && slOk);
  const grossTpPnl = tpNum > 0 ? (tpNum - refPx) * coinSize * (isBuy ? 1 : -1) : 0;
  const tpFeeAllowance = tpNum > 0 ? (refPx + tpNum) * coinSize * feeRate : 0;
  const tpPnl = grossTpPnl - tpFeeAllowance;
  const priceLossAtStop = stopLoss.priceLossPerCoin * coinSize;
  const feeAllowanceAtStop = stopLoss.feesPerCoin * coinSize;
  const maxLoss =
    slNum > 0 && slOk && coinSize > 0 ? stopLoss.totalPerCoin * coinSize : null;
  const slPnl = maxLoss ? -maxLoss : 0;
  const rewardRisk =
    tpNum > 0 && tpOk && maxLoss && maxLoss > 0 ? Math.max(0, tpPnl) / maxLoss : null;
  const entrySlippageAllowance =
    orderType === 'market'
      ? Math.max(
          0,
          isBuy ? refPx - resolvedExecutionMidPx : resolvedExecutionMidPx - refPx,
        ) * coinSize
      : 0;
  const lossEstimateBasis =
    orderType === 'limit'
      ? 'Limit + stop cap + fee allowance'
      : 'Entry IOC cap + stop cap + fee allowance';

  const needsSlippage = orderType === 'market' || hasBracket;
  const slippageOk = !needsSlippage || (slippagePctNum >= 0.01 && slippagePctNum <= 5);
  const visibleDepthShort = orderType === 'market' && !!execution && !execution.sufficientDepth;
  const estimatedBeyondCap =
    orderType === 'market' &&
    !!execution &&
    resolvedExecutionMidPx > 0 &&
    (isBuy
      ? execution.averagePrice > resolvedExecutionMidPx * (1 + marketSlippage)
      : execution.averagePrice < resolvedExecutionMidPx * (1 - marketSlippage));
  const riskOk =
    sizeMode !== 'risk' ||
    (riskBudget > 0 && stopDistance > 0 && slOk && (riskUnit !== 'percent' || riskBase > 0));
  const withinCapacity =
    !!closing || reduceOnly || !capacityKnown || coinSize <= maxSz + 1e-12;
  const reducesCurrent =
    !!currentPosition &&
    ((currentPosition.side === 'long' && side === 'sell') ||
      (currentPosition.side === 'short' && side === 'buy'));
  const reduceOnlyOk =
    !reduceOnly ||
    (reducesCurrent && coinSize <= (currentPosition?.size ?? 0) + 1e-12);
  const cannotSafelyFallback =
    !closing && !reduceOnly && !active && (!account || !!currentPosition);

  const canSubmit =
    tradable &&
    !!account &&
    !!assetMeta &&
    validSize &&
    bracketOk &&
    riskOk &&
    slippageOk &&
    withinCapacity &&
    reduceOnlyOk &&
    !cannotSafelyFallback;

  const changeSizeMode = (next: SizeMode) => {
    if (next === sizeMode || (next === 'risk' && (closing || reduceOnly))) return;
    const nextAmount =
      next === 'usd'
        ? notional > 0
          ? String(Number(notional.toFixed(2)))
          : ''
        : next === 'coin'
          ? coinSize > 0
            ? String(coinSize)
            : ''
          : maxLoss && maxLoss > 0
            ? String(Number(maxLoss.toFixed(2)))
            : '';
    setSizeMode(next);
    setRiskUnit('usd');
    setAmount(nextAmount);
  };

  const toggleReduceOnly = () => {
    const next = !reduceOnly;
    setReduceOnly(next);
    if (next) {
      if (sizeMode === 'risk') changeSizeMode(defaultTradeSizeMode());
      setTpPrice('');
      setSlPrice('');
    }
  };

  const changeRiskUnit = (next: RiskUnit) => {
    if (next === riskUnit || (next === 'percent' && percentageRiskUnavailable)) return;
    const nextAmount =
      next === 'percent'
        ? riskBase > 0
          ? (riskBudget / riskBase) * 100
          : 0
        : riskBudget;
    setRiskUnit(next);
    setAmount(nextAmount > 0 ? String(Number(nextAmount.toFixed(next === 'percent' ? 3 : 2))) : '');
  };

  const dismissKeyboard = () => Keyboard.dismiss();

  // Step the focused field: limit price by one tick, size by 1 coin / $10.
  const nudge = (dir: 1 | -1) => {
    const tick = 1 / 10 ** priceDecimals;
    if (focused === 'slippage') {
      const next = Math.min(5, Math.max(0.01, slippagePctNum + dir * 0.1));
      setSlippagePct(String(Number(next.toFixed(2))));
      return;
    }
    if (focused === 'limit' || focused === 'tp' || focused === 'sl') {
      const [cur, set] =
        focused === 'limit'
          ? ([limitPrice, setLimitPrice] as const)
          : focused === 'tp'
            ? ([tpPrice, setTpPrice] as const)
            : ([slPrice, setSlPrice] as const);
      const next = Math.max(0, (num(cur) || refPx) + dir * tick);
      set(String(Number(next.toFixed(priceDecimals))));
      return;
    }
    const step = sizeMode === 'coin' ? 1 : sizeMode === 'risk' && riskUnit === 'percent' ? 0.1 : 10;
    const dec = sizeMode === 'coin' ? (assetMeta?.szDecimals ?? 4) : sizeMode === 'risk' && riskUnit === 'percent' ? 2 : 2;
    const next = Math.max(0, num(amount) + dir * step);
    setAmount(next > 0 ? String(Number(next.toFixed(dec))) : '');
  };

  const invalidateTradingState = () => {
    qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
    qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
    qc.invalidateQueries({ queryKey: queryKeys.hlFillsPrefix() });
    qc.invalidateQueries({ queryKey: ['hl', 'activeAsset'] });
  };

  const mutation = useMutation<TradeSubmission, unknown, TradeDraft>({
    mutationFn: async (draft): Promise<TradeSubmission> => {
      let leveragePostAttempted = false;
      let leveragePostSucceeded = false;
      let orderPostAttempted = false;

      const makeSubmission = (
        results: OrderResult[],
        legTypes: TriggerLeg['tpsl'][],
      ): TradeSubmission => ({
        results,
        legTypes,
        coin: draft.coin,
        network: draft.network,
        connectionAddress: draft.connectionAddress,
        requestedSize: draft.size,
        szDecimals: draft.szDecimals,
        action: draft.action,
        fullClose: draft.fullClose,
        reduceOnly: draft.reduceOnly,
      });

      const assertContextStillMatches = () => {
        const connection = useHlConnection.getState();
        const liveContext = liveContextRef.current;
        if (
          !liveContext.mounted ||
          !liveContext.visible ||
          liveContext.coin !== draft.coin ||
          connection.network !== draft.network ||
          connection.address !== draft.connectionAddress
        ) {
          throw new TradePreflightError(
            'The selected account, network, or market changed after review.',
          );
        }
        assertTradingIdentityCurrent(draft.identity, connection);
      };

      const validateDraftState = async (expectPostUpdateSettings: boolean) => {
        assertContextStillMatches();

        // Read the book first: the reviewed IOC cap is immutable, so later price
        // movement can only reduce fillability, never worsen the reviewed bound.
        const latestBookQuery =
          draft.orderType === 'market' ? await refetchOrderBook() : null;

        // Position and trigger-mark state can independently change while a slow
        // request is in flight. Always use the completed fresh reads below;
        // elapsed network time alone does not make an unchanged price unsafe.
        const [latestAccountQuery, latestActiveQuery] = await Promise.all([
          refetchAccount(),
          draft.reduceOnly ? Promise.resolve(null) : refetchActive(),
        ]);

        // Every order, including Add/Reduce, is bound to the exact position snapshot
        // shown in review. Compare exchange-lot-quantized sizes to avoid float noise.
        if (latestAccountQuery.isError || !latestAccountQuery.data) {
          throw new TradePreflightError('Could not refresh the live account state.');
        }
        const latestPosition = latestAccountQuery.data.positions.find(
          (position) => position.coin === draft.coin,
        );
        const expectedPosition = draft.expectedPosition;
        const positionPresenceChanged = !!latestPosition !== !!expectedPosition;
        const positionDetailsChanged =
          !!latestPosition &&
          !!expectedPosition &&
          (latestPosition.side !== expectedPosition.side ||
            lotQuantized(latestPosition.size, draft.szDecimals) !==
              lotQuantized(expectedPosition.size, draft.szDecimals));
        if (positionPresenceChanged || positionDetailsChanged) {
          throw new TradePreflightError('The live position side or size changed after review.');
        }

        if (draft.reduceOnly) {
          const reducesLatest =
            !!latestPosition &&
            ((latestPosition.side === 'long' && draft.side === 'sell') ||
              (latestPosition.side === 'short' && draft.side === 'buy'));
          const latestSize = lotQuantized(latestPosition?.size ?? 0, draft.szDecimals);
          const orderSize = lotQuantized(draft.size, draft.szDecimals);
          if (!reducesLatest || orderSize > latestSize) {
            throw new TradePreflightError('This reduce-only order no longer matches the live position.');
          }
          // A Close action must still flatten the exact live lot-quantized size.
          if (draft.fullClose && orderSize !== latestSize) {
            throw new TradePreflightError('The full-close size changed after review.');
          }
        }

        let freshActive: Awaited<ReturnType<typeof refetchActive>>['data'];
        if (!draft.reduceOnly) {
          freshActive =
            !latestActiveQuery || latestActiveQuery.isError
              ? undefined
              : latestActiveQuery.data;
          if (expectPostUpdateSettings) {
            if (!freshActive) {
              throw new TradePreflightError(
                'Could not confirm the requested leverage and margin mode.',
              );
            }
            if (
              freshActive.leverage !== draft.leverage ||
              freshActive.isCross !== draft.isCross
            ) {
              throw new TradePreflightError(
                'The requested leverage or margin mode is not active yet.',
              );
            }
          } else if (draft.expectedActive) {
            if (!freshActive) {
              throw new TradePreflightError('Could not refresh leverage and margin settings.');
            }
            if (
              freshActive.leverage !== draft.expectedActive.leverage ||
              freshActive.isCross !== draft.expectedActive.isCross
            ) {
              throw new TradePreflightError('Leverage or margin mode changed after review.');
            }
          } else if (
            freshActive &&
            (freshActive.leverage !== draft.leverage || freshActive.isCross !== draft.isCross)
          ) {
            throw new TradePreflightError(
              'Live leverage settings became available and differ from the reviewed safe fallback.',
            );
          }

          if (draft.triggers.length > 0) {
            const freshTriggerMarkPx = freshActive?.markPx;
            if (!freshTriggerMarkPx || freshTriggerMarkPx <= 0) {
              throw new TradePreflightError('Could not refresh the TP/SL trigger mark.');
            }
            const reviewedTriggersValid = draft.triggers.every((leg) =>
              triggerLegIsValid(
                leg,
                draft.side,
                draft.riskEntryPx,
                draft.triggerMarkPx,
                draft.slippage,
              ),
            );
            const freshTriggersValid = draft.triggers.every((leg) =>
              triggerLegIsValid(
                leg,
                draft.side,
                draft.riskEntryPx,
                freshTriggerMarkPx,
                draft.slippage,
              ),
            );
            if (!reviewedTriggersValid || freshTriggersValid !== reviewedTriggersValid) {
              throw new TradePreflightError('A TP/SL trigger is no longer valid at the fresh mark.');
            }
          }
        }

        if (draft.orderType === 'market') {
          const latestBook =
            !latestBookQuery || latestBookQuery.isError ? undefined : latestBookQuery.data;
          const latestBid = latestBook?.bids[0]?.price;
          const latestAsk = latestBook?.asks[0]?.price;
          if (!(latestBid && latestBid > 0 && latestAsk && latestAsk > 0)) {
            throw new TradePreflightError('Could not refresh both sides of the order book.');
          }
          const freshMid = (latestBid + latestAsk) / 2;
          if (materiallyDifferentMid(draft.executionMidPx, freshMid, draft.slippage)) {
            throw new TradePreflightError('The execution midpoint moved materially after review.');
          }
          const reviewedHardCap = adverseEntryBound(
            draft.executionMidPx,
            draft.side === 'buy',
            draft.slippage,
          );
          if (Math.abs(reviewedHardCap - draft.hardIocPx) > Math.max(1e-10, reviewedHardCap * 1e-12)) {
            throw new TradePreflightError('The reviewed IOC cap is internally inconsistent.');
          }
        }

        // Network/market/account may change while the three fresh reads are in flight.
        assertContextStillMatches();
      };

      try {
        // Fail early for a clear no-POST error, then repeat the same checks from
        // the exchange's post-identity, immediately-before-signing callback.
        await validateDraftState(false);

        if (draft.needsLeverageUpdate) {
          await updateLeverage({
            network: draft.network,
            identity: draft.identity,
            validateImmediatelyBeforeSigning: () => validateDraftState(false),
            assertIdentityCurrent: assertContextStillMatches,
            assetIndex: draft.assetIndex,
            isCross: draft.isCross,
            leverage: draft.leverage,
            onPostAttempt: () => {
              leveragePostAttempted = true;
            },
          });
          leveragePostSucceeded = true;
          // The settings POST yielded control; do not continue into an order if the
          // user changed account/network/market while it was in flight.
          assertContextStillMatches();
        }

        const legs: TriggerLeg[] = draft.triggers.map((leg) => ({ ...leg }));
        if (legs.length > 0) {
          const results = await placeBracket({
            network: draft.network,
            identity: draft.identity,
            validateImmediatelyBeforeSigning: () =>
              validateDraftState(draft.needsLeverageUpdate),
            assertIdentityCurrent: assertContextStillMatches,
            assetIndex: draft.assetIndex,
            szDecimals: draft.szDecimals,
            isBuy: draft.side === 'buy',
            size: draft.size,
            limitPrice: draft.orderType === 'limit' ? draft.limitPrice : undefined,
            postOnly: draft.orderType === 'limit' && draft.postOnly,
            markPx: draft.executionMidPx,
            slippage: draft.slippage,
            legs,
            onPostAttempt: () => {
              orderPostAttempted = true;
            },
          });
          if (!results[0]) throw new Error('Hyperliquid returned no parent order status');
          return makeSubmission(results, legs.map((leg) => leg.tpsl));
        }

        const result = await placeOrder({
          network: draft.network,
          identity: draft.identity,
          validateImmediatelyBeforeSigning: () =>
            validateDraftState(draft.needsLeverageUpdate),
          assertIdentityCurrent: assertContextStillMatches,
          assetIndex: draft.assetIndex,
          szDecimals: draft.szDecimals,
          isBuy: draft.side === 'buy',
          size: draft.size,
          reduceOnly: draft.reduceOnly,
          limitPrice: draft.orderType === 'limit' ? draft.limitPrice : undefined,
          postOnly: draft.orderType === 'limit' && draft.postOnly,
          markPx: draft.executionMidPx,
          slippage: draft.slippage,
          onPostAttempt: () => {
            orderPostAttempted = true;
          },
        });
        return makeSubmission([result], []);
      } catch (error) {
        if (leveragePostAttempted || orderPostAttempted) {
          throw new TradeSubmissionUnknownError(
            errorMessage(error),
            leveragePostAttempted,
            leveragePostSucceeded,
            orderPostAttempted,
          );
        }
        if (error instanceof TradePreflightError) throw error;
        throw new TradePreflightError(errorMessage(error));
      }
    },
    onSuccess: async (submission) => {
      let remainingPosition: PositionDraft | null | undefined;
      const latestAccountQuery = await refetchAccount().catch(() => null);
      const connection = useHlConnection.getState();
      const liveContext = liveContextRef.current;
      const sameReviewedIdentity =
        liveContext.mounted &&
        liveContext.visible &&
        liveContext.coin === submission.coin &&
        connection.network === submission.network &&
        connection.address === submission.connectionAddress;
      if (
        sameReviewedIdentity &&
        latestAccountQuery &&
        !latestAccountQuery.isError &&
        latestAccountQuery.data
      ) {
        const remaining = latestAccountQuery.data.positions.find(
          (position) => position.coin === submission.coin,
        );
        remainingPosition = remaining
          ? Object.freeze({ side: remaining.side, size: remaining.size })
          : null;
      }
      if (sameReviewedIdentity) {
        setResult({ ...submission, remainingPosition });
      }
      invalidateTradingState();
    },
    onError: (error) => {
      if (error instanceof TradeSubmissionUnknownError) {
        invalidateTradingState();
        const leverageWarning = error.leveragePostAttempted
          ? error.leveragePostSucceeded
            ? '\n\nLeverage/margin mode was updated before the order result became unknown.'
            : '\n\nThe leverage/margin update may already have changed settings, even if no order was placed.'
          : '';
        const orderWarning = error.orderPostAttempted
          ? '\n\nThe order POST began, so its fill/resting status is unknown.'
          : '\n\nNo order POST began, but an earlier account-setting POST may have changed state.';
        Alert.alert(
          'Submission status unknown',
          `${error.message}${leverageWarning}${orderWarning}\n\nDo not retry until Account and Open Orders refresh and you verify the actual state.`,
        );
        return;
      }
      Alert.alert(
        'Review required',
        `${errorMessage(error)}\n\nNo order was sent. Review the refreshed ticket and confirm again.`,
      );
    },
  });

  const reset = () => {
    setSizeMode(defaultTradeSizeMode());
    setRiskUnit('usd');
    setAmount(initialSizeCoin != null ? String(initialSizeCoin) : '');
    setLimitPrice('');
    setTpPrice('');
    setSlPrice('');
    setSlippagePct(DEFAULT_SLIPPAGE_PCT);
    setPostOnly(false);
    setAdvancedOpen(false);
    setReduceOnly(!!closing);
    setLevOverride(null);
    setCrossOverride(null);
    setResult(null);
    mutation.reset();
  };

  const close = () => {
    if (mutation.isPending) return;
    reset();
    onClose();
  };

  const submitVerb = actionLabel ?? (closing ? 'Close' : side === 'buy' ? 'Buy' : 'Sell');

  const confirm = () => {
    if (!canSubmit || !assetMeta || !account || !authenticatedIdentity) return;
    const draftTriggers: readonly Readonly<TriggerLeg>[] = Object.freeze(
      !closing && !reduceOnly
        ? [
            ...(tpNum > 0 ? [{ tpsl: 'tp' as const, triggerPx: tpNum }] : []),
            ...(slNum > 0 ? [{ tpsl: 'sl' as const, triggerPx: slNum }] : []),
          ].map((leg) => Object.freeze(leg))
        : [],
    );
    const expectedPosition: PositionDraft | null = currentPosition
      ? Object.freeze({ side: currentPosition.side, size: currentPosition.size })
      : null;
    const expectedActive: ActiveSettingsDraft | null = active
      ? Object.freeze({ leverage: active.leverage, isCross: active.isCross })
      : null;
    const draft: TradeDraft = Object.freeze({
      network,
      connectionAddress,
      identity: Object.freeze({
        network: authenticatedIdentity.network,
        connectionAddress: authenticatedIdentity.connectionAddress,
        accountAddress: authenticatedIdentity.accountAddress,
        signerAddress: authenticatedIdentity.signerAddress,
        keyFingerprint: authenticatedIdentity.keyFingerprint,
      }),
      coin,
      assetIndex: assetMeta.assetIndex,
      szDecimals: assetMeta.szDecimals,
      side,
      action: submitVerb,
      size: coinSize,
      reduceOnly,
      closing: !!closing,
      fullClose: !!closing && (actionLabel == null || actionLabel === 'Close'),
      orderType,
      limitPrice: orderType === 'limit' ? limitNum : undefined,
      postOnly: orderType === 'limit' && postOnly,
      slippage: marketSlippage,
      executionMidPx: resolvedExecutionMidPx,
      hardIocPx: marketEntryBoundPx,
      triggerMarkPx,
      riskEntryPx: refPx,
      leverage,
      isCross,
      needsLeverageUpdate:
        !closing &&
        !reduceOnly &&
        (!active ||
          (userSetLev && (leverage !== active.leverage || isCross !== active.isCross))),
      expectedActive,
      expectedPosition,
      triggers: draftTriggers,
    });
    const verb = submitVerb;
    const sizeStr = `${compactNumber(draft.size, draft.szDecimals)} ${label}`;
    const priceStr =
      orderType === 'market'
        ? execution?.sufficientDepth
          ? `likely $${formatPrice(likelyEntryPx, priceDecimals)} (book VWAP)`
          : `up to $${formatPrice(marketEntryBoundPx, priceDecimals)} (IOC cap)`
        : `$${formatPrice(num(limitPrice), priceDecimals)} (limit)`;
    const levLine = !closing ? `\nLeverage ${leverage}× ${isCross ? 'Cross' : 'Isolated'}` : '';
    const riskLine =
      closing || reduceOnly
        ? ''
        : maxLoss
          ? `\nEst. loss at hard entry/stop caps + fees* ${usd(maxLoss)}`
          : '\nNo stop — loss is not capped';
    const rrLine = rewardRisk ? ` · R:R 1:${rewardRisk.toFixed(2)}` : '';
    const executionLine =
      orderType === 'market'
        ? `\nIOC cap $${formatPrice(marketEntryBoundPx, priceDecimals)} · ${slippagePctNum.toFixed(2)}%`
        : postOnly
          ? '\nPost-only limit'
          : '';
    const tpSlLine =
      !closing && (tpNum > 0 || slNum > 0)
        ? '\n' +
          [
            tpNum > 0 ? `TP $${formatPrice(tpNum, priceDecimals)}` : '',
            slNum > 0 ? `SL $${formatPrice(slNum, priceDecimals)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : '';
    Alert.alert(
      `${verb} ${label}?`,
      `${verb} ${sizeStr} ≈ ${usd(notional)}\nat ${priceStr}` +
        levLine +
        tpSlLine +
        riskLine +
        rrLine +
        executionLine +
        (positionImplication ? `\nPosition if filled: ${positionImplication}` : '') +
        (reduceOnly ? '\nReduce-only' : '') +
        (network === 'mainnet' ? '\n\nThis uses real funds on mainnet.' : '\n\nTestnet order.') +
        (maxLoss
          ? `\n*Uses ${lossEstimateBasis.toLowerCase()} at ${(feeRate * 100).toFixed(2)}% per fill; partial/unfilled stops can lose more.`
          : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb,
          style: side === 'buy' ? 'default' : 'destructive',
          onPress: () => mutation.mutate(draft),
        },
      ],
    );
  };

  const presets = levPresets(maxLev);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} disabled={mutation.isPending} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}>
        <SheetSurface style={styles.sheet}>
          {/* Header */}
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <AppText variant="heading">
              {title ?? (closing ? `${actionLabel ?? 'Close'} ${label}` : `${label}-PERP`)}
            </AppText>
            <View style={styles.headerRight}>
              <AppText variant="caption" muted numeric>
                Mark ${formatPrice(triggerMarkPx, priceDecimals)}
              </AppText>
              {!closing && assetMeta ? (
                <View style={styles.levBadge}>
                  <AppText variant="caption" color={Colors.text}>
                    {isCross ? 'Cross' : 'Isolated'} · {leverage}×
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>

          {result ? (
            <ResultView
              coin={label}
              submission={result}
              priceDecimals={priceDecimals}
              onDone={close}
              onAgain={reset}
            />
          ) : (
            <View style={styles.ticketContent}>
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}>
              {/* Buy / Sell — hidden in close mode (the side is fixed to flatten). */}
              {closing || lockSide ? (
                <View style={styles.closeBanner}>
                  <Ionicons
                    name={closing ? 'arrow-undo-outline' : 'lock-closed-outline'}
                    size={14}
                    color={Colors.textMuted}
                  />
                  <AppText variant="caption" muted>
                    {closing
                      ? `Reduce-only ${side === 'buy' ? 'buy' : 'sell'} to close your position`
                      : `${side === 'buy' ? 'Buy / Long' : 'Sell / Short'} side locked for this action`}
                  </AppText>
                </View>
              ) : (
                <View style={styles.sideRow}>
                  {(['buy', 'sell'] as Side[]).map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => setSide(s)}
                      style={[
                        styles.sideBtn,
                        side === s && {
                          backgroundColor: (s === 'buy' ? Colors.up : Colors.down) + '22',
                          borderColor: s === 'buy' ? Colors.up : Colors.down,
                        },
                      ]}>
                      <AppText
                        variant="label"
                        color={side === s ? (s === 'buy' ? Colors.up : Colors.down) : Colors.textMuted}>
                        {s === 'buy' ? 'Buy / Long' : 'Sell / Short'}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Market / Limit */}
              <View style={styles.segment}>
                {(['market', 'limit'] as OrderType[]).map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.segmentItem, orderType === t && styles.segmentItemActive]}
                    onPress={() => {
                      setOrderType(t);
                      if (t === 'market') setPostOnly(false);
                    }}>
                    <AppText variant="label" color={orderType === t ? Colors.text : Colors.textMuted}>
                      {t === 'market' ? 'Market' : 'Limit'}
                    </AppText>
                  </Pressable>
                ))}
              </View>

              <>
                  {/* Reduce-only stays visible because it materially changes what the order can do. */}
                  {!closing ? <View style={styles.safetyRow}>
                    <View style={styles.safetyCopy}>
                      <AppText variant="label">Reduce-only</AppText>
                      <AppText variant="caption" muted>
                        Can shrink a position, never open or flip it
                      </AppText>
                    </View>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: reduceOnly }}
                      onPress={toggleReduceOnly}
                      style={[styles.switchTrack, reduceOnly && styles.switchTrackOn]}>
                      <View style={[styles.switchThumb, reduceOnly && styles.switchThumbOn]} />
                    </Pressable>
                  </View> : null}

                  {/* Lower-frequency execution controls are intentionally progressive. */}
                  <View style={styles.advancedCard}>
                    <Pressable style={styles.advancedHead} onPress={() => setAdvancedOpen((v) => !v)}>
                      <View>
                        <AppText variant="label">Advanced</AppText>
                        <AppText variant="caption" muted>
                          {orderType === 'limit' && postOnly ? 'Post-only · ' : ''}
                          {!closing ? `${isCross ? 'Cross' : 'Isolated'} · ${leverage}× · ` : ''}
                          {slippagePctNum || 0}% cap
                        </AppText>
                      </View>
                      <Ionicons
                        name={advancedOpen ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={Colors.textMuted}
                      />
                    </Pressable>

                    {advancedOpen ? (
                      <View style={styles.advancedBody}>
                        {!closing && !reduceOnly ? (
                          <>
                            {!active ? (
                              <View style={styles.safeFallback}>
                                <Ionicons name="shield-checkmark-outline" size={16} color={Colors.warning} />
                                <AppText variant="caption" color={Colors.warning} style={styles.safetyCopy}>
                                  {activeLoading && !activeError
                                    ? cannotSafelyFallback
                                      ? 'Live position settings are loading. Adding is blocked until they resolve.'
                                      : 'Live settings are loading. Because this market is flat, submitting will set 1× isolated.'
                                    : cannotSafelyFallback
                                      ? 'Live settings are unavailable for a possible open position. Adding is blocked.'
                                      : 'Live settings are unavailable. Because this market is flat, the app will set 1× isolated.'}
                                </AppText>
                              </View>
                            ) : null}

                            <View style={styles.levRow}>
                              <AppText variant="caption" muted>
                                Margin mode
                              </AppText>
                              <View style={styles.marginToggle}>
                                {([
                                  ['cross', 'Cross'],
                                  ['isolated', 'Isolated'],
                                ] as const).map(([k, lbl]) => {
                                  const on = (k === 'cross') === isCross;
                                  return (
                                    <Pressable
                                      key={k}
                                      onPress={() => setCrossOverride(k === 'cross')}
                                      style={[styles.marginBtn, on && styles.marginBtnOn]}>
                                      <AppText
                                        variant="caption"
                                        color={on ? Colors.text : Colors.textMuted}>
                                        {lbl}
                                      </AppText>
                                    </Pressable>
                                  );
                                })}
                              </View>
                            </View>
                            <View style={styles.levDivider} />
                            <View style={styles.levRow}>
                              <AppText variant="caption" muted>
                                Leverage
                              </AppText>
                              <AppText variant="label" numeric color={Colors.text}>
                                {leverage}×
                              </AppText>
                            </View>
                            <View style={styles.chipRow}>
                              {presets.map((L) => {
                                const on = leverage === L;
                                return (
                                  <Pressable
                                    key={L}
                                    onPress={() => setLevOverride(L)}
                                    style={[styles.chip, on && styles.chipOn]}>
                                    <AppText variant="caption" color={on ? Colors.text : Colors.textMuted}>
                                      {L}×
                                    </AppText>
                                  </Pressable>
                                );
                              })}
                            </View>
                            <View style={styles.levDivider} />
                          </>
                        ) : null}

                        <View style={styles.levRow}>
                          <View>
                            <AppText variant="caption" muted>
                              Market slippage cap
                            </AppText>
                            <AppText variant="caption" muted>
                              0.01%–5%
                            </AppText>
                          </View>
                          <View style={styles.slippageInputWrap}>
                            <TextInput
                              value={slippagePct}
                              onChangeText={setSlippagePct}
                              onFocus={() => setFocused('slippage')}
                              keyboardType="decimal-pad"
                              keyboardAppearance="dark"
                              inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                              style={styles.slippageInput}
                            />
                            <AppText variant="caption" muted>
                              %
                            </AppText>
                          </View>
                        </View>
                        <View style={styles.chipRow}>
                          {[0.25, 0.5, 1, 2].map((pct) => (
                            <Pressable
                              key={pct}
                              onPress={() => setSlippagePct(String(pct))}
                              style={[styles.chip, slippagePctNum === pct && styles.chipOn]}>
                              <AppText
                                variant="caption"
                                color={slippagePctNum === pct ? Colors.text : Colors.textMuted}>
                                {pct}%
                              </AppText>
                            </Pressable>
                          ))}
                        </View>

                        {orderType === 'limit' ? (
                          <>
                            <View style={styles.levDivider} />
                            <View style={styles.levRow}>
                              <View style={styles.safetyCopy}>
                                <AppText variant="caption" muted>
                                  Post-only
                                </AppText>
                                <AppText variant="caption" muted>
                                  Cancel instead of taking liquidity
                                </AppText>
                              </View>
                              <Pressable
                                accessibilityRole="switch"
                                accessibilityState={{ checked: postOnly }}
                                onPress={() => setPostOnly((v) => !v)}
                                style={[styles.switchTrack, postOnly && styles.switchTrackOn]}>
                                <View style={[styles.switchThumb, postOnly && styles.switchThumbOn]} />
                              </Pressable>
                            </View>
                          </>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
              </>

              {/* Limit price */}
              {orderType === 'limit' ? (
                <Field label="Limit price">
                  <TextInput
                    value={limitPrice}
                    onChangeText={setLimitPrice}
                    onFocus={() => setFocused('limit')}
                    placeholder={formatPrice(triggerMarkPx, priceDecimals)}
                    placeholderTextColor={Colors.textFaint}
                    keyboardType="decimal-pad"
                    keyboardAppearance="dark"
                    inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                    style={styles.input}
                  />
                  <AppText variant="caption" muted>
                    USD
                  </AppText>
                </Field>
              ) : null}

              {/* Asset-unit sizing is the default. USD stays available as an explicit
                  conversion, while risk sizing derives the position from stop distance. */}
              <View style={styles.segment}>
                {(closing || reduceOnly
                  ? (['coin', 'usd'] as SizeMode[])
                  : (['coin', 'usd', 'risk'] as SizeMode[])
                ).map((mode) => (
                  <Pressable
                    key={mode}
                    style={[styles.segmentItem, sizeMode === mode && styles.segmentItemActive]}
                    onPress={() => changeSizeMode(mode)}>
                    <AppText variant="label" color={sizeMode === mode ? Colors.text : Colors.textMuted}>
                      {mode === 'usd' ? 'USD size' : mode === 'risk' ? 'Risk' : label}
                    </AppText>
                  </Pressable>
                ))}
              </View>

              <Field
                label={sizeMode === 'risk' ? 'Account risk' : 'Order size'}
                right={
                  sizeMode === 'risk' ? (
                    <View style={styles.marginToggle}>
                      {([
                        ['usd', '$'],
                        ['percent', '%'],
                      ] as const).map(([unit, unitLabel]) => (
                        <Pressable
                          key={unit}
                          onPress={() => changeRiskUnit(unit)}
                          disabled={unit === 'percent' && percentageRiskUnavailable}
                          style={[
                            styles.riskUnitBtn,
                            riskUnit === unit && styles.marginBtnOn,
                            unit === 'percent' && percentageRiskUnavailable && styles.pctChipDisabled,
                          ]}>
                          <AppText
                            variant="caption"
                            color={riskUnit === unit ? Colors.text : Colors.textMuted}>
                            {unitLabel}
                          </AppText>
                        </Pressable>
                      ))}
                    </View>
                  ) : null
                }>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  onFocus={() => setFocused('size')}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textFaint}
                  keyboardType="decimal-pad"
                  keyboardAppearance="dark"
                  inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                  style={styles.input}
                />
                <AppText variant="caption" muted>
                  {sizeMode === 'usd' ? 'USD' : sizeMode === 'coin' ? label : riskUnit === 'usd' ? 'USD' : '%'}
                </AppText>
              </Field>

              {sizeMode === 'risk' && percentageRiskUnavailable ? (
                <AppText variant="caption" color={Colors.warning} style={styles.convertLine}>
                  Percentage sizing is unavailable for Portfolio Margin. Use $ risk instead.
                </AppText>
              ) : null}

              <AppText variant="caption" muted style={styles.convertLine}>
                {sizeMode === 'usd'
                  ? `≈ ${compactNumber(coinSize, assetMeta?.szDecimals ?? 4)} ${label}`
                  : sizeMode === 'coin'
                    ? `≈ ${usd(notional)}`
                    : stopDistance > 0
                      ? `${usd(riskBudget)} risk → ${compactNumber(coinSize, assetMeta?.szDecimals ?? 4)} ${label} (${usd(notional)})`
                      : 'Enter a valid stop price below to derive the position size'}
              </AppText>

              {sizeMode === 'risk' ? (
                <View style={styles.pctRow}>
                  {[0.25, 0.5, 1].map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => {
                        setRiskUnit('percent');
                        setAmount(String(p));
                      }}
                      disabled={riskBase <= 0}
                      style={[styles.pctChip, riskBase <= 0 && styles.pctChipDisabled]}>
                      <AppText variant="caption" color={Colors.text}>
                        {p}% equity
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* Take profit / stop loss (optional bracket) — attaches to a new entry. */}
              {!closing && !reduceOnly ? (
                <View style={styles.tpslCard}>
                  <View style={styles.tpslHead}>
                    <AppText variant="caption" muted>
                      Take profit / Stop loss
                    </AppText>
                    <AppText variant="caption" color={sizeMode === 'risk' ? Colors.warning : Colors.textMuted}>
                      {sizeMode === 'risk' ? 'stop required' : 'optional'} · market
                    </AppText>
                  </View>

                  <View style={styles.tpslRow}>
                    <View style={[styles.tpslDot, { backgroundColor: Colors.up }]} />
                    <TextInput
                      value={tpPrice}
                      onChangeText={setTpPrice}
                      onFocus={() => setFocused('tp')}
                      placeholder={`TP ${isBuy ? '≥' : '≤'} ${formatPrice(refPx, priceDecimals)}`}
                      placeholderTextColor={Colors.textFaint}
                      keyboardType="decimal-pad"
                      keyboardAppearance="dark"
                      inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                      style={styles.tpslInput}
                    />
                    {tpNum > 0 ? (
                      <AppText variant="caption" numeric color={tpOk ? Colors.up : Colors.warning}>
                        {tpOk ? signedUsd(tpPnl) : 'wrong side'}
                      </AppText>
                    ) : null}
                  </View>

                  <View style={styles.tpslRow}>
                    <View style={[styles.tpslDot, { backgroundColor: Colors.down }]} />
                    <TextInput
                      value={slPrice}
                      onChangeText={setSlPrice}
                      onFocus={() => setFocused('sl')}
                      placeholder={`SL ${isBuy ? '≤' : '≥'} ${formatPrice(refPx, priceDecimals)}`}
                      placeholderTextColor={Colors.textFaint}
                      keyboardType="decimal-pad"
                      keyboardAppearance="dark"
                      inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                      style={styles.tpslInput}
                    />
                    {slNum > 0 ? (
                      <AppText variant="caption" numeric color={slOk ? Colors.down : Colors.warning}>
                        {slOk ? signedUsd(slPnl) : 'wrong side'}
                      </AppText>
                    ) : null}
                  </View>

                  {maxLoss || rewardRisk ? (
                    <View style={styles.riskSummaryRow}>
                      <AppText variant="caption" color={Colors.down} numeric>
                        Loss at hard caps* {maxLoss ? usd(maxLoss) : '—'}
                      </AppText>
                      <AppText variant="caption" color={rewardRisk ? Colors.up : Colors.textMuted} numeric>
                        R:R {rewardRisk ? `1:${rewardRisk.toFixed(2)}` : '—'}
                      </AppText>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Order summary */}
              <View style={styles.infoCard}>
                <InfoRow label="Order Value" value={notional > 0 ? usd(notional) : '—'} />
                {orderType === 'market' && orderBook?.bids[0] && orderBook.asks[0] ? (
                  <InfoRow
                    label="Bid / Ask"
                    value={`$${formatPrice(orderBook.bids[0].price, priceDecimals)} / $${formatPrice(
                      orderBook.asks[0].price,
                      priceDecimals,
                    )}`}
                  />
                ) : null}
                {orderType === 'market' ? (
                  <>
                    <InfoRow
                      label="Execution Mid"
                      value={`$${formatPrice(resolvedExecutionMidPx, priceDecimals)}`}
                    />
                    <InfoRow
                      label="Hard IOC Bound"
                      value={`$${formatPrice(marketEntryBoundPx, priceDecimals)}`}
                      valueColor={Colors.warning}
                    />
                  </>
                ) : null}
                {orderType === 'market' && execution ? (
                  <>
                    <InfoRow
                      label={execution.sufficientDepth ? 'Likely Book VWAP' : 'Visible Book Avg'}
                      value={`$${formatPrice(execution.averagePrice, priceDecimals)}`}
                    />
                    <InfoRow
                      label="Spread"
                      value={execution.spreadPct == null ? '—' : `${execution.spreadPct.toFixed(3)}%`}
                    />
                    <InfoRow
                      label="Price Impact"
                      value={`${execution.priceImpactPct.toFixed(3)}%`}
                      valueColor={execution.priceImpactPct > 0.5 ? Colors.warning : Colors.text}
                    />
                  </>
                ) : null}
                {maxLoss ? (
                  <>
                    {orderType === 'market' ? (
                      <InfoRow
                        label="Hard Entry IOC Allowance"
                        value={usd(entrySlippageAllowance)}
                      />
                    ) : null}
                    <InfoRow label="Price Loss (incl. entry slip)" value={usd(priceLossAtStop)} />
                    <InfoRow
                      label={`Fee Allowance (${(feeRate * 100).toFixed(2)}%/fill)`}
                      value={usd(feeAllowanceAtStop)}
                    />
                    <InfoRow label="Loss at Caps + Fees" value={usd(maxLoss)} valueColor={Colors.down} />
                    <AppText variant="caption" muted>
                      {lossEstimateBasis}
                    </AppText>
                  </>
                ) : null}
                {!closing && !reduceOnly ? (
                  <InfoRow label="Margin Required" value={marginRequired > 0 ? usd(marginRequired) : '—'} />
                ) : null}
                {!closing && !reduceOnly ? (
                  <InfoRow
                    label="Liq. Price"
                    value={liqPrice ? `$${formatPrice(liqPrice, priceDecimals)}` : 'N/A'}
                    valueColor={liqPrice ? Colors.down : Colors.textMuted}
                  />
                ) : null}
                <InfoRow
                  label="Slippage"
                  value={
                    orderType === 'market'
                      ? `Max ${slippagePctNum.toFixed(2)}%`
                      : postOnly
                        ? 'Post-only'
                        : 'Limit price'
                  }
                />
                <InfoRow label="Available" value={usd(avail)} />
                {positionImplication ? (
                  <View style={styles.implicationRow}>
                    <AppText variant="caption" muted>
                      Position if filled
                    </AppText>
                    <AppText variant="caption" numeric color={Colors.text} style={styles.implicationValue}>
                      {positionImplication}
                    </AppText>
                  </View>
                ) : null}
              </View>

              {visibleDepthShort && execution ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  Visible book depth covers only {compactNumber(execution.filledSize, assetMeta?.szDecimals ?? 4)} of{' '}
                  {compactNumber(execution.requestedSize, assetMeta?.szDecimals ?? 4)} {label}. Expect a partial fill or
                  more impact.
                </AppText>
              ) : null}
              {estimatedBeyondCap ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  The estimated average fill is beyond your slippage cap; the IOC may fill only part of the order.
                </AppText>
              ) : null}

              {/* Disabled-state hint */}
              {!tradable ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  {demo
                    ? 'Demo account is read-only. Connect your own account with an API key in Settings to trade.'
                    : 'Add an API wallet key in Settings to enable trading.'}
                </AppText>
              ) : null}
              {tradable && sizeMode === 'risk' && !riskOk ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  {percentageRiskUnavailable && riskUnit === 'percent'
                    ? 'Portfolio Margin does not expose a safe percentage-sizing base. Switch to $ risk.'
                    : 'Enter a risk amount and a stop on the loss side of the entry price.'}
                </AppText>
              ) : null}
              {tradable && !slippageOk ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  Set market slippage between 0.01% and 5% under Advanced.
                </AppText>
              ) : null}
              {tradable && !withinCapacity ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  This order exceeds the live maximum of {compactNumber(maxSz, assetMeta?.szDecimals ?? 4)} {label}.
                </AppText>
              ) : null}
              {tradable && !reduceOnlyOk ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  {closing
                    ? 'The live position side or size no longer matches this close. Reopen it from Account.'
                    : 'Reduce-only must oppose an existing position and cannot be larger than that position.'}
                </AppText>
              ) : null}
              {tradable && cannotSafelyFallback ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  Adding is disabled until the live position and leverage settings are available.
                </AppText>
              ) : null}

              </ScrollView>

              {/* Always-visible review dock: risk and the final action never disappear below the fold. */}
              <View style={styles.submitDock}>
                <View style={styles.submitSummary}>
                  <View>
                    <AppText variant="caption" muted>
                      {closing || reduceOnly ? 'Exposure' : 'Loss at hard caps*'}
                    </AppText>
                    <AppText
                      variant="label"
                      numeric
                      color={closing || reduceOnly ? Colors.accent : maxLoss ? Colors.down : Colors.warning}>
                      {closing || reduceOnly ? 'Reduce only' : maxLoss ? usd(maxLoss) : 'Not capped'}
                    </AppText>
                  </View>
                  <View style={styles.submitSummaryRight}>
                    <AppText variant="caption" muted>
                      {rewardRisk ? 'Reward : risk' : 'Order value'}
                    </AppText>
                    <AppText variant="label" numeric>
                      {rewardRisk ? `1 : ${rewardRisk.toFixed(2)}` : notional > 0 ? usd(notional) : '—'}
                    </AppText>
                  </View>
                </View>
                <Pressable
                  style={[styles.submit, { backgroundColor: canSubmit ? sideColor : GLASS_FILL_STRONG }]}
                  onPress={confirm}
                  disabled={!canSubmit || mutation.isPending}
                  accessibilityState={{
                    disabled: !canSubmit || mutation.isPending,
                    busy: mutation.isPending,
                  }}>
                  {mutation.isPending ? (
                    <View style={styles.submitBusy}>
                      <ActivityIndicator size="small" color={Colors.text} />
                      <AppText variant="label" color={Colors.text}>
                        Submitting order…
                      </AppText>
                    </View>
                  ) : (
                    <AppText variant="label" color={canSubmit ? '#04150E' : Colors.textFaint}>
                      Review {submitVerb} {label}
                    </AppText>
                  )}
                </Pressable>
                {maxLoss && !closing && !reduceOnly ? (
                  <AppText variant="caption" muted style={styles.stopDisclaimer}>
                    *Sizes from the adverse IOC bounds plus fee allowances; partial or unfilled stops can lose more.
                  </AppText>
                ) : null}
              </View>
            </View>
          )}
        </SheetSurface>

        {/* Above-keyboard bar: decimal-pads have no Done key, so this is the only
            way to dismiss. Steppers nudge the focused field. */}
        {Platform.OS === 'ios' && !result ? (
          <InputAccessoryView nativeID={ACCESSORY_ID} backgroundColor="#0B0E13">
            <View style={styles.accessory}>
              <View style={styles.steppers}>
                <Pressable onPress={() => nudge(-1)} hitSlop={8} style={styles.stepBtn}>
                  <Ionicons name="remove" size={20} color={Colors.text} />
                </Pressable>
                <View style={styles.stepDivider} />
                <Pressable onPress={() => nudge(1)} hitSlop={8} style={styles.stepBtn}>
                  <Ionicons name="add" size={20} color={Colors.text} />
                </Pressable>
              </View>
              <AppText variant="caption" muted>
                {focused === 'limit'
                  ? 'Limit price'
                  : focused === 'tp'
                    ? 'Take profit'
                  : focused === 'sl'
                    ? 'Stop loss'
                    : focused === 'slippage'
                      ? 'Slippage cap · %'
                      : sizeMode === 'risk'
                        ? `Account risk · ${riskUnit === 'usd' ? 'USD' : '%'}`
                        : `Size · ${sizeMode === 'usd' ? 'USD' : label}`}
              </AppText>
              <Pressable onPress={dismissKeyboard} hitSlop={8} style={styles.doneBtn}>
                <Ionicons name="checkmark" size={16} color={Colors.accent} />
                <AppText variant="label" color={Colors.accent}>
                  Done
                </AppText>
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="caption" numeric color={valueColor ?? Colors.text}>
        {value}
      </AppText>
    </View>
  );
}

function ResultView({
  coin,
  submission,
  priceDecimals,
  onDone,
  onAgain,
}: {
  coin: string;
  submission: TradeSubmission;
  priceDecimals: number;
  onDone: () => void;
  onAgain: () => void;
}) {
  const primary = submission.results[0] ?? { status: 'unknown' as const };
  const requestedSize = lotQuantized(submission.requestedSize, submission.szDecimals);
  const hasReportedFillSize =
    primary.status === 'filled' &&
    primary.totalSz != null &&
    Number.isFinite(primary.totalSz) &&
    primary.totalSz >= 0;
  const reportedFillSize = hasReportedFillSize
    ? lotQuantized(primary.totalSz ?? 0, submission.szDecimals)
    : null;
  const isPartialFill = reportedFillSize != null && reportedFillSize < requestedSize;
  const isExactFill = reportedFillSize != null && reportedFillSize === requestedSize;
  const remainingPosition = submission.remainingPosition;
  const remainingSize = remainingPosition
    ? lotQuantized(remainingPosition.size, submission.szDecimals)
    : 0;
  const presentation: Record<
    OrderResult['status'],
    { title: string; icon: 'checkmark-circle' | 'time-outline' | 'alert-circle-outline'; color: string }
  > = {
    filled: { title: 'Fill reported', icon: 'checkmark-circle', color: Colors.up },
    resting: { title: 'Order resting', icon: 'time-outline', color: Colors.warning },
    waitingForFill: { title: 'Waiting for fill', icon: 'time-outline', color: Colors.warning },
    waitingForTrigger: { title: 'Waiting for trigger', icon: 'time-outline', color: Colors.warning },
    success: { title: 'Request accepted', icon: 'checkmark-circle', color: Colors.accent },
    error: { title: 'Order rejected', icon: 'alert-circle-outline', color: Colors.down },
    unknown: { title: 'Check order status', icon: 'alert-circle-outline', color: Colors.warning },
  };
  let primaryUi = presentation[primary.status];
  if (primary.status === 'filled') {
    if (!hasReportedFillSize || (reportedFillSize != null && reportedFillSize > requestedSize)) {
      primaryUi = {
        title: 'Fill size needs verification',
        icon: 'alert-circle-outline',
        color: Colors.warning,
      };
    } else if (isPartialFill) {
      primaryUi = {
        title: submission.fullClose
          ? 'Position partially closed'
          : `${submission.action} partially filled`,
        icon: 'time-outline',
        color: Colors.warning,
      };
    } else if (submission.fullClose) {
      primaryUi =
        remainingPosition === null
          ? { title: 'Position closed', icon: 'checkmark-circle', color: Colors.up }
          : remainingPosition
            ? {
                title: 'Close fill reported · position remains open',
                icon: 'alert-circle-outline',
                color: Colors.warning,
              }
            : {
                title: 'Close fill reported · verify position',
                icon: 'alert-circle-outline',
                color: Colors.warning,
              };
    } else if (isExactFill) {
      primaryUi = {
        title: `${submission.action} fully filled`,
        icon: 'checkmark-circle',
        color: Colors.up,
      };
    }
  }
  const describe = (order: OrderResult, child = false) => {
    switch (order.status) {
      case 'filled':
        return child
          ? `${order.totalSz ?? '—'} ${coin} @ $${formatPrice(order.avgPx ?? 0, priceDecimals)}`
          : reportedFillSize == null
            ? `Exchange reported a fill @ $${formatPrice(order.avgPx ?? 0, priceDecimals)} but omitted the size`
            : `Filled ${compactNumber(reportedFillSize, submission.szDecimals)} of ${compactNumber(
                requestedSize,
                submission.szDecimals,
              )} ${coin} @ $${formatPrice(order.avgPx ?? 0, priceDecimals)}`;
      case 'resting':
        return `Resting on the book${order.oid ? ` · #${order.oid}` : ''}`;
      case 'waitingForFill':
        return child
          ? 'Accepted · waiting for the parent entry to fill'
          : 'Exchange reports that this order is waiting for fill';
      case 'waitingForTrigger':
        return 'Accepted · exchange reports waiting for trigger';
      case 'success':
        return 'Exchange returned success without an order id';
      case 'error':
        return order.error ?? 'Hyperliquid rejected this order leg';
      case 'unknown':
        return 'Unrecognized acknowledgement · refresh Open Orders';
    }
  };
  let livePositionCopy: string | null = null;
  let livePositionColor: string = Colors.textMuted;
  if (primary.status === 'filled' && submission.fullClose) {
    if (remainingPosition === undefined) {
      livePositionCopy = 'Remaining live position is unavailable. Verify Account and Open Orders now.';
      livePositionColor = Colors.warning;
    } else if (remainingPosition) {
      livePositionCopy = `Position remains open: ${remainingPosition.side === 'long' ? 'Long' : 'Short'} ${compactNumber(
        remainingSize,
        submission.szDecimals,
      )} ${coin}.`;
      livePositionColor = Colors.warning;
    } else if (isPartialFill) {
      livePositionCopy =
        'A partial close was reported, while the refreshed account currently shows flat. Verify fills before trading again.';
      livePositionColor = Colors.warning;
    } else {
      livePositionCopy = 'Refreshed account shows this position is flat.';
    }
  } else if (primary.status === 'filled' && isPartialFill) {
    if (remainingPosition === undefined) {
      livePositionCopy = 'The refreshed live position is unavailable. Verify Account before trading again.';
      livePositionColor = Colors.warning;
    } else if (remainingPosition) {
      livePositionCopy = `Refreshed position: ${remainingPosition.side === 'long' ? 'Long' : 'Short'} ${compactNumber(
        remainingSize,
        submission.szDecimals,
      )} ${coin}.`;
    } else {
      livePositionCopy = 'Refreshed account currently shows no open position.';
    }
  }
  return (
    <View style={styles.result}>
      <Ionicons name={primaryUi.icon} size={40} color={primaryUi.color} />
      <AppText variant="heading">{primaryUi.title}</AppText>
      <AppText variant="body" muted numeric>
        {describe(primary)}
      </AppText>
      {livePositionCopy ? (
        <AppText variant="caption" color={livePositionColor} numeric>
          {livePositionCopy}
        </AppText>
      ) : null}
      {submission.legTypes.length > 0 ? (
        <View style={styles.resultLegs}>
          {submission.legTypes.map((leg, index) => {
            const child = submission.results[index + 1] ?? ({ status: 'unknown' } as const);
            return (
              <View key={`${leg}-${index}`} style={styles.resultLegRow}>
                <View
                  style={[
                    styles.tpslDot,
                    { backgroundColor: leg === 'tp' ? Colors.up : Colors.down },
                  ]}
                />
                <View style={styles.resultLegCopy}>
                  <AppText variant="label">{leg === 'tp' ? 'Take profit' : 'Stop loss'}</AppText>
                  <AppText
                    variant="caption"
                    color={child.status === 'error' ? Colors.down : Colors.textMuted}>
                    {describe(child, true)}
                  </AppText>
                </View>
              </View>
            );
          })}
          <AppText
            variant="caption"
            color={
              submission.results.slice(1).some((child) => child.status === 'error')
                ? Colors.down
                : Colors.warning
            }>
            {submission.results.slice(1).some((child) => child.status === 'error')
              ? 'At least one protection leg was rejected. Treat the position as unprotected and review Open Orders now.'
              : 'These are exchange acknowledgements, not proof that protection is active. Verify TP/SL under Open Orders.'}
          </AppText>
        </View>
      ) : null}
      <View style={styles.resultBtns}>
        <Pressable style={[styles.resultBtn, styles.resultBtnGhost]} onPress={onAgain}>
          <AppText variant="label" color={Colors.text}>
            New order
          </AppText>
        </Pressable>
        <Pressable style={[styles.resultBtn, { backgroundColor: Colors.accent }]} onPress={onDone}>
          <AppText variant="label">Done</AppText>
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  right,
  children,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <AppText variant="caption" muted>
          {label}
        </AppText>
        {right}
      </View>
      <View style={styles.inputRow}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000C2' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    // Dark Liquid Glass; the faint black scrim deepens it to "black glass" and keeps text legible.
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_HAIRLINE,
    overflow: 'hidden',
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
    // A definite height lets the flexing ScrollView yield space to the fixed
    // review dock. `maxHeight` alone can leave the sheet intrinsically sized and
    // clip the dock when a longer sizing mode is selected.
    height: '92%',
  },
  // Used only when Liquid Glass isn't available (older iOS) — a near-black solid panel.
  sheetFallback: { backgroundColor: 'rgba(8,10,14,0.98)' },
  // Give the scrolling body a bounded flex area so the review dock remains pinned
  // even when a sizing mode (notably Risk) adds more fields than fit on screen.
  ticketContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    overflow: 'hidden',
    gap: Spacing.md,
  },
  body: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 },
  bodyContent: { gap: Spacing.md, paddingBottom: Spacing.xs },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: GLASS_FILL_STRONG,
    marginBottom: Spacing.xs,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  levBadge: { backgroundColor: GLASS_FILL_STRONG, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.sm },

  closeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: GLASS_FILL,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  sideRow: { flexDirection: 'row', gap: Spacing.sm },
  sideBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: GLASS_HAIRLINE,
    backgroundColor: GLASS_FILL,
  },

  segment: { flexDirection: 'row', backgroundColor: GLASS_INSET, borderRadius: Radius.sm, padding: 3, gap: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.sm },
  segmentItemActive: { backgroundColor: GLASS_FILL_STRONG },

  safetyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: GLASS_FILL,
    borderRadius: Radius.md,
  },
  safetyCopy: { flex: 1 },
  switchTrack: {
    width: 42,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: GLASS_INSET,
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: Colors.accent },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.textMuted },
  switchThumbOn: { alignSelf: 'flex-end', backgroundColor: '#FFFFFF' },

  advancedCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, overflow: 'hidden' },
  advancedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  advancedBody: {
    gap: Spacing.sm,
    padding: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS_HAIRLINE,
  },
  safeFallback: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.warning + '12',
  },

  levCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  levRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  levDivider: { height: StyleSheet.hairlineWidth, backgroundColor: GLASS_HAIRLINE },
  marginToggle: { flexDirection: 'row', backgroundColor: GLASS_INSET, borderRadius: Radius.sm, padding: 2, gap: 2 },
  marginBtn: { paddingHorizontal: Spacing.md, paddingVertical: 5, borderRadius: Radius.sm },
  marginBtnOn: { backgroundColor: GLASS_FILL_STRONG },
  riskUnitBtn: { minWidth: 34, alignItems: 'center', paddingHorizontal: Spacing.sm, paddingVertical: 5, borderRadius: Radius.sm },
  chipRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: GLASS_FILL,
    borderWidth: 1,
    borderColor: GLASS_HAIRLINE,
    minWidth: 46,
    alignItems: 'center',
  },
  chipOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  slippageInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: GLASS_INSET,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
  },
  slippageInput: {
    minWidth: 52,
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    paddingVertical: 6,
  },

  field: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  // App font (SF Pro) with tabular figures — matches the rest of the app; no monospace.
  input: { flex: 1, color: Colors.text, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'], paddingVertical: 2 },
  modeToggle: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  convertLine: { marginTop: -Spacing.xs, marginLeft: Spacing.xs },

  pctRow: { flexDirection: 'row', gap: Spacing.sm },
  pctChip: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.sm, backgroundColor: GLASS_FILL },
  pctChipDisabled: { opacity: 0.4 },

  infoCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  implicationRow: { gap: 3, paddingTop: Spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GLASS_HAIRLINE },
  implicationValue: { flexShrink: 1 },

  tpslCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  tpslHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tpslRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: GLASS_INSET,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? Spacing.sm : 4,
  },
  tpslDot: { width: 8, height: 8, borderRadius: 4 },
  riskSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tpslInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingVertical: 4,
  },

  hint: { marginTop: Spacing.xs },
  submitDock: {
    flexShrink: 0,
    gap: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS_HAIRLINE,
  },
  submitSummary: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  submitSummaryRight: { alignItems: 'flex-end' },
  stopDisclaimer: { textAlign: 'center' },
  submit: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, minHeight: 48 },
  submitBusy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },

  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: 'transparent',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS_HAIRLINE,
  },
  steppers: { flexDirection: 'row', alignItems: 'center', backgroundColor: GLASS_FILL, borderRadius: Radius.sm, overflow: 'hidden' },
  stepBtn: { paddingHorizontal: Spacing.lg, paddingVertical: 7 },
  stepDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: GLASS_HAIRLINE },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.sm,
    backgroundColor: Colors.accentSoft,
  },

  result: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  resultLegs: {
    alignSelf: 'stretch',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: GLASS_FILL,
  },
  resultLegRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  resultLegCopy: { flex: 1 },
  resultBtns: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, alignSelf: 'stretch' },
  resultBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md },
  resultBtnGhost: { backgroundColor: GLASS_FILL },
});
