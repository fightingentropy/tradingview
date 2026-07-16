import { Ionicons } from '@expo/vector-icons';
import {
  GlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { useIsRestoring, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { IndicatorMenu } from '@/components/IndicatorMenu';
import { PriceChart, type ChartOrderLevel, type ChartType } from '@/components/PriceChart';
import { RangeBar } from '@/components/RangeBar';
import { RsiPane } from '@/components/RsiPane';
import { useSymbolMenu } from '@/components/SymbolMenu';
import {
  floorSizeToDecimals,
  TpSlSheet,
  type TpSlExistingOrder,
  type TpSlLegInput,
} from '@/components/TpSlSheet';
import { TradeTicket } from '@/components/TradeTicket';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { VenueBadge } from '@/components/VenueBadge';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { DEFAULT_RANGE, resolveRange, type RangeKey } from '@/domain/ranges';
import type { Candle } from '@/domain/types';
import { useActiveAsset } from '@/data/useActiveAsset';
import { useCandles } from '@/data/useCandles';
import { useHlAccount, useHlOpenOrders, useTradingIdentity } from '@/data/useHlAccount';
import { useHlMeta } from '@/data/useHlMeta';
import { useMarkets } from '@/data/useMarkets';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import {
  formatCompact,
  formatFundingApr,
  formatPercent,
  formatPrice,
  formatProbability,
  formatProbabilityPointChange,
  priceDecimalsFor,
  signedUsd,
} from '@/lib/format';
import {
  cancelOrder,
  placePositionTpSl,
  type OrderResult,
} from '@/lib/hyperliquid/exchange';
import {
  fetchHlAccount,
  fetchOpenOrders,
  type HlAccount,
  type HlOpenOrder,
  type HlPosition,
} from '@/lib/hyperliquid/info';
import {
  assertTradingIdentityCurrent,
  signedIdentityBinding,
  TradingIdentityError,
  type SignedTradingIdentityBinding,
} from '@/lib/hyperliquid/tradingIdentity';
import { priceToWire, sizeToWire } from '@/lib/hyperliquid/sign';
import { queryKeys } from '@/lib/queryKeys';
import { useChartSettings } from '@/store/chartSettings';
import { useHlConnection } from '@/store/hlConnection';
import { useLivePrice } from '@/store/livePrices';
import { usePreferences } from '@/store/preferences';
import { useWatchlists } from '@/store/watchlists';

/** Stable empty fallback so the loading/empty chart isn't handed a fresh [] each render. */
const EMPTY_CANDLES: Candle[] = [];
const LIQUID_GLASS = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

type TicketMode = 'buy' | 'sell' | 'add' | 'reduce' | 'close';

/** A failure before the authenticated exchange request was built/signed. */
class ProtectionPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtectionPreflightError';
  }
}

/** A local cancellation failure before any authenticated exchange call. */
class CancellationPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CancellationPreflightError';
  }
}

function protectionResultAccepted(result: OrderResult | undefined): boolean {
  return (
    result?.status === 'resting' ||
    result?.status === 'waitingForTrigger' ||
    result?.status === 'waitingForFill' ||
    result?.status === 'success' ||
    result?.status === 'filled'
  );
}

function protectionResultDetail(result: OrderResult | undefined): string {
  if (!result) return 'UNCONFIRMED — no acknowledgement returned';
  switch (result.status) {
    case 'error':
      return `REJECTED — ${result.error ?? 'Hyperliquid rejected this leg'}`;
    case 'unknown':
      return 'UNCONFIRMED — unrecognised exchange response';
    case 'waitingForTrigger':
      return 'accepted — waiting for trigger';
    case 'waitingForFill':
      return 'accepted — waiting for fill';
    case 'resting':
      return `accepted — resting${result.oid != null ? ` · order ${result.oid}` : ''}`;
    case 'filled':
      return `accepted — filled immediately${
        result.avgPx != null ? ` @ $${formatPrice(result.avgPx)}` : ''
      }`;
    case 'success':
      return 'accepted';
  }
}

/** Compact coin quantity used by the position strip and confirmations. */
function qty(size: number): string {
  if (size >= 100_000) return formatCompact(size);
  const d = size >= 1000 ? 0 : size >= 1 ? 3 : 5;
  return String(Number(size.toFixed(d)));
}

function isProtectionOrder(order: HlOpenOrder, position: HlPosition): boolean {
  const closesPosition =
    position.side === 'long' ? order.side === 'sell' : order.side === 'buy';
  return order.reduceOnly && order.isTrigger && closesPosition && (order.triggerPx ?? 0) > 0;
}

/** Hyperliquid's order label is authoritative; price direction is a fallback for
 * older responses whose `orderType` only said "Trigger". */
