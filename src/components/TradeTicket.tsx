import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';

import { OrderRecoveryNotice } from '@/components/OrderRecoveryNotice';
import { AppText } from '@/components/ui/AppText';
import { Colors } from '@/constants/theme';
import { useActiveAsset } from '@/data/useActiveAsset';
import { useHlAccount, useTradingIdentity } from '@/data/useHlAccount';
import { useHlMeta } from '@/data/useHlMeta';
import { useOrderBook } from '@/data/useOrderBook';
import { useOrderRecovery } from '@/data/useOrderRecovery';
import { estimateExecution } from '@/domain/execution';
import { formatPrice, signedUsd, usd } from '@/lib/format';
import {
  OrderRejectedError,
  placeBracket,
  placeOrder,
  updateLeverage,
  type TriggerLeg,
} from '@/lib/hyperliquid/exchange';
import {
  assertTradingIdentityCurrent,
  signedIdentityBinding
} from '@/lib/hyperliquid/tradingIdentity';
import { queryKeys } from '@/lib/queryKeys';
import { submitTradeDraft } from '@/lib/tradeExecution';
import { fetchActiveAssetData, fetchHlPositionSnapshot, fetchOrderBook } from '@/lib/hyperliquid/info';
import { priceToWire } from '@/lib/hyperliquid/sign';
import { tradeReceipt } from '@/lib/tradeReceipt';
import { useTradeFeedback } from '@/store/tradeFeedback';
import {
  defaultTradeSizeMode,
  shouldDismissTradeTicket,
  shouldStartTradeTicketDismiss
} from '@/lib/tradeTicket';
import { useHlConnection } from '@/store/hlConnection';
import { orderRecovery } from '@/store/orderRecovery';

import { ResultView } from '@/components/trading/TradeResult';
import { GLASS_FILL, GLASS_HAIRLINE, styles } from '@/components/trading/tradeTicketStyles';
import { ActiveSettingsDraft, CORE_FEE_ALLOWANCE, HIP3_FEE_ALLOWANCE, OrderType, PositionDraft, RiskUnit, Side, SizeMode, TradeDraft, TradePreflightError, TradeSubmission, TradeSubmissionUnknownError, adverseEntryBound, compactNumber, deriveRiskCoinSize, errorMessage, floorSize, levPresets, lossPerCoinAtBounds, num, triggerLegIsValid } from '@/lib/tradeTicketModel';

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
  /** Optional verb for the submit action (e.g. "Reduce"). */
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