function protectionType(order: HlOpenOrder, position: HlPosition): 'tp' | 'sl' {
  const label = order.orderType.toLowerCase();
  if (label.includes('take profit')) return 'tp';
  if (label.includes('stop')) return 'sl';
  const px = order.triggerPx ?? order.limitPx;
  const favorable = position.side === 'long' ? px > position.entryPx : px < position.entryPx;
  return favorable ? 'tp' : 'sl';
}

function orderIsMarket(order: HlOpenOrder): boolean {
  return !order.orderType.toLowerCase().includes('limit');
}

export default function SymbolScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading: marketsLoading } = useMarkets();
  const isRestoring = useIsRestoring();
  const instrument = id ? data?.byId[id] : undefined;
  const quote = id ? data?.quotes[id] : undefined;
  const hlTradeCoin =
    instrument &&
    (instrument.id.startsWith('hl:perp:') || instrument.id.startsWith('hl:xyz:'))
      ? instrument.coinKey
      : undefined;

  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [ticketMode, setTicketMode] = useState<TicketMode | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const { interval, fetch: fetchCount, visible, render, axis } = resolveRange(range);

  useLivePriceFeed(instrument ? [instrument] : []);
  const live = useLivePrice(instrument?.coinKey);
  const { data: candleData, isLoading: candlesLoading } = useCandles(instrument, interval, fetchCount);
  const { data: activeAsset } = useActiveAsset(hlTradeCoin);
  const candles = candleData ?? EMPTY_CANDLES;

  const activeId = useWatchlists((s) => s.activeId);
  const watched = useWatchlists((s) => s.lists.find((l) => l.id === s.activeId)?.symbolIds.includes(id) ?? false);
  const toggle = useWatchlists((s) => s.toggle);
  const { open: openMenu } = useSymbolMenu();

  const smaPeriods = useChartSettings((s) => s.smaPeriods);
  const volume = useChartSettings((s) => s.volume);
  const rsi = useChartSettings((s) => s.rsi);
  const rsiPeriod = useChartSettings((s) => s.rsiPeriod);
  const showPosition = useChartSettings((s) => s.showPosition);

  const qc = useQueryClient();
  const { data: hlAccount, refetch: refetchHlAccount } = useHlAccount();
  const { data: tradingIdentity } = useTradingIdentity();
  const executionIdentity = signedIdentityBinding(tradingIdentity);
  const { data: openOrders } = useHlOpenOrders();
  const { data: meta } = useHlMeta();
  const network = useHlConnection((s) => s.network);
  const hasKey = useHlConnection((s) => s.hasKey);
  const demo = useHlConnection((s) => s.demo);
  const canTrade = hasKey && !demo && !!executionIdentity;
  const privacyMode = usePreferences((s) => s.privacyMode);

  // Position-aware actions must not depend on the chart-overlay preference. Keep
  // the live position for trading, then apply `showPosition` only at render time.
  const position = useMemo<HlPosition | null>(
    () =>
      instrument
        ? hlAccount?.positions.find((p) => p.coin === instrument.coinKey) ?? null
        : null,
    [instrument, hlAccount?.positions],
  );

  const symbolOrders = useMemo(
    () =>
      instrument
        ? (openOrders ?? []).filter((order) => order.coin === instrument.coinKey)
        : [],
    [instrument, openOrders],
  );

  const protectionOrders = useMemo(
    () => (position ? symbolOrders.filter((order) => isProtectionOrder(order, position)) : []),
    [position, symbolOrders],
  );

  const existingProtection = useMemo<TpSlExistingOrder[]>(
    () =>
      position
        ? protectionOrders.map((order) => ({
            id: order.oid,
            tpsl: protectionType(order, position),
            triggerPx: order.triggerPx ?? order.limitPx,
            size: order.size,
            isMarket: orderIsMarket(order),
          }))
        : [],
    [position, protectionOrders],
  );

  const chartOrderLevels = useMemo<ChartOrderLevel[]>(
    () =>
      symbolOrders
        .map((order): ChartOrderLevel | null => {
          const price = order.isTrigger ? order.triggerPx : order.limitPx;
          if (price == null || price <= 0) return null;
          // A reduce-only trigger protects this position only when its order
          // side actually closes the current direction. Hide stale/wrong-side
          // reduce-only triggers rather than presenting them as protection.
          if (order.reduceOnly && order.isTrigger) {
            if (!position || !isProtectionOrder(order, position)) return null;
            const kind = protectionType(order, position);
            return {
              id: order.oid,
              price,
              kind: kind === 'tp' ? 'take-profit' : 'stop-loss',
              label: kind === 'tp' ? 'TP' : 'SL',
              size: order.size,
            };
          }
          return {
            id: order.oid,
            price,
            kind: order.isTrigger ? 'trigger' : 'limit',
            label: order.isTrigger
              ? 'Trigger'
              : `${order.side === 'buy' ? 'Buy' : 'Sell'} limit`,
            size: order.size,
          };
        })
        .filter((level): level is ChartOrderLevel => level !== null),
    [symbolOrders, position],
  );

  const cancelMutation = useMutation({
    mutationFn: async ({
      order,
      identity,
    }: {
      order: HlOpenOrder;
      identity: SignedTradingIdentityBinding;
    }) => {
      const assertIdentityCurrent = () =>
        assertTradingIdentityCurrent(identity, useHlConnection.getState());
      const asset = meta?.[order.coin];
      if (!asset) {
        throw new CancellationPreflightError(
          `No market metadata for ${order.coin}. No cancellation was sent.`,
        );
      }
      const validateImmediatelyBeforeSigning = async () => {
        let latestOrders: HlOpenOrder[];
        try {
          latestOrders = await fetchOpenOrders(identity.accountAddress, identity.network);
        } catch (error) {
          throw new CancellationPreflightError(
            `Could not recheck the live trigger; no cancellation was sent: ${
              error instanceof Error ? error.message : 'network error'
            }`,
          );
        }
        const live = latestOrders.find((candidate) => candidate.oid === order.oid);
        const sameTrigger =
          live?.triggerPx == null && order.triggerPx == null
            ? true
            : live?.triggerPx != null &&
              order.triggerPx != null &&
              priceToWire(live.triggerPx, asset.szDecimals) ===
                priceToWire(order.triggerPx, asset.szDecimals);
        if (
          !live ||
          live.coin !== order.coin ||
          live.side !== order.side ||
          live.reduceOnly !== order.reduceOnly ||
          live.isTrigger !== order.isTrigger ||
          sizeToWire(live.size, asset.szDecimals) !==
            sizeToWire(order.size, asset.szDecimals) ||
          priceToWire(live.limitPx, asset.szDecimals) !==
            priceToWire(order.limitPx, asset.szDecimals) ||
          !sameTrigger
        ) {
          throw new CancellationPreflightError(
            'The reviewed trigger is no longer live in the same form. No cancellation was sent.',
          );
        }
      };
      // Once this call starts, a timeout/disconnect is ambiguous: Hyperliquid
      // may have applied the cancel even though its acknowledgement never arrived.
      let postAttempted = false;
      try {
        await cancelOrder({
          network: identity.network,
          identity,
          validateImmediatelyBeforeSigning,
          assertIdentityCurrent,
          assetIndex: asset.assetIndex,
          oid: order.oid,
          onPostAttempt: () => {
            postAttempted = true;
          },
        });
      } catch (error) {
        if (!postAttempted || error instanceof TradingIdentityError) {
          throw new CancellationPreflightError(
            error instanceof Error ? error.message : 'Trading identity could not be verified. No cancellation was sent.',
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (error instanceof CancellationPreflightError) {
        Alert.alert('Cancellation not sent', message);
        return;
      }
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      Alert.alert(
        'Cancellation status unknown',
        `${message}\n\nThe cancellation may have reached Hyperliquid. Wait for Open Orders and the account to refresh, then verify whether this trigger is still live before trying again.`,
      );
    },
  });

  const tpSlMutation = useMutation({
    mutationFn: async ({
      p,
      legs,
      identity,
    }: {
      p: HlPosition;
      legs: TpSlLegInput[];
      identity: SignedTradingIdentityBinding;
    }) => {
      const assertIdentityCurrent = () =>
        assertTradingIdentityCurrent(identity, useHlConnection.getState());
      try {
        assertIdentityCurrent();
      } catch (error) {
        throw new ProtectionPreflightError(
          error instanceof Error ? error.message : 'Trading identity changed. No orders were sent.',
        );
      }
      const asset = meta?.[p.coin];
      if (!asset) throw new ProtectionPreflightError(`No market metadata for ${p.coin}. No orders were sent.`);
      if (legs.length === 0) {
        throw new ProtectionPreflightError('Choose a take-profit or stop-loss first. No orders were sent.');
      }
      const requestedSize = legs[0]?.size ?? p.size;
      if (!(requestedSize > 0)) {
        throw new ProtectionPreflightError('Protected size must be greater than zero. No orders were sent.');
      }
      if (legs.some((leg) => Math.abs(leg.size - requestedSize) > 1e-10)) {
        throw new ProtectionPreflightError('TP and SL must protect the same size. No orders were sent.');
      }

      // The native Alert callback can run against a position captured several
      // seconds ago. Force a fresh account read *inside* the mutation, then make
      // the exchange call immediately after validation so stale side/size/mark
      // state never reaches the signer.
      let latestAccount: HlAccount | undefined;
      try {
        const refreshed = await refetchHlAccount({ throwOnError: true });
        latestAccount = refreshed.data;
      } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        throw new ProtectionPreflightError(
          `Couldn’t refresh the live position.${detail} No orders were sent.`,
        );
      }
      if (!latestAccount) {
        throw new ProtectionPreflightError('Couldn’t load the live position. No orders were sent.');
      }
      const latestPosition = latestAccount.positions.find((candidate) => candidate.coin === p.coin);
      if (!latestPosition) {
        throw new ProtectionPreflightError(
          `The ${p.coin} position is no longer open. No orders were sent.`,
        );
      }

      const expectedSize = floorSizeToDecimals(p.size, asset.szDecimals);
      const latestSize = floorSizeToDecimals(latestPosition.size, asset.szDecimals);
      if (latestPosition.side !== p.side || latestSize !== expectedSize) {
        throw new ProtectionPreflightError(
          `The position changed from ${p.side} ${qty(expectedSize)} to ${latestPosition.side} ${qty(
            latestSize,
          )}. No orders were sent; reopen Manage to review the live position.`,
        );
      }

      const latestMark = latestPosition.markPx;
      if (!(latestMark > 0) || !Number.isFinite(latestMark)) {
        throw new ProtectionPreflightError('The latest mark price is unavailable. No orders were sent.');
      }
      const invalidLeg = legs.find((leg) => {
        if (!(leg.triggerPx > 0) || !Number.isFinite(leg.triggerPx)) return true;
        if (leg.tpsl === 'tp') {
          return latestPosition.side === 'long'
            ? leg.triggerPx <= latestMark
            : leg.triggerPx >= latestMark;
        }
        return latestPosition.side === 'long'
          ? leg.triggerPx >= latestMark
          : leg.triggerPx <= latestMark;
      });
      if (invalidLeg) {
        throw new ProtectionPreflightError(
          `${invalidLeg.tpsl === 'tp' ? 'Take profit' : 'Stop loss'} $${formatPrice(
            invalidLeg.triggerPx,
          )} is no longer valid against the latest mark of $${formatPrice(
            latestMark,
          )}. No orders were sent; reopen Manage to choose a current trigger.`,
        );
      }

      const safeSize = floorSizeToDecimals(requestedSize, asset.szDecimals);
      if (!(safeSize > 0) || safeSize > latestSize) {
        throw new ProtectionPreflightError(
          'Protected size is no longer valid for the live position. No orders were sent.',
        );
      }

      const validateImmediatelyBeforeSigning = async () => {
        let finalAccount: HlAccount;
        try {
          finalAccount = await fetchHlAccount(identity.accountAddress, identity.network);
        } catch (error) {
          throw new ProtectionPreflightError(
            `Couldn’t perform the final live protection check; no orders were sent: ${
              error instanceof Error ? error.message : 'network error'
            }`,
          );
        }
        const finalPosition = finalAccount.positions.find(
          (candidate) => candidate.coin === p.coin,
        );
        const finalPositionSize = floorSizeToDecimals(
          finalPosition?.size ?? 0,
          asset.szDecimals,
        );
        if (
          !finalPosition ||
          finalPosition.side !== p.side ||
          finalPositionSize !== expectedSize ||
          !(safeSize > 0) ||
          safeSize > finalPositionSize ||
          legs.some(
            (leg) => floorSizeToDecimals(leg.size, asset.szDecimals) !== safeSize,
          )
        ) {
          throw new ProtectionPreflightError(
            'The position side, size, or protected amount changed at the signing boundary. No orders were sent.',
          );
        }
        const finalMark = finalPosition.markPx;
        const invalidFinalLeg = legs.find((leg) => {
          if (!(leg.triggerPx > 0) || !Number.isFinite(leg.triggerPx)) return true;
          if (leg.tpsl === 'tp') {
            return finalPosition.side === 'long'
              ? leg.triggerPx <= finalMark
              : leg.triggerPx >= finalMark;
          }
          return finalPosition.side === 'long'
            ? leg.triggerPx >= finalMark
            : leg.triggerPx <= finalMark;
        });
        if (!(finalMark > 0) || !Number.isFinite(finalMark) || invalidFinalLeg) {
          throw new ProtectionPreflightError(
            'The mark moved past a reviewed protection trigger at the signing boundary. No orders were sent.',
          );
        }
      };

      let postAttempted = false;
      try {
        return await placePositionTpSl({
          network: identity.network,
          identity,
          validateImmediatelyBeforeSigning,
          assertIdentityCurrent,
          assetIndex: asset.assetIndex,
          szDecimals: asset.szDecimals,
          positionIsLong: latestPosition.side === 'long',
          size: safeSize,
          legs: legs.map((leg) => ({
            tpsl: leg.tpsl,
            triggerPx: leg.triggerPx,
            isMarket: leg.isMarket,
            limitPx: leg.limitPx,
          })),
          onPostAttempt: () => {
            postAttempted = true;
          },
        });
      } catch (error) {
        if (!postAttempted || error instanceof TradingIdentityError) {
          throw new ProtectionPreflightError(
            error instanceof Error ? error.message : 'Trading identity could not be verified. No orders were sent.',
          );
        }
        throw error;
      }
    },
    onSuccess: (results, { legs }) => {
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      setManageOpen(false);

      const assessed = legs.map((leg, index) => ({
        leg,
        result: results[index],
        accepted: protectionResultAccepted(results[index]),
      }));
      const acceptedCount = assessed.filter((item) => item.accepted).length;
      const slUnconfirmed = assessed.some((item) => item.leg.tpsl === 'sl' && !item.accepted);
      const detail = assessed
        .map(
          ({ leg, result }) =>
            `${leg.tpsl === 'tp' ? 'Take profit' : 'Stop loss'}: ${protectionResultDetail(result)}`,
        )
        .join('\n');
      const allAccepted = acceptedCount === assessed.length;
      const noneAccepted = acceptedCount === 0;
      const title = allAccepted
        ? 'Protection acknowledged'
        : noneAccepted
          ? 'Protection not confirmed'
          : 'Protection only partly set';
      const stopWarning = slUnconfirmed
        ? '\n\nSTOP LOSS NOT CONFIRMED. Your position may be unprotected.'
        : '';
      const reviewWarning = allAccepted
        ? '\n\nReview Open Orders and the current position to verify what is live.'
        : '\n\nReview Open Orders and the current position before taking another action. Do not submit the pair again until you confirm which legs are live.';
      Alert.alert(title, detail + stopWarning + reviewWarning);
    },
    onError: (error: unknown) => {
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      setManageOpen(false);
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (error instanceof ProtectionPreflightError) {
        Alert.alert('Protection not sent', message);
        return;
      }
      Alert.alert(
        'Protection status unknown',
        `${message}\n\nThe exchange acknowledgement could not be confirmed. Review Open Orders and the current position before submitting anything again.`,
      );
    },
  });

  if (!instrument) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: id ?? 'Symbol' }} />
        <View style={styles.center}>
          {marketsLoading || isRestoring ? (
            <ActivityIndicator color={Colors.accent} />
          ) : (
            <AppText muted>Not found</AppText>
          )}
        </View>
      </Screen>
    );
  }

  const last = live ?? quote?.last ?? null;
  const prev = quote?.prevClose ?? null;
  const changePct =
    last !== null && prev !== null && prev !== 0
      ? ((last - prev) / prev) * 100
      : (quote?.change24hPct ?? null);
  const up = (changePct ?? 0) >= 0;
  const isOutcome = instrument.assetClass === 'outcome';
  const decimals = priceDecimalsFor(instrument.priceDecimals, last);
  // `last` is the chart/mid display price. Execution and mark-trigger validation
  // must use Hyperliquid's mark: the open position carries it for management
  // actions, while activeAssetData supplies it for a new position.
  const positionMark = position?.markPx && position.markPx > 0 ? position.markPx : null;
  const activeMark = activeAsset?.markPx && activeAsset.markPx > 0 ? activeAsset.markPx : null;
  const ticketMark = position ? (positionMark ?? activeMark ?? 0) : (activeMark ?? 0);
  const triggerMark = positionMark ?? activeMark ?? 0;

  // Trading covers Hyperliquid perps AND the trade.xyz (HIP-3) dex — the venues we can
  // sign orders for. Both resolve their order asset-id from the cached meta by coinKey.
  const isHlTradable = hlTradeCoin !== undefined;

  // Funding rate (perps only). Positive = longs pay shorts (red); negative = shorts pay longs (green).
  const funding = quote?.funding ?? null;
  const fundingColor =
    funding == null || funding === 0 ? Colors.textMuted : funding > 0 ? Colors.down : Colors.up;

  const tpOrders = existingProtection.filter((order) => order.tpsl === 'tp');
  const slOrders = existingProtection.filter((order) => order.tpsl === 'sl');
  const stoppedSize = slOrders.reduce((sum, order) => sum + Math.max(0, order.size), 0);
  const protectionLevel = (orders: TpSlExistingOrder[], label: string) => {
    if (orders.length === 0) return `${label} —`;
    const coveredSize = orders.reduce((sum, order) => sum + Math.max(0, order.size), 0);
    const coveredPct = position?.size
      ? Math.min(100, Math.round((coveredSize / position.size) * 100))
      : 0;
    if (orders.length > 1) return `${label} ×${orders.length} · ${coveredPct}%`;
    return `${label} ${formatPrice(orders[0].triggerPx, decimals)} · ${coveredPct}%`;
  };
  const protectionSummary =
    existingProtection.length === 0
      ? 'Unprotected · add a stop'
      : `${protectionLevel(tpOrders, 'TP')} · ${
          slOrders.length > 0 ? protectionLevel(slOrders, 'SL') : 'No SL'
        }`;
  const stopCoverage = position?.size
    ? Math.min(1, Math.max(0, stoppedSize / position.size))
    : 0;
  const chartPosition = position ? { ...position, stopCoverage } : null;
  const chartPositionVisible = showPosition && candles.length > 0;

  const openPositionActions = () => {
    if (!position) return;
    const sideLabel = position.side === 'long' ? 'LONG' : 'SHORT';
    const title = privacyMode
      ? `${sideLabel} ${position.leverage}× ${instrument.symbol}`
      : `${sideLabel} ${position.leverage}× · ${qty(position.size)} ${instrument.symbol}`;
    const message =
      `${privacyMode ? 'Position values hidden' : `${signedUsd(position.unrealizedPnl)} · ${formatPercent(position.roe * 100)} ROE`}\n` +
      `Entry $${formatPrice(position.entryPx, decimals)} · Mark $${formatPrice(position.markPx, decimals)}\n` +
      protectionSummary;

    if (!canTrade) {
      Alert.alert(
        title,
        `${message}\n\n${
          demo
            ? 'Demo account · read-only.'
            : 'Trading is unavailable until the API wallet identity is verified in Settings.'
        }`,
      );
      return;
    }

    const runAction = (index: number) => {
      if (index === 0) setTicketMode('add');
      else if (index === 1) setTicketMode('reduce');
      else if (index === 2) setManageOpen(true);
      else if (index === 3) setTicketMode('close');
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          message,
          options: ['Add to position', 'Reduce position', 'Manage TP / SL', 'Close position', 'Cancel'],
          destructiveButtonIndex: 3,
          cancelButtonIndex: 4,
          userInterfaceStyle: 'dark',
        },
        runAction,
      );
      return;
    }

    // Android native alerts support three buttons, so group the four actions
    // into two clear branches rather than dropping position management options.
    Alert.alert(title, message, [
      {
        text: 'Add / Reduce',
        onPress: () =>
          Alert.alert('Change position size', undefined, [
            { text: 'Add', onPress: () => runAction(0) },
            { text: 'Reduce', onPress: () => runAction(1) },
            { text: 'Cancel', style: 'cancel' },
          ]),
      },
      {
        text: 'Manage / Close',
        onPress: () =>
          Alert.alert('Manage position', undefined, [
            { text: 'Manage TP / SL', onPress: () => runAction(2) },
            { text: 'Close', style: 'destructive', onPress: () => runAction(3) },
            { text: 'Cancel', style: 'cancel' },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const ticketSide: 'buy' | 'sell' =
    ticketMode === 'sell'
      ? 'sell'
      : ticketMode === 'reduce' || ticketMode === 'close'
        ? position?.side === 'long'
          ? 'sell'
          : 'buy'
        : ticketMode === 'add' && position?.side === 'short'
          ? 'sell'
          : 'buy';
  const ticketIsContextual = ticketMode === 'add' || ticketMode === 'reduce' || ticketMode === 'close';

  const tradingUnavailable = () =>
    Alert.alert(
      'Trading isn’t enabled',
      demo
        ? 'The demo account is read-only. Connect your account and API wallet in Settings.'
        : hasKey
          ? 'The API wallet could not be verified against this account. Review the blocked identity status in Settings.'
          : 'Add an API wallet key in Settings to manage this position.',
    );

  const confirmCancelProtection = (idToCancel: string | number) => {
    const order = protectionOrders.find((candidate) => candidate.oid === Number(idToCancel));
    if (!order) return;
    if (!canTrade || !executionIdentity) {
      tradingUnavailable();
      return;
    }
    const identity = executionIdentity;
    const kind = position ? protectionType(order, position) : 'sl';
    Alert.alert(
      `Cancel ${kind.toUpperCase()}?`,
      `Remove the ${kind.toUpperCase()} trigger at $${formatPrice(order.triggerPx, decimals)}. Your position remains open.` +
        (network === 'mainnet' ? '\n\nThis changes a live mainnet order.' : '\n\nTestnet order.'),
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: 'Cancel order',
          style: 'destructive',
          onPress: () => cancelMutation.mutate({ order, identity }),
        },
      ],
    );
  };

  const confirmProtection = (legs: TpSlLegInput[]) => {
    if (!position || legs.length === 0) return;
    if (!canTrade || !executionIdentity) {
      tradingUnavailable();
      return;
    }
    const identity = executionIdentity;
    const selectedSize = Math.min(legs[0].size, position.size);
    const lines = legs
      .map(
        (leg) =>
          `${leg.tpsl === 'tp' ? 'TP' : 'SL'} $${formatPrice(leg.triggerPx, decimals)} · ${
            leg.isMarket ? 'market exit' : 'limit at trigger'
          }`,
      )
      .join('\n');
    const existingNote =
      protectionOrders.length > 0
        ? '\n\nExisting protection remains active until you cancel it.'
        : '';
    Alert.alert(
      `Set protection on ${instrument.symbol}?`,
      `${lines}\n\nProtect ${qty(selectedSize)} ${instrument.symbol} (${legs[0].closePct}%) with reduce-only mark-price triggers.` +
        existingNote +
        (network === 'mainnet' ? '\n\nThis uses real funds on mainnet.' : '\n\nTestnet order.'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set orders',
          onPress: () => tpSlMutation.mutate({ p: position, legs, identity }),
        },
      ],
    );
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: instrument.symbol,
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                hitSlop={12}
                onPress={() => openMenu(instrument)}
                accessibilityRole="button"
                accessibilityLabel="Set price alert">
                <Ionicons name="notifications-outline" size={21} color={Colors.textMuted} />
              </Pressable>
              <Pressable hitSlop={12} onPress={() => toggle(activeId, instrument.id)}>
                <Ionicons
                  name={watched ? 'star' : 'star-outline'}
                  size={22}
                  color={watched ? Colors.warning : Colors.textMuted}
                />
              </Pressable>
            </View>
          ),
        }}
      />

      <View style={styles.header}>
        <View style={styles.headerTop}>
          <VenueBadge venue={instrument.venue} />
          <AppText variant="caption" muted numberOfLines={1} style={styles.name}>
            {instrument.name}
          </AppText>
        </View>
        <AppText variant="title" numeric>
          {isOutcome ? formatProbability(last) : formatPrice(last, decimals)}
        </AppText>
        <View style={styles.metaRow}>
          <AppText
            variant="label"
            numeric
            color={changePct === null ? Colors.textMuted : up ? Colors.up : Colors.down}>
            {isOutcome && last !== null && prev !== null
              ? `${formatProbabilityPointChange(last - prev)} 24h`
              : formatPercent(changePct)}
          </AppText>
          {quote?.dayVolume ? (
            <AppText variant="label" numeric muted>
              · Vol {formatCompact(quote.dayVolume)}
            </AppText>
          ) : null}
          {funding != null ? (
            <AppText variant="label" numeric color={fundingColor}>
              · Funding {formatFundingApr(funding)} APR
            </AppText>
          ) : null}
        </View>
      </View>

      <View style={styles.chartArea}>
        {candlesLoading && candles.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <PriceChart
            // Remount on range change so the history-pan offset resets to the latest.
            key={range}
            candles={candles}
            priceDecimals={decimals}
            priceDisplay={isOutcome ? 'probability' : 'price'}
            type={chartType}
            smaPeriods={smaPeriods}
            showVolume={volume}
            visibleCount={visible}
            renderCount={render}
            axisKind={axis}
            position={showPosition ? chartPosition : null}
            orderLevels={showPosition ? chartOrderLevels : []}
            symbol={instrument.symbol}
            hideValues={privacyMode}
            onPositionPress={openPositionActions}
          />
        )}
        {position && !chartPositionVisible ? (
          <Pressable
            style={({ pressed }) => [styles.positionFallback, pressed && styles.positionFallbackPressed]}
            onPress={openPositionActions}
            accessibilityRole="button"
            accessibilityLabel={`Manage ${position.side} position`}>
            <Ionicons name="options-outline" size={16} color={Colors.accent} />
            <AppText variant="caption" color={Colors.accent}>
              Manage position
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {rsi && candles.length > 0 ? (
        <RsiPane candles={candles} period={rsiPeriod} visibleCount={visible} />
      ) : null}

      <View style={styles.controls}>
        <Pressable
          style={styles.typeToggle}
          onPress={() => setChartType((t) => (t === 'candle' ? 'line' : 'candle'))}
          accessibilityRole="button"
          accessibilityLabel="Toggle chart type">
          <Ionicons
            name={chartType === 'candle' ? 'stats-chart' : 'pulse'}
            size={18}
            color={Colors.textMuted}
          />
        </Pressable>
        <IndicatorMenu />
        <View style={styles.timeframeWrap}>
          <RangeBar value={range} onChange={setRange} />
        </View>
      </View>

      {isHlTradable ? (
        <FlatTradeBar
          onSell={() => setTicketMode('sell')}
          onBuy={() => setTicketMode('buy')}
        />
      ) : null}

      {isHlTradable ? (
        <TradeTicket
          key={
            ticketMode === 'close' || ticketMode === 'reduce'
              ? `${ticketMode}-${position?.side ?? 'flat'}-${position?.size ?? 0}`
              : ticketMode === 'add'
                ? `${ticketMode}-${position?.side ?? 'flat'}`
                : (ticketMode ?? 'closed')
          }
          visible={ticketMode !== null}
          onClose={() => setTicketMode(null)}
          coin={instrument.coinKey}
          symbol={instrument.symbol}
          markPx={ticketMark}
          executionMidPx={last ?? undefined}
          priceDecimals={decimals}
          initialSide={ticketSide}
          initialSizeCoin={
            position
              ? ticketMode === 'reduce'
                ? position.size * 0.25
                : ticketMode === 'close'
                  ? position.size
                  : undefined
              : undefined
          }
          closing={ticketMode === 'reduce' || ticketMode === 'close'}
          lockSide={ticketIsContextual}
          title={
            ticketMode === 'add' && position
              ? `Add to ${position.side} ${instrument.symbol}`
              : ticketMode === 'reduce' && position
                ? `Reduce ${position.side} ${instrument.symbol}`
                : ticketMode === 'close' && position
                  ? `Close ${position.side} ${instrument.symbol}`
                : undefined
          }
          actionLabel={
            ticketMode === 'add'
              ? 'Add'
              : ticketMode === 'reduce'
                ? 'Reduce'
                : ticketMode === 'close'
                  ? 'Close'
                  : undefined
          }
        />
      ) : null}

      <TpSlSheet
        key={manageOpen && position ? `${position.coin}-manage` : 'manage-closed'}
        visible={manageOpen && position !== null}
        onClose={() => setManageOpen(false)}
        symbol={instrument.symbol}
        side={position?.side ?? 'long'}
        size={position?.size ?? 0}
        entryPx={position?.entryPx ?? 0}
        markPx={triggerMark}
        leverage={position?.leverage ?? 1}
        priceDecimals={decimals}
        szDecimals={meta?.[instrument.coinKey]?.szDecimals ?? 8}
        tradable={canTrade}
        busy={tpSlMutation.isPending}
        allowPartial
        existingOrders={existingProtection}
        onCancelExisting={confirmCancelProtection}
        cancelBusyId={
          cancelMutation.isPending ? cancelMutation.variables?.order.oid : null
        }
        onSubmit={confirmProtection}
      />
    </Screen>
  );
}

function FlatTradeBar({ onSell, onBuy }: { onSell: () => void; onBuy: () => void }) {
  const buttons = (
    <>
      <GlassTradeButton side="sell" onPress={onSell} />
      <GlassTradeButton side="buy" onPress={onBuy} />
    </>
  );

  return LIQUID_GLASS ? (
    <GlassContainer spacing={10} style={styles.tradeBar}>
      {buttons}
    </GlassContainer>
  ) : (
    <View style={styles.tradeBar}>{buttons}</View>
  );
}

function GlassTradeButton({ side, onPress }: { side: 'buy' | 'sell'; onPress: () => void }) {
  const buy = side === 'buy';
  const color = buy ? Colors.up : Colors.down;
  const label = buy ? 'Buy' : 'Sell';
  const content = (
    <Pressable
      style={({ pressed }) => [
        styles.tradeBtnPressable,
        pressed && { backgroundColor: color + '1F' },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <View pointerEvents="none" style={[styles.tradeBtnTint, { backgroundColor: color + '18' }]} />
      <View pointerEvents="none" style={styles.tradeBtnHighlight} />
      <View pointerEvents="none" style={styles.tradeBtnContent}>
        <Ionicons name={buy ? 'arrow-up' : 'arrow-down'} size={16} color={color} />
        <AppText style={styles.tradeBtnLabel}>{label}</AppText>
      </View>
    </Pressable>
  );

  const surfaceStyle = [styles.tradeBtn, { borderColor: color + '70' }];
  if (LIQUID_GLASS) {
    return (
      <GlassView
        style={surfaceStyle}
        glassEffectStyle="regular"
        colorScheme="dark"
        tintColor={color + '3D'}
        isInteractive>
        {content}
      </GlassView>
    );
  }

  return <View style={[surfaceStyle, styles.tradeBtnFallback]}>{content}</View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: 4 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.xs, rowGap: 2 },
  chartArea: { flex: 1, marginTop: Spacing.sm },
  positionFallback: {
    position: 'absolute',
    top: 48,
    right: Spacing.sm,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.accent + '66',
    backgroundColor: Colors.surfaceAlt,
    zIndex: 5,
  },
  positionFallbackPressed: { backgroundColor: Colors.surfacePress },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm },
  typeToggle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeframeWrap: { flex: 1 },
  tradeBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  tradeBtn: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tradeBtnFallback: { backgroundColor: 'rgba(20,26,34,0.92)' },
  tradeBtnPressable: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  tradeBtnTint: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  tradeBtnHighlight: {
    position: 'absolute',
    top: 0,
    left: 22,
    right: 22,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.48)',
  },
  tradeBtnContent: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  tradeBtnLabel: { color: Colors.text, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
});