// Consistent field surfaces across trading sheets.
/** Opaque sheet keeps prices and order controls readable. */
function SheetSurface({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={[style, styles.sheetFallback]}>{children}</View>;
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
  const recovery = useOrderRecovery(network, tradingIdentity?.accountAddress);
  const { data: meta } = useHlMeta();
  const { data: account } = useHlAccount(visible);
  const {
    data: active,
    isLoading: activeLoading,
    isError: activeError,
  } = useActiveAsset(visible ? coin : undefined);
  const { data: orderBook } = useOrderBook(
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
  const [tpslOpen, setTpslOpen] = useState(false);
  const [allocationTrackWidth, setAllocationTrackWidth] = useState(0);
  const [sheetTranslateY] = useState(() => new Animated.Value(0));
  const [sheetAtTop, setSheetAtTop] = useState(true);
  const [postOnly, setPostOnly] = useState(false);
  const [slippagePct, setSlippagePct] = useState(DEFAULT_SLIPPAGE_PCT);
  // Leverage / margin overrides — null means "follow the account's current setting".
  const [levOverride, setLevOverride] = useState<number | null>(null);
  const [crossOverride, setCrossOverride] = useState<boolean | null>(null);
  const [result, setResult] = useState<TradeSubmission | null>(null);
  const [submitError, setSubmitError] = useState<{ title: string; message: string } | null>(null);
  const submissionInFlight = useRef(false);
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
  // displayed values match the wire order and never exceed a risk/capacity limit.
  const coinSize = floorSize(rawCoinSize, assetMeta?.szDecimals ?? 4);
  const execution = estimateExecution(orderBook, isBuy, coinSize);
  const marketEntryBoundPx = adverseEntryBound(
    resolvedExecutionMidPx,
    isBuy,
    marketSlippage,
  );
  const submittedPrice = Number(priceToWire(
    orderType === 'limit' ? limitNum : marketEntryBoundPx,
    assetMeta?.szDecimals ?? 4,
  ));
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
  const maxLoss =
    slNum > 0 && slOk && coinSize > 0 ? stopLoss.totalPerCoin * coinSize : null;
  const slPnl = maxLoss ? -maxLoss : 0;
  const rewardRisk =
    tpNum > 0 && tpOk && maxLoss && maxLoss > 0 ? Math.max(0, tpPnl) / maxLoss : null;

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
    !recovery.blocked &&
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
    if (next === 'risk') setTpslOpen(true);
  };

  const toggleReduceOnly = () => {
    const next = !reduceOnly;
    setReduceOnly(next);
    if (next) {
      if (sizeMode === 'risk') changeSizeMode(defaultTradeSizeMode());
      setTpslOpen(false);
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
    retry: false,
    networkMode: 'always',
    mutationFn: (draft) => submitTradeDraft(draft, {
      assertCurrent: () => {
        orderRecovery.assertCanSubmit(draft.network, draft.identity.accountAddress);
        const connection = useHlConnection.getState();
        const live = liveContextRef.current;
        if (!live.mounted || !live.visible || live.coin !== draft.coin ||
            connection.network !== draft.network || connection.address !== draft.connectionAddress) {
          throw new TradePreflightError('The account or market changed. Reopen the order.');
        }
        assertTradingIdentityCurrent(draft.identity, connection);
      },
      readPosition: () => fetchHlPositionSnapshot(draft.identity.accountAddress, draft.coin, draft.network),
      readBook: () => fetchOrderBook(draft.coin, draft.network),
      readActive: () => fetchActiveAssetData(draft.identity.accountAddress, draft.coin, draft.network).catch(() => undefined),
      placeOrder, placeBracket, updateLeverage,
    }),
    onSuccess: (submission) => {
      invalidateTradingState();
      const connection = useHlConnection.getState();
      const live = liveContextRef.current;
      if (!live.mounted || !live.visible || live.coin !== submission.coin ||
          connection.network !== submission.network || connection.address !== submission.connectionAddress) return;
      const receipt = tradeReceipt(submission, label, priceDecimals);
      if (receipt.dismiss) {
        useTradeFeedback.getState().show(receipt);
        reset();
        onClose();
      } else {
        setResult(submission);
      }
    },
    onError: (error) => {
      invalidateTradingState();
      if (error instanceof OrderRejectedError) {
        setSubmitError({ title: 'Order not placed', message: error.message });
      } else if (error instanceof TradeSubmissionUnknownError) {
        setSubmitError({
          title: error.orderPostAttempted ? 'Checking order status' : 'Check leverage settings',
          message: error.orderPostAttempted
            ? 'Your order may be live. Check Account before trying again.'
            : 'No order was sent. Your leverage settings may have changed.',
        });
      } else {
        setSubmitError({ title: 'Order not sent', message: errorMessage(error) });
      }
    },
    onSettled: () => { submissionInFlight.current = false; },
  });

  const reset = () => {
    sheetTranslateY.stopAnimation();
    sheetTranslateY.setValue(0);
    setSheetAtTop(true);
    setSizeMode(defaultTradeSizeMode());
    setRiskUnit('usd');
    setAmount(initialSizeCoin != null ? String(initialSizeCoin) : '');
    setLimitPrice('');
    setTpPrice('');
    setSlPrice('');
    setSlippagePct(DEFAULT_SLIPPAGE_PCT);
    setPostOnly(false);
    setAdvancedOpen(false);
    setTpslOpen(false);
    setReduceOnly(!!closing);
    setLevOverride(null);
    setCrossOverride(null);
    setResult(null);
    setSubmitError(null);
    mutation.reset();
  };

  const close = () => {
    if (mutation.isPending) return;
    reset();
    onClose();
  };

  const finishSheetDrag = (dy: number, velocityY: number) => {
    if (shouldDismissTradeTicket(dy, velocityY)) {
      Animated.timing(sheetTranslateY, {
        toValue: 900,
        duration: 180,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        close();
      });
      return;
    }
    Animated.spring(sheetTranslateY, {
      toValue: 0,
      damping: 24,
      stiffness: 260,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  };

  const sheetPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      shouldStartTradeTicketDismiss(
        gesture.dx,
        gesture.dy,
        sheetAtTop ? 0 : 2,
        mutation.isPending,
      ),
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      shouldStartTradeTicketDismiss(
        gesture.dx,
        gesture.dy,
        sheetAtTop ? 0 : 2,
        mutation.isPending,
      ),
    onPanResponderGrant: () => {
      sheetTranslateY.stopAnimation();
      Keyboard.dismiss();
    },
    onPanResponderMove: (_, gesture) => {
      sheetTranslateY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_, gesture) => finishSheetDrag(gesture.dy, gesture.vy),
    onPanResponderTerminate: (_, gesture) => finishSheetDrag(gesture.dy, gesture.vy),
    onPanResponderTerminationRequest: () => false,
  });

  const submitVerb = actionLabel ?? (closing ? 'Close' : side === 'buy' ? 'Buy' : 'Sell');

  const submit = () => {
    if (submissionInFlight.current || mutation.isPending || result || !canSubmit || !assetMeta || !account || !authenticatedIdentity) return;
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
    // The final, explicitly labelled Buy/Sell button approves this exact snapshot.
    // A synchronous latch catches double taps before React can disable the button.
    submissionInFlight.current = true;
    setSubmitError(null);
    Keyboard.dismiss();
    mutation.mutate(draft);
  };

  const presets = levPresets(maxLev);
  const sizeModes: SizeMode[] = closing || reduceOnly ? ['coin', 'usd'] : ['coin', 'usd', 'risk'];
  const sizeModeCopy =
    sizeMode === 'coin'
      ? label
      : sizeMode === 'usd'
        ? 'USD'
        : riskUnit === 'percent'
          ? 'Risk %'
          : 'Risk USD';
  const cycleSizeMode = () => {
    const currentIndex = sizeModes.indexOf(sizeMode);
    changeSizeMode(sizeModes[(currentIndex + 1) % sizeModes.length] ?? defaultTradeSizeMode());
  };
  const allocationPercent =
    maxSz > 0 && sizeMode !== 'risk'
      ? Math.min(100, Math.max(0, (coinSize / maxSz) * 100))
      : 0;
  const allocationLeft = `${allocationPercent}%` as `${number}%`;
  const applyAllocationPercent = (nextPercent: number) => {
    if (!(maxSz > 0) || sizeMode === 'risk') return;
    const clamped = Math.min(100, Math.max(0, nextPercent));
    if (sizeMode === 'coin') {
      const nextSize = floorSize((maxSz * clamped) / 100, assetMeta?.szDecimals ?? 4);
      setAmount(nextSize > 0 ? String(nextSize) : '');
      return;
    }
    const nextUsd = (maxSz * sizingPx * clamped) / 100;
    setAmount(nextUsd > 0 ? String(Number(nextUsd.toFixed(2))) : '');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} disabled={mutation.isPending} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}>
        <Animated.View
          style={[styles.sheetMotion, { transform: [{ translateY: sheetTranslateY }] }]}>
          <SheetSurface style={styles.sheet}>
          {/* Header is one gesture zone; the scroll body below is the other. */}
          <View style={styles.sheetDragHeader} {...sheetPanResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <AppText variant="heading">
                {title ?? (closing ? `${actionLabel ?? 'Close'} ${label}` : `${label}-PERP`)}
              </AppText>
              <View style={styles.headerRight}>
                <AppText variant="caption" muted numeric>
                  Mark {triggerMarkPx > 0 ? `$${formatPrice(triggerMarkPx, priceDecimals)}` : '—'}
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
          </View>

          {!mutation.isPending ? <OrderRecoveryNotice network={network} address={tradingIdentity?.accountAddress} /> : null}
            <View style={styles.ticketContent}>
              <ScrollView
                {...sheetPanResponder.panHandlers}
                pointerEvents={mutation.isPending || result ? 'none' : 'auto'}
                style={styles.body}
                bounces={false}
                contentContainerStyle={styles.bodyContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                onScroll={(event) => {
                  const nextAtTop = event.nativeEvent.contentOffset.y <= 1;
                  setSheetAtTop((current) => (current === nextAtTop ? current : nextAtTop));
                }}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}>
              {/* Reference-style primary controls: order type, margin mode and leverage. */}
              <View style={styles.tradeControlRow}>
                <Pressable
                  style={styles.tradeControl}
                  onPress={() => {
                    const next = orderType === 'market' ? 'limit' : 'market';
                    setOrderType(next);
                    if (next === 'market') setPostOnly(false);
                  }}>
                  <AppText variant="label" color={Colors.text}>
                    {orderType === 'market' ? 'Market' : 'Limit'}
                  </AppText>
                  <Ionicons name="chevron-down" size={15} color={Colors.textMuted} />
                </Pressable>
                {!closing ? (
                  <Pressable style={styles.tradeControl} onPress={() => setAdvancedOpen(true)}>
                    <AppText variant="label" color={Colors.text}>
                      {isCross ? 'Cross' : 'Isolated'}
                    </AppText>
                    <Ionicons name="chevron-down" size={15} color={Colors.textMuted} />
                  </Pressable>
                ) : null}
                {!closing ? (
                  <Pressable style={styles.tradeControl} onPress={() => setAdvancedOpen(true)}>
                    <AppText variant="label" numeric color={Colors.text}>
                      {leverage}×
                    </AppText>
                    <Ionicons name="chevron-down" size={15} color={Colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>

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
                      ? `Closes your position only`
                      : `${side === 'buy' ? 'Buy / Long' : 'Sell / Short'}`}
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

              <View style={styles.availableRow}>
                <AppText variant="caption" muted>
                  Available
                </AppText>
                <AppText variant="label" numeric color={Colors.text}>
                  {account?.totalEquityLoaded === true ? `${compactNumber(avail, 2)} USDC` : '—'}
                </AppText>
              </View>

              {/* Lower-frequency execution controls stay behind the three top controls. */}
              {advancedOpen ? (
                  <View style={styles.advancedCard}>
                    <Pressable style={styles.advancedHead} onPress={() => setAdvancedOpen(false)}>
                      <View>
                        <AppText variant="label">Order settings</AppText>
                        <AppText variant="caption" muted>
                          {orderType === 'limit' && postOnly ? 'Post-only · ' : ''}
                          {!closing ? `${isCross ? 'Cross' : 'Isolated'} · ${leverage}× · ` : ''}
                          {slippagePctNum || 0}% cap
                        </AppText>
                      </View>
                      <Ionicons
                        name="chevron-up"
                        size={18}
                        color={Colors.textMuted}
                      />
                    </Pressable>

                      <View style={styles.advancedBody}>
                        {!closing && !reduceOnly ? (
                          <>
                            {!active ? (
                              <View style={styles.safeFallback}>
                                {activeLoading && !activeError ? <ActivityIndicator size="small" color={Colors.warning} /> : <Ionicons name="shield-checkmark-outline" size={16} color={Colors.warning} />}
                                <AppText variant="caption" color={Colors.warning} style={styles.safetyCopy}>
                                  {cannotSafelyFallback
                                    ? 'Adding is paused until your position settings are available.'
                                    : 'This new position will use 1× isolated margin.'}
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
                                        color={on ? Colors.background : Colors.textMuted}>
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
                                    <AppText variant="caption" color={on ? Colors.background : Colors.textMuted}>
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
                              Price tolerance
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
                                color={slippagePctNum === pct ? Colors.background : Colors.textMuted}>
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
                                  Only place if it can wait for a match
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
                  </View>
              ) : null}

              {/* Limit price */}
              {orderType === 'limit' ? (
                <Field label="Price (USDC)">
                  <TextInput
                    value={limitPrice}
                    onChangeText={setLimitPrice}
                    onFocus={() => setFocused('limit')}
                    placeholder={triggerMarkPx > 0 ? formatPrice(triggerMarkPx, priceDecimals) : 'Price'}
                    placeholderTextColor={Colors.textFaint}
                    keyboardType="decimal-pad"
                    keyboardAppearance="dark"
                    inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                    style={styles.input}
                  />
                  <Pressable
                    style={[styles.midButton, !(triggerMarkPx > 0) && { opacity: 0.4 }]}
                    disabled={!(triggerMarkPx > 0)}
                    onPress={() => setLimitPrice(String(Number(triggerMarkPx.toFixed(priceDecimals))))}>
                    <AppText variant="label" color={Colors.accent}>
                      Mid
                    </AppText>
                  </Pressable>
                </Field>
              ) : null}

              {/* Asset units are the default. Tap the unit inside the field to cycle
                  through asset, USD and risk sizing without adding a separate tab row. */}
              <Field
                label={sizeMode === 'risk' ? 'Account risk' : 'Size'}
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
                <Pressable style={styles.modeSelector} onPress={cycleSizeMode}>
                  <AppText variant="label" color={Colors.text}>
                    {sizeModeCopy}
                  </AppText>
                  <Ionicons name="chevron-down" size={15} color={Colors.textMuted} />
                </Pressable>
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

              {sizeMode !== 'risk' ? (
                <View style={styles.allocationRow}>
                  <Pressable
                    style={styles.allocationTrackTouch}
                    onLayout={(event) => setAllocationTrackWidth(event.nativeEvent.layout.width)}
                    onPress={(event) => {
                      if (allocationTrackWidth > 0) {
                        applyAllocationPercent((event.nativeEvent.locationX / allocationTrackWidth) * 100);
                      }
                    }}>
                    <View pointerEvents="none" style={styles.allocationTrack}>
                      <View style={[styles.allocationFill, { width: allocationLeft }]} />
                      {[25, 50, 75, 100].map((pct) => (
                        <View
                          key={pct}
                          style={[
                            styles.allocationDot,
                            { left: `${pct}%` as `${number}%` },
                            allocationPercent >= pct && styles.allocationDotOn,
                          ]}
                        />
                      ))}
                      <View style={[styles.allocationThumb, { left: allocationLeft }]} />
                    </View>
                  </Pressable>
                  <View style={styles.allocationInputWrap}>
                    <TextInput
                      value={String(Number(allocationPercent.toFixed(1)))}
                      onChangeText={(value) => applyAllocationPercent(num(value))}
                      onFocus={() => setFocused('size')}
                      keyboardType="decimal-pad"
                      keyboardAppearance="dark"
                      inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                      style={styles.allocationInput}
                    />
                    <AppText variant="label" color={Colors.text}>
                      %
                    </AppText>
                  </View>
                </View>
              ) : (
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
              )}

              <View style={styles.optionList}>
                {!closing ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: reduceOnly }}
                    onPress={toggleReduceOnly}
                    style={styles.optionRow}>
                    <View style={[styles.checkbox, reduceOnly && styles.checkboxOn]}>
                      {reduceOnly ? <Ionicons name="checkmark" size={15} color="#04150E" /> : null}
                    </View>
                    <AppText variant="label" color={Colors.text}>
                      Reduce Only
                    </AppText>
                  </Pressable>
                ) : null}
                {!closing && !reduceOnly ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: tpslOpen, disabled: sizeMode === 'risk' }}
                    onPress={() => {
                      if (sizeMode === 'risk') return;
                      const next = !tpslOpen;
                      setTpslOpen(next);
                      if (!next) {
                        setTpPrice('');
                        setSlPrice('');
                      }
                    }}
                    style={styles.optionRow}>
                    <View style={[styles.checkbox, tpslOpen && styles.checkboxOn]}>
                      {tpslOpen ? <Ionicons name="checkmark" size={15} color="#04150E" /> : null}
                    </View>
                    <AppText variant="label" color={Colors.text}>
                      Take Profit / Stop Loss
                    </AppText>
                  </Pressable>
                ) : null}
              </View>

              {/* Take profit / stop loss (optional bracket) — attaches to a new entry. */}
              {!closing && !reduceOnly && tpslOpen ? (
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

              {/* Essential order figures; optional estimates stay with settings. */}
              <View style={styles.infoCard}>
                {advancedOpen && liqPrice && !closing && !reduceOnly ? (
                  <InfoRow
                    label="Est. liquidation"
                    value={liqPrice ? `$${formatPrice(liqPrice, priceDecimals)}` : 'N/A'}
                    valueColor={liqPrice ? Colors.down : Colors.textMuted}
                  />
                ) : null}
                <InfoRow
                  label="Order value"
                  value={notional > 0 ? `${compactNumber(notional, 2)} USDC` : '—'}
                />
                {!closing && !reduceOnly ? (
                  <InfoRow
                    label="Margin"
                    value={marginRequired > 0 ? `${compactNumber(marginRequired, 2)} USDC` : '—'}
                  />
                ) : null}
                {advancedOpen ? <InfoRow
                  label="Price tolerance"
                  value={
                    orderType === 'market'
                      ? `Max ${slippagePctNum.toFixed(2)}%`
                      : postOnly
                        ? 'Post-only'
                        : 'Limit price'
                  }
                  valueColor={orderType === 'market' ? Colors.accent : Colors.text}
                /> : null}
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
                  This price limit may only fill part of your order.
                </AppText>
              ) : null}

              {/* Disabled-state hint */}
              {!tradable ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  {demo
                    ? 'Preview only. Connect your account to trade.'
                    : 'Connect your API key in Settings to trade.'}
                </AppText>
              ) : null}
              {tradable && sizeMode === 'risk' && !riskOk ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  {percentageRiskUnavailable && riskUnit === 'percent'
                    ? 'Use a dollar risk amount with Portfolio Margin.'
                    : 'Enter a risk amount and a stop on the loss side of the entry price.'}
                </AppText>
              ) : null}
              {tradable && !slippageOk ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  Set price tolerance between 0.01% and 5% in Order settings.
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

              {/* Always-visible action, matching the reference ticket's full-width order button. */}
              <View style={styles.submitDock}>
                {result ? <ResultView coin={label} submission={result} priceDecimals={priceDecimals} onDone={close} /> : <>
                {submitError ? <View style={styles.inlineFeedback} accessibilityLiveRegion="polite">
                  <Ionicons name="alert-circle-outline" size={21} color={Colors.warning} />
                  <View style={styles.feedbackCopy}><AppText variant="label" color={Colors.warning}>{submitError.title}</AppText><AppText variant="caption">{submitError.message}</AppText></View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Dismiss order message" onPress={() => setSubmitError(null)} hitSlop={10}><Ionicons name="close" size={18} color={Colors.textMuted} /></Pressable>
                </View> : null}
                <View style={styles.submitSummary}>
                  <AppText variant="label" numeric>{coinSize > 0 ? `${compactNumber(coinSize, assetMeta?.szDecimals ?? 4)} ${label}` : label}</AppText>
                  <AppText variant="caption" numeric muted>{orderType === 'limit' ? 'Limit' : isBuy ? 'Max' : 'Min'} {submittedPrice > 0 ? `$${formatPrice(submittedPrice, priceDecimals)}` : '—'}</AppText>
                </View>
                {currentPosition && positionImplication ? <AppText variant="caption" muted numeric>{positionImplication}</AppText> : null}
                <Pressable
                  style={[
                    styles.submit,
                    {
                      backgroundColor: canSubmit ? sideColor + '22' : GLASS_FILL,
                      borderColor: canSubmit ? sideColor : GLASS_HAIRLINE,
                    },
                  ]}
                  onPress={submit}
                  accessibilityRole="button"
                  accessibilityLabel={mutation.isPending ? 'Submitting order' : `${submitVerb} ${compactNumber(coinSize, assetMeta?.szDecimals ?? 4)} ${label} ${orderType} order`}
                  disabled={!canSubmit || mutation.isPending}
                  accessibilityState={{
                    disabled: !canSubmit || mutation.isPending,
                    busy: mutation.isPending,
                  }}>
                  {mutation.isPending ? (
                    <View style={styles.submitBusy}>
                      <ActivityIndicator size="small" color={Colors.text} />
                    </View>
                  ) : (
                    <AppText variant="label" color={canSubmit ? sideColor : Colors.textFaint}>
                      {`${submitVerb} ${label}`}
                    </AppText>
                  )}
                </Pressable>
                {maxLoss && !closing && !reduceOnly ? (
                  <AppText variant="caption" muted style={styles.stopDisclaimer}>
                    Estimated using the price limit and fees. Losses can be larger if a stop fills partly or not at all.
                  </AppText>
                ) : null}
                </>}
              </View>
            </View>
          </SheetSurface>
        </Animated.View>

        {/* Above-keyboard bar: decimal-pads have no Done key, so this is the only
            way to dismiss. Steppers nudge the focused field. */}
        {Platform.OS === 'ios' && !result && !mutation.isPending ? (
          <InputAccessoryView nativeID={ACCESSORY_ID} backgroundColor={Colors.background}>
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
                      ? 'Price tolerance · %'
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
