import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { OrderRecoveryNotice } from '@/components/OrderRecoveryNotice';
import { accountReadState } from '@/lib/accountReadState';
import { MarginSheet } from '@/components/MarginSheet';
import { PortfolioCard } from '@/components/PortfolioCard';
import { SymbolLogo } from '@/components/SymbolLogo';
import { TradeTicket } from '@/components/TradeTicket';
import {
  TpSlSheet,
  type TpSlExistingOrder,
  type TpSlLegInput,
} from '@/components/TpSlSheet';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAllMarkets } from '@/data/useMarkets';
import {
  useHlAccount,
  useHlAccountFees,
  useHlEarnBalance,
  useHlHistoricalOrders,
  useHlFills,
  useHlOpenOrders,
  useTradingIdentity,
} from '@/data/useHlAccount';
import { useHlAccountActivity, useHlBorrowLendInterest, useHlUserFunding } from '@/data/useHlHistory';
import { useHlMeta } from '@/data/useHlMeta';
import {
  buildAccountRiskSummary,
  isProtectiveStop,
  type AccountRiskSummary,
} from '@/lib/accountRisk';
import {
  OrderRejectedError,
  cancelOrder,
  marketClose,
  placePositionTpSl,
  reversePosition,
  updateIsolatedMargin,
  type OrderResult,
} from '@/lib/hyperliquid/exchange';
import { fetchHlAccount, fetchOpenOrders } from '@/lib/hyperliquid/info';
import type {
  HlBorrowLendInterest,
  HlFill,
  HlOpenOrder,
  HlPosition,
  HlSpotBalance,
  HlUserFunding,
} from '@/lib/hyperliquid/info';
import {
  assertTradingIdentityCurrent,
  signedIdentityBinding,
  TradingIdentityError,
  type SignedTradingIdentityBinding,
} from '@/lib/hyperliquid/tradingIdentity';
import { formatCompact, formatPercent, formatPrice, priceDecimalsFor, signedUsd, usd } from '@/lib/format';
import { priceToWire, sizeToWire } from '@/lib/hyperliquid/sign';
import { outcomeAssetId } from '@/lib/outcomeMarkets';
import { queryKeys } from '@/lib/queryKeys';
import { fillNetPnl, shortAccountMode } from '@/lib/portfolioMetrics';
import { formatFundingRatePercent } from '@/lib/fundingHistory';
import type { Instrument } from '@/domain/types';
import { DEMO_ADDRESS, useHlConnection } from '@/store/hlConnection';
import { SMALL_BALANCE_USD, usePreferences } from '@/store/preferences';

/** Shown in place of any account value when privacy mode is on. */
const MASK = '••••••';

function qty(size: number): string {
  if (size >= 100_000) return formatCompact(size);
  const d = size >= 1000 ? 0 : size >= 1 ? 3 : 5;
  return String(Number(size.toFixed(d)));
}

const ISOLATED_MARGIN_BUFFER_USD = 0.01;
const LIQUIDATION_REVIEW_DRIFT_PCT = 0.1;
const MARKET_ACTION_SLIPPAGE = 0.05;

/**
 * Hyperliquid retains at least the larger of initial margin and 10% of current
 * notional when margin is transferred out of an isolated position. Keep a cent
 * above that floor so the UI never presents all displayed margin as removable.
 * The exchange remains authoritative and the mutation rechecks this against a
 * fresh account snapshot immediately before signing.
 */
function isolatedMarginRemovalSafetyLimit(p: HlPosition): number {
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

function positionLiquidationDistancePct(p: HlPosition): number | null {
  if (!(p.markPx > 0) || p.liquidationPx == null || !(p.liquidationPx > 0)) return null;
  return (Math.abs(p.markPx - p.liquidationPx) / p.markPx) * 100;
}

/** Token balance amount, comma-grouped with adaptive precision. */
function tokenAmt(v: number): string {
  if (v >= 1_000_000_000) return formatCompact(v);
  return formatPrice(v, v >= 1000 ? 2 : v >= 1 ? 4 : 6);
}

function protectionAckIsAccepted(result: OrderResult | undefined): boolean {
  return !!result && result.status !== 'error' && result.status !== 'unknown';
}

function protectionAckLabel(result: OrderResult | undefined): string {
  if (!result || result.status === 'unknown') return 'Not confirmed';
  if (result.status === 'error') return `Rejected · ${result.error ?? 'exchange error'}`;
  if (result.status === 'waitingForFill') return 'Acknowledged · waiting for fill';
  if (result.status === 'waitingForTrigger') return 'Acknowledged · waiting for trigger';
  if (result.status === 'resting') return 'Acknowledged · resting';
  if (result.status === 'filled') return 'Filled';
  return 'Acknowledged · success';
}

class ProtectionPreflightError extends Error {}

class AccountPreflightError extends Error {}

class AccountMutationStatusUnknownError extends Error {
  constructor(
    readonly action: 'close' | 'reverse' | 'margin' | 'cancel',
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : 'Unknown exchange error');
  }
}

/** Outcome balances use `+encoding`, while books/orders/catalog entries use `#encoding`. */
function marketCoinKey(coin: string): string {
  const token = /^\+(\d+)$/.exec(coin);
  return token ? `#${token[1]}` : coin;
}

/** Clean ticker for a position/token coin without exposing machine-only outcome ids as a symbol. */
const cleanCoin = (coin: string) => {
  const normalized = marketCoinKey(coin);
  const outcome = /^#(\d+)$/.exec(normalized);
  return outcome ? `Outcome #${outcome[1]}` : normalized.replace(/^xyz:/, '');
};

interface OrderAssetMeta {
  assetIndex: number;
  szDecimals: number;
  isPerp: boolean;
}

/** Resolve both perp and outcome order assets for byte-exact cancellation checks. */
function orderAssetMeta(
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

function displayPriceDecimals(
  coin: string,
  instrument: Instrument | undefined,
  price: number,
): number {
  const declared = marketCoinKey(coin).startsWith('#')
    ? 5
    : (instrument?.priceDecimals ?? 6);
  return priceDecimalsFor(declared, price);
}

interface PositionProtectionLevels {
  readonly takeProfitPx: number | null;
  readonly stopLossPx: number | null;
}

/** Nearest live reduce-only TP and SL levels for the position card. */
function protectionLevelsForPosition(
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

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Compact timestamp: "HH:MM" for today, else "Mon D" (Intl-free for Hermes). */
function whenLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Fuller timestamp for an expanded row: "Jun 18, 16:45:48". */
function fullWhen(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Token-denominated account delta with enough precision for hourly funding/interest. */
function historyTokenAmount(value: number, sign: '+' | '-' | 'auto' = 'auto'): string {
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
function moneyExact(v: number): string {
  const a = Math.abs(v);
  if (a >= 10 || a === 0) return a.toFixed(2);
  const trimmed = a.toFixed(4).replace(/0+$/, '');
  const decimals = trimmed.length - trimmed.indexOf('.') - 1;
  return decimals < 2 ? a.toFixed(2) : trimmed;
}
const usdExact = (v: number) => '$' + moneyExact(v);
const signMoneyExact = (v: number) => (v >= 0 ? '+' : '-') + '$' + moneyExact(v);

interface PositionMarketActionRequest {
  readonly action: 'close' | 'reverse';
  readonly position: HlPosition;
  readonly identity: SignedTradingIdentityBinding;
}

interface PositionMarketActionResult extends PositionMarketActionRequest {
  readonly acknowledgement: OrderResult;
}

/** Re-check the exact position the user confirmed after identity proof and immediately before signing. */
async function validatePositionActionImmediately(
  request: PositionMarketActionRequest,
  currentMeta: { assetIndex: number; szDecimals: number } | undefined,
): Promise<void> {
  const { position, identity } = request;
  if (
    !currentMeta ||
    !Number.isInteger(currentMeta.assetIndex) ||
    !Number.isInteger(currentMeta.szDecimals)
  ) {
    throw new AccountPreflightError(
      'Market metadata is unavailable. Refresh the position and try again; no order was sent.',
    );
  }

  let latestAccount;
  try {
    latestAccount = await fetchHlAccount(identity.accountAddress, identity.network);
  } catch (error) {
    throw new AccountPreflightError(
      `Could not recheck the live position; no ${request.action} order was sent: ${
        error instanceof Error ? error.message : 'network error'
      }`,
    );
  }
  const live = latestAccount.positions.find((candidate) => candidate.coin === position.coin);
  if (
    !live ||
    live.side !== position.side ||
    sizeToWire(live.size, currentMeta.szDecimals) !==
      sizeToWire(position.size, currentMeta.szDecimals)
  ) {
    throw new AccountPreflightError(
      `The live position changed after review. Refresh it and confirm ${request.action} again; no order was sent.`,
    );
  }
}

export default function AccountScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const address = useHlConnection((s) => s.address);
  const demo = useHlConnection((s) => s.demo);
  const network = useHlConnection((s) => s.network);
  const hasKey = useHlConnection((s) => s.hasKey);
  const connectDemo = useHlConnection((s) => s.connectDemo);
  const accountQuery = useHlAccount();
  const { data: account, isLoading, isFetching, refetch } = accountQuery;
  const identityQuery = useTradingIdentity();
  const { data: tradingIdentity } = identityQuery;
  const executionIdentity = signedIdentityBinding(tradingIdentity);
  const ordersQuery = useHlOpenOrders();
  const { data: openOrders } = ordersQuery;
  const feesQuery = useHlAccountFees();
  const earnQuery = useHlEarnBalance();
  const fillsQuery = useHlFills();
  const { data: fills } = fillsQuery;
  const { data: markets } = useAllMarkets();
  const { data: meta } = useHlMeta();

  const outcomeLabelByCoin = useMemo(() => {
    const labels = new Map<string, string>();
    for (const event of markets?.outcomeEvents ?? []) {
      for (const choice of event.choices) {
        for (const contract of choice.tradeContracts) {
          const label =
            event.kind === 'question'
              ? `${choice.label} · ${contract.sideLabel}`
              : choice.label;
          labels.set(contract.coinKey, label);
          labels.set(contract.tokenName, label);
        }
      }
    }
    return labels;
  }, [markets?.outcomeEvents]);

  const tradable = hasKey && !demo && !!executionIdentity;
  const [tab, setTab] = useState<
    'positions' | 'orders' | 'balances' | 'history' | 'funding' | 'interest' | 'orderHistory' | 'transfers'
  >('balances');
  const historicalOrdersQuery = useHlHistoricalOrders(tab === 'orderHistory');
  const activityQuery = useHlAccountActivity(tab === 'transfers');
  const {
    data: fundingHistory,
    isLoading: fundingHistoryLoading,
    isError: fundingHistoryError,
    refetch: refetchFundingHistory,
  } = useHlUserFunding(tab === 'funding');
  const {
    data: interestHistory,
    isLoading: interestHistoryLoading,
    isError: interestHistoryError,
    refetch: refetchInterestHistory,
  } = useHlBorrowLendInterest(tab === 'interest');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Long-lived sheets store identifiers only. Account state refreshes every 5s;
  // retaining a position snapshot here could close or protect a stale size/mark.
  const [marginTargetCoin, setMarginTargetCoin] = useState<string | null>(null);
  const [tpSlTargetCoin, setTpSlTargetCoin] = useState<string | null>(null);
  const [limitCloseTargetCoin, setLimitCloseTargetCoin] = useState<string | null>(null);
  const hideSmallBalances = usePreferences((s) => s.hideSmallBalances);
  const privacyMode = usePreferences((s) => s.privacyMode);
  const setPrivacyMode = usePreferences((s) => s.setPrivacyMode);
  // Privacy mode masks every account value/amount; market prices stay visible.
  const mask = useCallback((s: string) => (privacyMode ? MASK : s), [privacyMode]);

  // Resolve a position's coin to a real catalog instrument (logo + chart link + decimals).
  // `coinKey` matches perps and outcome books. Outcome wallet tokens are normalized
  // from `+encoding` to the catalog/order-book form `#encoding` first.
  const instrumentForCoin = useCallback(
    (coin: string): Instrument | undefined => markets?.byCoinKey.get(marketCoinKey(coin)),
    [markets],
  );
  const symbolForCoin = useCallback(
    (coin: string): string =>
      outcomeLabelByCoin.get(coin) ??
      outcomeLabelByCoin.get(marketCoinKey(coin)) ??
      instrumentForCoin(coin)?.symbol ??
      cleanCoin(coin),
    [instrumentForCoin, outcomeLabelByCoin],
  );

  const marginTarget = marginTargetCoin
    ? account?.positions.find((position) => position.coin === marginTargetCoin) ?? null
    : null;
  const tpSlTarget = tpSlTargetCoin
    ? account?.positions.find((position) => position.coin === tpSlTargetCoin) ?? null
    : null;
  const limitCloseTarget = limitCloseTargetCoin
    ? account?.positions.find((position) => position.coin === limitCloseTargetCoin) ?? null
    : null;

  const positionActionMutation = useMutation({
    mutationFn: async (
      request: PositionMarketActionRequest,
    ): Promise<PositionMarketActionResult> => {
      const { action, identity, position } = request;
      const assertIdentityCurrent = () =>
        assertTradingIdentityCurrent(identity, useHlConnection.getState());
      try {
        assertIdentityCurrent();
      } catch (error) {
        throw new AccountPreflightError(error instanceof Error ? error.message : 'Trading identity changed.');
      }

      const asset = meta?.[position.coin];
      if (!asset) {
        throw new AccountPreflightError(
          `No market metadata for ${position.coin}. No order was sent.`,
        );
      }
      if (!(position.markPx > 0) || !Number.isFinite(position.markPx)) {
        throw new AccountPreflightError(
          `No valid mark price for ${position.coin}. Refresh the position and try again; no order was sent.`,
        );
      }

      let postAttempted = false;
      let acknowledgement: OrderResult;
      try {
        const submit = action === 'close' ? marketClose : reversePosition;
        acknowledgement = await submit({
          network: identity.network,
          recoveryCoin: position.coin,
          identity,
          validateImmediatelyBeforeSigning: () =>
            validatePositionActionImmediately(request, meta?.[position.coin]),
          assertIdentityCurrent,
          assetIndex: asset.assetIndex,
          szDecimals: asset.szDecimals,
          positionIsLong: position.side === 'long',
          size: position.size,
          markPx: position.markPx,
          slippage: MARKET_ACTION_SLIPPAGE,
          onPostAttempt: () => {
            postAttempted = true;
          },
        });
      } catch (error) {
        if (error instanceof OrderRejectedError) throw error;
        if (!postAttempted) {
          throw new AccountPreflightError(
            error instanceof Error ? error.message : 'Trading identity could not be verified. No order was sent.',
          );
        }
        // Once the exchange POST begins, a timeout/lost response cannot prove the
        // order was rejected. Treat every such error as ambiguous to prevent retries.
        throw new AccountMutationStatusUnknownError(action, error);
      }
      return { ...request, acknowledgement };
    },
    onSuccess: ({ action, position, acknowledgement }) => {
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlFillsPrefix() });
      qc.invalidateQueries({ queryKey: ['hl', 'activeAsset'] });

      const symbol = instrumentForCoin(position.coin)?.symbol ?? cleanCoin(position.coin);
      const filled = acknowledgement.status === 'filled';
      const title = filled
        ? action === 'close'
          ? 'Position closed'
          : 'Reverse filled'
        : action === 'close'
          ? 'Close not completed'
          : 'Reverse not completed';
      const requestedSize = action === 'reverse' ? position.size * 2 : position.size;
      const fillLine =
        filled && acknowledgement.totalSz != null
          ? `Filled ${qty(acknowledgement.totalSz)} of ${qty(requestedSize)} ${symbol}.`
          : `Exchange acknowledgement: ${acknowledgement.status}.`;
      const followUp = filled
        ? 'The account is refreshing now. Verify the live position before taking another action.'
        : `The ${action} was not confirmed as filled. Review the live position and fills before retrying.`;
      Alert.alert(title, `${fillLine}\n\n${followUp}`);
    },
    onError: (e: unknown, request) => {
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlFillsPrefix() });
      qc.invalidateQueries({ queryKey: ['hl', 'activeAsset'] });
      const label = request.action === 'close' ? 'Close' : 'Reverse';
      if (e instanceof OrderRejectedError) {
        Alert.alert(`${label} rejected`, e.message);
        return;
      }
      if (e instanceof AccountPreflightError) {
        Alert.alert(`${label} not sent`, e.message);
        return;
      }
      Alert.alert(
        `${label} status unknown`,
        `${e instanceof Error ? e.message : 'The exchange response was not confirmed.'}\n\nNew orders are paused while saved order IDs are checked. Review the recovery panel in Account.`,
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ o, identity }: { o: HlOpenOrder; identity: SignedTradingIdentityBinding }) => {
      const assertIdentityCurrent = () =>
        assertTradingIdentityCurrent(identity, useHlConnection.getState());
      const m = orderAssetMeta(o.coin, meta);
      if (!m) throw new AccountPreflightError(`No market metadata for ${o.coin}. No cancellation was sent.`);
      const validateImmediatelyBeforeSigning = async () => {
        let latestOrders: HlOpenOrder[];
        try {
          latestOrders = await fetchOpenOrders(identity.accountAddress, identity.network);
        } catch (error) {
          throw new AccountPreflightError(
            `Could not recheck the live order; no cancellation was sent: ${
              error instanceof Error ? error.message : 'network error'
            }`,
          );
        }
        const live = latestOrders.find((candidate) => candidate.oid === o.oid);
        const sameTrigger =
          live?.triggerPx == null && o.triggerPx == null
            ? true
            : live?.triggerPx != null &&
              o.triggerPx != null &&
              priceToWire(live.triggerPx, m.szDecimals, m.isPerp) ===
                priceToWire(o.triggerPx, m.szDecimals, m.isPerp);
        if (
          !live ||
          live.coin !== o.coin ||
          live.side !== o.side ||
          live.reduceOnly !== o.reduceOnly ||
          live.isTrigger !== o.isTrigger ||
          sizeToWire(live.size, m.szDecimals) !== sizeToWire(o.size, m.szDecimals) ||
          priceToWire(live.limitPx, m.szDecimals, m.isPerp) !==
            priceToWire(o.limitPx, m.szDecimals, m.isPerp) ||
          !sameTrigger
        ) {
          throw new AccountPreflightError(
            'The reviewed order is no longer live in the same form. No cancellation was sent.',
          );
        }
      };
      let postAttempted = false;
      try {
        return await cancelOrder({
          network: identity.network,
          identity,
          validateImmediatelyBeforeSigning,
          assertIdentityCurrent,
          assetIndex: m.assetIndex,
          oid: o.oid,
          onPostAttempt: () => {
            postAttempted = true;
          },
        });
      } catch (error) {
        if (!postAttempted || error instanceof TradingIdentityError) {
          throw new AccountPreflightError(
            error instanceof Error ? error.message : 'Trading identity could not be verified. No cancellation was sent.',
          );
        }
        throw new AccountMutationStatusUnknownError('cancel', error);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
    },
    onError: (e: unknown) => {
      if (e instanceof AccountPreflightError) {
        Alert.alert('Cancellation not sent', e.message);
        return;
      }
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      Alert.alert(
        'Cancellation status unknown',
        `${e instanceof Error ? e.message : 'The exchange response was not confirmed.'}\n\nRefresh Open Orders before trying to cancel again.`,
      );
    },
  });

  const marginMutation = useMutation({
    mutationFn: async ({ p, signedUsd, identity }: {
      p: HlPosition;
      signedUsd: number;
      identity: SignedTradingIdentityBinding;
    }) => {
      const assertIdentityCurrent = () =>
        assertTradingIdentityCurrent(identity, useHlConnection.getState());
      try {
        assertIdentityCurrent();
      } catch (error) {
        throw new AccountPreflightError(error instanceof Error ? error.message : 'Trading identity changed.');
      }
      if (!Number.isFinite(signedUsd) || Math.abs(signedUsd) < 0.000001) {
        throw new AccountPreflightError('Enter a valid margin amount. Margin was not changed.');
      }
      const mInfo = meta?.[p.coin];
      if (!mInfo) throw new AccountPreflightError(`No market metadata for ${p.coin}. Margin was not changed.`);
      const latestQuery = await refetch();
      if (latestQuery.isError || !latestQuery.data) {
        throw new AccountPreflightError('Could not recheck the live position. Margin was not changed.');
      }
      const live = latestQuery.data.positions.find((position) => position.coin === p.coin);
      const sizeTolerance = 1 / 10 ** mInfo.szDecimals;
      if (
        !live ||
        live.side !== p.side ||
        live.leverageType !== 'isolated' ||
        Math.abs(live.size - p.size) >= sizeTolerance
      ) {
        throw new AccountPreflightError('The isolated position changed. Review the margin change again; margin was not changed.');
      }
      if (Math.abs(live.marginUsed - p.marginUsed) > ISOLATED_MARGIN_BUFFER_USD) {
        throw new AccountPreflightError(
          'The live isolated margin changed. Review the updated margin and liquidation risk again; margin was not changed.',
        );
      }
      if (signedUsd < 0) {
        if (mInfo.marginMode === 'strictIsolated') {
          throw new AccountPreflightError(
            'This strict-isolated market does not allow margin removal. No action was sent.',
          );
        }
        const removal = Math.abs(signedUsd);
        const liveRemovalLimit = isolatedMarginRemovalSafetyLimit(live);
        if (!(liveRemovalLimit > 0) || removal > liveRemovalLimit + 0.000001) {
          throw new AccountPreflightError(
            'The requested removal no longer clears the conservative live margin floor. Review the updated position; margin was not changed.',
          );
        }
        const reviewedDistance = positionLiquidationDistancePct(p);
        const liveDistance = positionLiquidationDistancePct(live);
        if (
          reviewedDistance == null ||
          liveDistance == null ||
          liveDistance < reviewedDistance - LIQUIDATION_REVIEW_DRIFT_PCT
        ) {
          throw new AccountPreflightError(
            'Liquidation risk worsened or could not be rechecked. Review the current mark and liquidation distance again; margin was not changed.',
          );
        }
      }
      const validateImmediatelyBeforeSigning = async () => {
        let latestAccount;
        try {
          latestAccount = await fetchHlAccount(identity.accountAddress, identity.network);
        } catch (error) {
          throw new AccountPreflightError(
            `Could not perform the final live margin check; margin was not changed: ${
              error instanceof Error ? error.message : 'network error'
            }`,
          );
        }
        const finalPosition = latestAccount.positions.find(
          (position) => position.coin === p.coin,
        );
        if (
          !finalPosition ||
          finalPosition.side !== p.side ||
          finalPosition.leverageType !== 'isolated' ||
          sizeToWire(finalPosition.size, mInfo.szDecimals) !==
            sizeToWire(p.size, mInfo.szDecimals)
        ) {
          throw new AccountPreflightError(
            'The isolated position changed at the signing boundary. Margin was not changed.',
          );
        }
        if (
          Math.abs(finalPosition.marginUsed - p.marginUsed) > ISOLATED_MARGIN_BUFFER_USD
        ) {
          throw new AccountPreflightError(
            'The isolated margin changed at the signing boundary. Review it again; margin was not changed.',
          );
        }
        if (signedUsd < 0) {
          if (mInfo.marginMode === 'strictIsolated') {
            throw new AccountPreflightError(
              'This strict-isolated market does not allow margin removal. No action was sent.',
            );
          }
          const removal = Math.abs(signedUsd);
          const finalRemovalLimit = isolatedMarginRemovalSafetyLimit(finalPosition);
          if (!(finalRemovalLimit > 0) || removal > finalRemovalLimit + 0.000001) {
            throw new AccountPreflightError(
              'The removal no longer clears the live liquidation-risk floor. Margin was not changed.',
            );
          }
          const reviewedDistance = positionLiquidationDistancePct(p);
          const finalDistance = positionLiquidationDistancePct(finalPosition);
          if (
            reviewedDistance == null ||
            finalDistance == null ||
            finalDistance < reviewedDistance - LIQUIDATION_REVIEW_DRIFT_PCT
          ) {
            throw new AccountPreflightError(
              'Liquidation risk worsened at the signing boundary. Margin was not changed.',
            );
          }
        }
      };
      let postAttempted = false;
      try {
        return await updateIsolatedMargin({
          network: identity.network,
          identity,
          validateImmediatelyBeforeSigning,
          assertIdentityCurrent,
          assetIndex: mInfo.assetIndex,
          usd: signedUsd,
          onPostAttempt: () => {
            postAttempted = true;
          },
        });
      } catch (error) {
        if (!postAttempted || error instanceof TradingIdentityError) {
          throw new AccountPreflightError(
            error instanceof Error ? error.message : 'Trading identity could not be verified. Margin was not changed.',
          );
        }
        throw new AccountMutationStatusUnknownError('margin', error);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      qc.invalidateQueries({ queryKey: ['hl', 'activeAsset'] });
      setMarginTargetCoin(null);
    },
    onError: (e: unknown) => {
      if (e instanceof AccountPreflightError) {
        Alert.alert('Margin not changed', e.message);
        return;
      }
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      qc.invalidateQueries({ queryKey: ['hl', 'activeAsset'] });
      Alert.alert(
        'Margin status unknown',
        `${e instanceof Error ? e.message : 'The exchange response was not confirmed.'}\n\nThe isolated margin may already have changed. Refresh the live position before trying again.`,
      );
    },
  });

  const tpSlMutation = useMutation({
    mutationFn: async ({ p, legs, identity }: {
      p: HlPosition;
      legs: TpSlLegInput[];
      identity: SignedTradingIdentityBinding;
    }) => {
      const assertIdentityCurrent = () =>
        assertTradingIdentityCurrent(identity, useHlConnection.getState());
      try {
        assertIdentityCurrent();
      } catch (error) {
        throw new ProtectionPreflightError(error instanceof Error ? error.message : 'Trading identity changed.');
      }
      const mInfo = meta?.[p.coin];
      if (!mInfo) throw new ProtectionPreflightError(`No market metadata for ${p.coin}. No orders were sent.`);
      const firstLeg = legs[0];
      if (!firstLeg) throw new ProtectionPreflightError('Choose a take-profit or stop-loss first. No orders were sent.');
      if (
        !(firstLeg.size > 0) ||
        legs.some((leg) => Math.abs(leg.size - firstLeg.size) > 1e-10)
      ) {
        throw new ProtectionPreflightError('TP and SL must protect the same non-zero size. No orders were sent.');
      }
      // The account screen already refreshes the position every five seconds. Do
      // the authoritative network check once, at the signing boundary, so a slow
      // duplicate preflight cannot make an otherwise valid TP/SL action time out.
      const validateImmediatelyBeforeSigning = async () => {
        let latestAccount;
        try {
          latestAccount = await fetchHlAccount(identity.accountAddress, identity.network);
        } catch (error) {
          throw new ProtectionPreflightError(
            `Could not perform the final live TP/SL check; no orders were sent: ${
              error instanceof Error ? error.message : 'network error'
            }`,
          );
        }
        const finalPosition = latestAccount.positions.find(
          (position) => position.coin === p.coin,
        );
        const protectedSizeWire = sizeToWire(firstLeg.size, mInfo.szDecimals);
        if (
          !finalPosition ||
          finalPosition.side !== p.side ||
          sizeToWire(finalPosition.size, mInfo.szDecimals) !==
            sizeToWire(p.size, mInfo.szDecimals) ||
          Number(protectedSizeWire) <= 0 ||
          Number(protectedSizeWire) >
            Number(sizeToWire(finalPosition.size, mInfo.szDecimals)) ||
          legs.some(
            (leg) => sizeToWire(leg.size, mInfo.szDecimals) !== protectedSizeWire,
          )
        ) {
          throw new ProtectionPreflightError(
            'The live position or protected size changed at the signing boundary. No TP/SL orders were sent.',
          );
        }
        const finalMark = finalPosition.markPx;
        const invalidLeg = legs.find((leg) => {
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
        if (!(finalMark > 0) || !Number.isFinite(finalMark) || invalidLeg) {
          throw new ProtectionPreflightError(
            'The mark moved past a reviewed TP/SL trigger at the signing boundary. No orders were sent.',
          );
        }
      };
      let postAttempted = false;
      try {
        return await placePositionTpSl({
          recoveryCoin: p.coin,
          network: identity.network,
          identity,
          validateImmediatelyBeforeSigning,
          assertIdentityCurrent,
          assetIndex: mInfo.assetIndex,
          szDecimals: mInfo.szDecimals,
          positionIsLong: p.side === 'long',
          size: firstLeg.size,
          legs: legs.map(({ tpsl, triggerPx, isMarket, limitPx }) => ({
            tpsl,
            triggerPx,
            isMarket,
            limitPx,
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
    onSuccess: (results, { p, legs }) => {
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      setTpSlTargetCoin(null);
      const rows = legs.map((leg, index) => {
        const name = leg.tpsl === 'tp' ? 'Take profit' : 'Stop loss';
        return `${name}: ${protectionAckLabel(results[index])}`;
      });
      const unconfirmed = legs.filter(
        (_leg, index) => !protectionAckIsAccepted(results[index]),
      );
      const anyAccepted = legs.some((_leg, index) => protectionAckIsAccepted(results[index]));
      const stopUnconfirmed = unconfirmed.some((leg) => leg.tpsl === 'sl');
      Alert.alert(
        unconfirmed.length === 0
          ? 'TP/SL acknowledged'
          : anyAccepted
            ? 'TP/SL partially accepted'
            : 'TP/SL not confirmed',
        `${rows.join('\n')}\n\n${
          stopUnconfirmed
            ? `Your stop loss is not confirmed; treat ${cleanCoin(p.coin)} as unprotected. `
            : ''
        }Verify the live orders under Open Orders before relying on protection.${
          unconfirmed.length > 0 ? ' Do not blindly retry the full batch.' : ''
        }`,
      );
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : 'Unknown error';
      if (e instanceof OrderRejectedError) {
        Alert.alert('TP/SL rejected', message);
        return;
      }
      if (e instanceof ProtectionPreflightError) {
        Alert.alert('TP/SL not sent', message);
        return;
      }
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      setTpSlTargetCoin(null);
      Alert.alert(
        'TP/SL status unknown',
        `${message}\n\nThe exchange acknowledgement could not be confirmed. Review Open Orders and the live position before submitting anything again.`,
      );
    },
  });

  const showTradingUnavailable = useCallback(() => {
    Alert.alert(
      'Position is read-only',
      demo
        ? 'This public demo portfolio can be inspected, including its chart and TP/SL protection, but it cannot be changed.'
        : hasKey
          ? 'The stored API wallet is not verified for this account. No action can be sent until the signer identity is valid.'
          : 'Viewing this portfolio does not require a key. Closing, reversing, or changing TP/SL requires an authorized API-wallet signer for this account.',
    );
  }, [demo, hasKey]);

  const confirmMarketClose = useCallback(
    (p: HlPosition) => {
      if (!tradable || !executionIdentity) {
        showTradingUnavailable();
        return;
      }
      const identity = executionIdentity;
      const symbol = instrumentForCoin(p.coin)?.symbol ?? cleanCoin(p.coin);
      Alert.alert(
        `Market close ${symbol}?`,
        `Close your ${p.side} ${qty(p.size)} ${symbol} with a reduce-only market IOC.` +
          (identity.network === 'mainnet'
            ? '\n\nThis uses real funds on mainnet.'
            : '\n\nTestnet order.'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Close position',
            style: 'destructive',
            onPress: () =>
              positionActionMutation.mutate({ action: 'close', position: p, identity }),
          },
        ],
      );
    },
    [executionIdentity, instrumentForCoin, positionActionMutation, showTradingUnavailable, tradable],
  );

  const confirmReverse = useCallback(
    (p: HlPosition) => {
      if (!tradable || !executionIdentity) {
        showTradingUnavailable();
        return;
      }
      const identity = executionIdentity;
      const symbol = instrumentForCoin(p.coin)?.symbol ?? cleanCoin(p.coin);
      const targetSide = p.side === 'long' ? 'short' : 'long';
      Alert.alert(
        `Reverse ${symbol}?`,
        `Close your ${p.side} ${qty(p.size)} ${symbol} and open an equal ${targetSide} with one market order for ${qty(
          p.size * 2,
        )} ${symbol}. A partial fill can leave you smaller, flat, or only partly reversed.` +
          (identity.network === 'mainnet'
            ? '\n\nThis uses real funds on mainnet.'
            : '\n\nTestnet order.'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reverse position',
            style: 'destructive',
            onPress: () =>
              positionActionMutation.mutate({ action: 'reverse', position: p, identity }),
          },
        ],
      );
    },
    [executionIdentity, instrumentForCoin, positionActionMutation, showTradingUnavailable, tradable],
  );

  const confirmCancel = useCallback(
    (o: HlOpenOrder) => {
      if (!tradable || !executionIdentity) return;
      const identity = executionIdentity;
      const instrument = instrumentForCoin(o.coin);
      const sym = symbolForCoin(o.coin);
      const dec = displayPriceDecimals(o.coin, instrument, o.limitPx);
      Alert.alert(
        'Cancel order?',
        `Cancel your ${o.side} ${qty(o.size)} ${sym} @ $${formatPrice(o.limitPx, dec)}` +
          (network === 'mainnet' ? '.' : ' (testnet).'),
        [
          { text: 'Keep', style: 'cancel' },
          {
            text: 'Cancel order',
            style: 'destructive',
            onPress: () => cancelMutation.mutate({ o, identity }),
          },
        ],
      );
    },
    [executionIdentity, tradable, network, cancelMutation, instrumentForCoin, symbolForCoin],
  );

  const confirmAdjustMargin = useCallback(
    (p: HlPosition, signedUsd: number) => {
      if (!tradable || !executionIdentity || signedUsd === 0) return;
      const identity = executionIdentity;
      const sym = cleanCoin(p.coin);
      const add = signedUsd > 0;
      const dec = priceDecimalsFor(instrumentForCoin(p.coin)?.priceDecimals ?? 6, p.markPx);
      const distance = positionLiquidationDistancePct(p);
      const liquidation =
        p.liquidationPx != null && p.liquidationPx > 0
          ? `$${formatPrice(p.liquidationPx, dec)}`
          : 'unavailable';
      const riskReview =
        `Current mark: $${formatPrice(p.markPx, dec)}\n` +
        `Current liquidation: ${liquidation}\n` +
        `Current distance: ${distance == null ? 'unavailable' : `${distance.toFixed(2)}%`}`;
      Alert.alert(
        add ? `Add margin to ${sym}?` : `Remove margin and increase ${sym} liquidation risk?`,
        add
          ? `Add ${usd(Math.abs(signedUsd))} to your ${sym} isolated margin.\n\n${riskReview}\n\nThe exchange will recalculate liquidation after acceptance.` +
              (network === 'mainnet' ? '\n\nThis uses real funds on mainnet.' : '\n\nTestnet action.')
          : `Remove ${usd(Math.abs(signedUsd))} from your ${sym} isolated margin.\n\n${riskReview}\n\nThe post-removal liquidation price is unknown until Hyperliquid accepts and recalculates it. It will move closer to the mark. Review the live position immediately after submitting.` +
              (network === 'mainnet' ? '\n\nThis uses real funds on mainnet.' : '\n\nTestnet action.'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: add ? 'Add margin' : 'Remove anyway',
            style: add ? 'default' : 'destructive',
            onPress: () => marginMutation.mutate({ p, signedUsd, identity }),
          },
        ],
      );
    },
    [executionIdentity, instrumentForCoin, marginMutation, network, tradable],
  );

  const confirmTpSl = useCallback(
    (p: HlPosition, legs: TpSlLegInput[]) => {
      if (!tradable || !executionIdentity || legs.length === 0) return;
      const identity = executionIdentity;
      const sym = cleanCoin(p.coin);
      const dec = priceDecimalsFor(instrumentForCoin(p.coin)?.priceDecimals ?? 6, p.markPx);
      const selected = legs[0];
      if (!selected) return;
      const lines = legs
        .map(
          (l) =>
            `${l.tpsl === 'tp' ? 'Take profit' : 'Stop loss'} @ $${formatPrice(l.triggerPx, dec)} · ${l.isMarket ? 'market exit' : 'limit at trigger'}`,
        )
        .join('\n');
      Alert.alert(
        `Set TP/SL on ${sym}?`,
        `${lines}\n\nReduce-only for ${selected.closePct}% (${qty(selected.size)} ${sym}) of your ${p.side} position.` +
          (network === 'mainnet' ? '\n\nThis uses real funds on mainnet.' : '\n\nTestnet order.'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Set orders',
            onPress: () => tpSlMutation.mutate({ p, legs, identity }),
          },
        ],
      );
    },
    [executionIdentity, instrumentForCoin, network, tpSlMutation, tradable],
  );

  const openChart = useCallback(
    (coin: string) => {
      const i = instrumentForCoin(coin);
      if (i) router.push({ pathname: '/symbol/[id]', params: { id: i.id } });
    },
    [instrumentForCoin, router],
  );

  const toggleExpand = useCallback((coin: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(coin)) next.delete(coin);
      else next.add(coin);
      return next;
    });
  }, []);

  const sortedPositions = useMemo(
    () => (account ? [...account.positions].sort((a, b) => b.positionValue - a.positionValue) : []),
    [account],
  );

  // Spot balances, optionally hiding sub-$1 dust (e.g. leftover token amounts).
  const visibleBalances = useMemo(
    () =>
      (account?.spotBalances ?? []).filter(
        (b) => !hideSmallBalances || b.priceKnown !== true || Math.abs(b.usdValue) >= SMALL_BALANCE_USD,
      ),
    [account, hideSmallBalances],
  );

  const riskSummary = useMemo(
    () => (account ? buildAccountRiskSummary(account, openOrders ?? []) : null),
    [account, openOrders],
  );
  const positionProtectionByCoin = useMemo(() => {
    const levels = new Map<string, PositionProtectionLevels>();
    for (const position of account?.positions ?? []) {
      levels.set(position.coin, protectionLevelsForPosition(position, openOrders ?? []));
    }
    return levels;
  }, [account?.positions, openOrders]);
  const existingTpSlOrders: TpSlExistingOrder[] = (() => {
    if (!tpSlTarget) return [];
    const closingSide = tpSlTarget.side === 'long' ? 'sell' : 'buy';
    return (openOrders ?? [])
      .filter(
        (order) =>
          order.coin === tpSlTarget.coin &&
          order.side === closingSide &&
          order.reduceOnly &&
          order.isTrigger &&
          (order.triggerPx ?? order.limitPx) > 0,
      )
      .map((order) => ({
        id: order.oid,
        tpsl: isProtectiveStop(order, tpSlTarget) ? 'sl' : 'tp',
        triggerPx: order.triggerPx ?? order.limitPx,
        size: order.size,
        isMarket: /market/i.test(order.orderType),
      }));
  })();

  // ---- Not connected: connect CTA + demo preview ----
  if (!address) {
    return (
      <Screen>
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="wallet-outline" size={34} color={Colors.textMuted} />
          </View>
          <AppText variant="heading" style={styles.emptyTitle}>
            Connect your account
          </AppText>
          <AppText variant="body" muted style={styles.emptyBody}>
            Link your Hyperliquid account to see balances and positions, and to trade from the app.
          </AppText>
          <Pressable style={styles.primaryBtn} onPress={() => router.navigate('/settings')}>
            <Ionicons name="link" size={16} color={Colors.background} />
            <AppText variant="label" color={Colors.background}>Connect in Settings</AppText>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => connectDemo(DEMO_ADDRESS)} style={styles.demoLink}>
            <AppText variant="label" color={Colors.accent}>
              Preview a demo account
            </AppText>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if ((isLoading || identityQuery.isPending) && !account) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      </Screen>
    );
  }

  if (!account) {
    return (
      <Screen>
        <View style={styles.center}>
          <OrderRecoveryNotice network={network} address={tradingIdentity?.accountAddress} />
          <AppText muted>{identityQuery.isError ? 'Couldn’t verify account identity' : 'Couldn’t load account'}</AppText>
          <Pressable
            style={styles.retryBtn}
            onPress={() => { void (identityQuery.isError ? identityQuery.refetch() : refetch()); }}
            disabled={isFetching}
            accessibilityState={{ disabled: isFetching, busy: isFetching }}>
            {isFetching ? (
              <ActivityIndicator size="small" color={Colors.accent} />
            ) : (
              <AppText variant="label" color={Colors.accent}>
                Retry
              </AppText>
            )}
          </Pressable>
        </View>
      </Screen>
    );
  }

  const pnlColor = account.unrealizedPnl >= 0 ? Colors.up : Colors.down;
  const shownAddress = tradingIdentity?.accountAddress ?? address;
  const shownMode = shortAccountMode(account.abstractionMode);
  const equityLabel = account.abstractionMode === 'standard' || account.abstractionMode === 'dexAbstraction' ? 'Tracked equity' : 'Account equity';
  const rate = (value: number | null | undefined) => value == null ? '—' : mask(`${(value * 100).toFixed(4)}%`);
  const money = (value: number | null | undefined) => value == null ? '—' : mask(`${value < 0 ? '−' : ''}${usd(value)}`);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {demo ? (
          <View style={styles.demoBanner}>
            <Ionicons name="eye-outline" size={13} color={Colors.warning} />
            <AppText variant="caption" color={Colors.warning}>
              Read-only demo account
            </AppText>
          </View>
        ) : null}

        <OrderRecoveryNotice network={network} address={tradingIdentity?.accountAddress} />
        <AccountReadStatus label="account" query={accountQuery} freshForMs={15_000} />

        <View style={styles.balanceCard}>
          <View style={styles.balanceLabelRow}>
            <AppText style={styles.portfolioTitle}>Portfolio</AppText>
            <View style={styles.overviewActions}>
              <Pressable hitSlop={12} onPress={() => setPrivacyMode(!privacyMode)} accessibilityLabel={privacyMode ? 'Show balances' : 'Hide balances'}><Ionicons name={privacyMode ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.textMuted} /></Pressable>
              <Pressable hitSlop={12} onPress={() => { void refetch(); void feesQuery.refetch(); void earnQuery.refetch(); }} accessibilityLabel="Refresh portfolio" disabled={isFetching}><Ionicons name="refresh-outline" size={18} color={Colors.textMuted} /></Pressable>
              <Pressable hitSlop={12} onPress={() => router.push('/settings')} accessibilityLabel="Account settings"><Ionicons name="settings-outline" size={18} color={Colors.textMuted} /></Pressable>
            </View>
          </View>
          <AppText variant="caption" muted style={styles.accountAddress}>{privacyMode ? MASK : shownAddress ? `${shownAddress.slice(0, 6)}…${shownAddress.slice(-4)}` : '—'} · {shownMode}{network === 'testnet' ? ' · Testnet' : ''}</AppText>
          <AppText variant="caption" muted style={styles.equityLabel}>{equityLabel}</AppText>
          <AppText numeric style={styles.equity} numberOfLines={1} adjustsFontSizeToFit>{account.totalEquityLoaded !== true ? '—' : money(account.totalEquity)}</AppText>
          {account.totalEquityLoaded !== true ? <AppText variant="caption" color={Colors.warning}>Some balances or valuations are unavailable.</AppText> : null}
          <View style={styles.overviewMetrics}>
            <OverviewMetric label="Unrealized PNL" value={mask(signedUsd(account.unrealizedPnl))} color={pnlColor} />
            <OverviewMetric label="Available collateral" value={money(account.totalEquityLoaded !== true ? null : account.freeCollateral)} />
          </View>
          {equityLabel === 'Tracked equity' ? <AppText variant="caption" color={Colors.textFaint} style={styles.coverageNote}>Equity tracks default and XYZ perps, spot balances and vaults.</AppText> : null}
        </View>
        <View style={styles.portfolioWrap}><PortfolioCard hidden={privacyMode} /></View>
        <View style={styles.accountDetails}>
          <DetailRow label="USDC Earn · supplied" value={money(earnQuery.data?.suppliedUsdc)} />
          <DetailRow label="14D reported volume" value={money(feesQuery.data?.volume14d)} />
          <DetailRow label="Perp fees · maker / taker" value={`${rate(feesQuery.data?.makerRate)} / ${rate(feesQuery.data?.takerRate)}`} />
          {earnQuery.isError || feesQuery.isError ? <AppText variant="caption" color={Colors.warning}>Some account details could not refresh.</AppText> : null}
        </View>

        {/* Current account risk follows the account-value history. */}
        {openOrders !== undefined ? <RiskStrip summary={riskSummary!} hidden={privacyMode} /> : (
          <View style={styles.readStatus}>
            <AppText variant="caption" muted>Position protection is unavailable until open orders load.</AppText>
          </View>
        )}
        {openOrders !== undefined && ordersQuery.isError ? <AccountReadStatus label="position protection and orders" query={ordersQuery} freshForMs={20_000} /> : null}

        {/* Positions / Orders / Balances / History tabs */}
        <View style={styles.tabBarWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBar}>
            <TabButton
              label="Balances"
              count={account.spotBalancesLoaded ? visibleBalances.length : undefined}
              active={tab === 'balances'}
              onPress={() => setTab('balances')}
            />
            <TabButton
              label="Positions"
              count={account.positions.length}
              active={tab === 'positions'}
              onPress={() => setTab('positions')}
            />
            <TabButton
              label="Open orders"
              count={openOrders?.length}
              active={tab === 'orders'}
              onPress={() => setTab('orders')}
            />
            <TabButton
              label="Trade history"
              count={fills?.length}
              active={tab === 'history'}
              onPress={() => setTab('history')}
            />
            <TabButton
              label="Funding"
              count={fundingHistory?.length}
              active={tab === 'funding'}
              onPress={() => setTab('funding')}
            />
            <TabButton
              label="Interest"
              count={interestHistory?.length}
              active={tab === 'interest'}
              onPress={() => setTab('interest')}
            />
            <TabButton label="Order history" count={historicalOrdersQuery.data?.length} active={tab === 'orderHistory'} onPress={() => setTab('orderHistory')} />
            <TabButton label="Transfers" count={activityQuery.data?.rows.length} active={tab === 'transfers'} onPress={() => setTab('transfers')} />
          </ScrollView>
        </View>

        {tab === 'positions' ? (
          sortedPositions.length === 0 ? (
            <View style={styles.noPositions}>
              <AppText variant="body" muted>
                No open positions
              </AppText>
            </View>
          ) : (
            <View style={styles.list}>
              {sortedPositions.map((p) => (
                <PositionCard
                  key={p.coin}
                  p={p}
                  instrument={instrumentForCoin(p.coin)}
                  protection={positionProtectionByCoin.get(p.coin)}
                  expanded={expanded.has(`position:${p.coin}`)}
                  busy={
                    positionActionMutation.isPending &&
                    positionActionMutation.variables?.position.coin === p.coin
                  }
                  hidden={privacyMode}
                  onToggle={() => toggleExpand(`position:${p.coin}`)}
                  onChart={() => openChart(p.coin)}
                  onLimitClose={() => setLimitCloseTargetCoin(p.coin)}
                  onMarketClose={() => confirmMarketClose(p)}
                  onReverse={() => confirmReverse(p)}
                  onAdjustMargin={() => setMarginTargetCoin(p.coin)}
                  onSetTpSl={() => setTpSlTargetCoin(p.coin)}
                />
              ))}
            </View>
          )
        ) : tab === 'orders' ? (
          <>
          <AccountReadStatus label="open orders" query={ordersQuery} freshForMs={20_000} />
          {openOrders === undefined ? null : openOrders.length === 0 ? (
            <View style={styles.noPositions}>
              <AppText variant="body" muted>
                No open orders
              </AppText>
            </View>
          ) : (
            <View style={styles.list}>
              {openOrders.map((o) => (
                <OrderCard
                  key={o.oid}
                  o={o}
                  instrument={instrumentForCoin(o.coin)}
                  symbol={symbolForCoin(o.coin)}
                  tradable={tradable}
                  busy={cancelMutation.isPending && cancelMutation.variables?.o.oid === o.oid}
                  hidden={privacyMode}
                  onCancel={() => confirmCancel(o)}
                />
              ))}
            </View>
          )}
          </>
        ) : tab === 'balances' ? (
          account.spotBalancesLoaded === false ? <HistoryError label="balances" detail={account.spotBalancesError ?? undefined} onRetry={() => { void refetch(); }} /> : visibleBalances.length > 0 ? (
            <View style={styles.list}>
              {visibleBalances.map((b) => (
                <SpotCard
                  key={b.coin}
                  b={b}
                  instrument={instrumentForCoin(b.coin)}
                  symbol={symbolForCoin(b.coin)}
                  expanded={expanded.has('spot:' + b.coin)}
                  hidden={privacyMode}
                  onToggle={() => toggleExpand('spot:' + b.coin)}
                  onChart={() => openChart(b.coin)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.noPositions}>
              <AppText variant="body" muted>
                {hideSmallBalances ? 'No balances over $' + SMALL_BALANCE_USD : 'No spot balances'}
              </AppText>
            </View>
          )
        ) : tab === 'history' ? (
          <>
          <AccountReadStatus label="trade history" query={fillsQuery} freshForMs={45_000} />
          {fills === undefined ? null : fills.length === 0 ? (
            <View style={styles.noPositions}>
              <AppText variant="body" muted>
                No trade history
              </AppText>
            </View>
          ) : (
            <View style={styles.list}>
              {fills.map((f) => (
                <FillCard
                  key={f.key}
                  f={f}
                  instrument={instrumentForCoin(f.coin)}
                  symbol={symbolForCoin(f.coin)}
                  hidden={privacyMode}
                  expanded={expanded.has('fill:' + f.key)}
                  onToggle={() => toggleExpand('fill:' + f.key)}
                />
              ))}
            </View>
          )}
          </>
        ) : tab === 'funding' ? (
          fundingHistoryLoading && !fundingHistory ? (
            <HistoryLoading />
          ) : fundingHistoryError ? (
            <HistoryError label="funding history" onRetry={() => refetchFundingHistory()} />
          ) : (fundingHistory?.length ?? 0) === 0 ? (
            <HistoryEmpty
              title="No recent funding payments"
              detail="Funding settlements appear here after a perp position crosses an hourly interval."
            />
          ) : (
            <View style={styles.historyList}>
              <HistoryIntro
                icon="swap-vertical-outline"
                title="Funding history"
                detail="Positive payments were received; negative payments were paid."
              />
              {fundingHistory!.map((row) => (
                <FundingHistoryCard key={row.key} row={row} hidden={privacyMode} />
              ))}
            </View>
          )
        ) : tab === 'orderHistory' ? (
          <>
            <AccountReadStatus label="order history" query={historicalOrdersQuery} freshForMs={60_000} />
            {historicalOrdersQuery.data?.length === 0 ? <HistoryEmpty title="No recent orders" detail="Final order states appear here after an order changes status." /> : historicalOrdersQuery.data?.slice(0, 100).map((order) => (
              <View key={`${order.oid}:${order.statusTimestamp}`} style={styles.ledgerRow}>
                <View style={styles.ledgerCopy}><AppText style={styles.symbol}>{symbolForCoin(order.coin)} <AppText variant="caption" color={order.side === 'buy' ? Colors.up : Colors.down}>{order.side === 'buy' ? 'Buy' : 'Sell'}</AppText></AppText><AppText variant="caption" muted>{order.orderType} · {fullWhen(order.statusTimestamp)}</AppText></View>
                <View style={styles.ledgerValue}><AppText variant="label">{order.status.replace(/([a-z])([A-Z])/g, '$1 $2')}</AppText><AppText variant="caption" muted numeric>{mask(qty(order.origSize))} @ {formatPrice(order.limitPx)}</AppText></View>
              </View>
            ))}
          </>
        ) : tab === 'transfers' ? (
          <>
            <AccountReadStatus label="transfers" query={activityQuery} freshForMs={120_000} />
            <AppText variant="caption" muted style={styles.ledgerNote}>{activityQuery.data?.limited ? 'Partial 90-day history; the read limit was reached.' : 'Up to 100 recent records from the last 90 days.'} Transfers are separate from PNL.</AppText>
            {activityQuery.data?.rows.length === 0 ? <HistoryEmpty title="No recent transfers" detail="Deposits, withdrawals and wallet activity appear here." /> : activityQuery.data?.rows.map((row) => (
              <View key={row.key} style={styles.ledgerRow}>
                <View style={styles.ledgerCopy}><AppText style={styles.symbol}>{row.label}</AppText><AppText variant="caption" muted>{fullWhen(row.timestamp)}</AppText></View>
                <View style={styles.ledgerValue}><AppText numeric variant="label" color={row.flow === 'in' ? Colors.up : row.flow === 'out' ? Colors.down : Colors.text}>{row.amount == null ? '—' : mask(`${row.flow === 'out' ? '−' : row.flow === 'in' ? '+' : ''}${tokenAmt(Math.abs(row.amount))}`)}{row.token ? ` ${row.token}` : ''}</AppText><AppText variant="caption" muted>{row.flow === 'internal' ? 'Internal' : row.flow === 'in' ? 'Received' : row.flow === 'out' ? 'Sent' : 'Activity'}</AppText></View>
              </View>
            ))}
          </>
        ) : interestHistoryLoading && !interestHistory ? (
          <HistoryLoading />
        ) : interestHistoryError ? (
          <HistoryError label="interest history" onRetry={() => refetchInterestHistory()} />
        ) : (interestHistory?.length ?? 0) === 0 ? (
          <HistoryEmpty
            title="No interest history"
            detail="Portfolio-margin borrow charges and supply earnings will appear here each hour."
          />
        ) : (
          <View style={styles.historyList}>
            <HistoryIntro
              icon="time-outline"
              title="Interest history"
              detail="Borrow interest is paid; idle supplied balances can earn interest."
            />
            {interestHistory!.map((row) => (
              <InterestHistoryCard key={row.key} row={row} hidden={privacyMode} />
            ))}
          </View>
        )}

        {demo ? (
          <AppText variant="caption" muted style={styles.disclaimer}>
            Demo address — connect your own account in Settings to trade.
          </AppText>
        ) : null}
      </ScrollView>

      {/* A reduce-only limit close uses the same fully validated ticket as chart trading. */}
      {limitCloseTarget ? (
        <TradeTicket
          key={`${limitCloseTarget.coin}-${limitCloseTarget.side}-${limitCloseTarget.size}-limit-close`}
          visible
          onClose={() => setLimitCloseTargetCoin(null)}
          coin={limitCloseTarget.coin}
          symbol={
            instrumentForCoin(limitCloseTarget.coin)?.symbol ?? cleanCoin(limitCloseTarget.coin)
          }
          markPx={limitCloseTarget.markPx}
          executionMidPx={limitCloseTarget.markPx}
          priceDecimals={priceDecimalsFor(
            instrumentForCoin(limitCloseTarget.coin)?.priceDecimals ?? 6,
            limitCloseTarget.markPx,
          )}
          initialSide={limitCloseTarget.side === 'short' ? 'buy' : 'sell'}
          initialType="limit"
          initialSizeCoin={limitCloseTarget.size}
          closing
          lockSide
          title={`Limit close ${limitCloseTarget.side} ${
            instrumentForCoin(limitCloseTarget.coin)?.symbol ?? cleanCoin(limitCloseTarget.coin)
          }`}
          actionLabel="Close"
        />
      ) : null}

      {/* Set take-profit / stop-loss on an open position (reduce-only market triggers).
          Keyed per coin so each open mounts fresh — no price carries across positions. */}
      <TpSlSheet
        key={
          tpSlTarget ? `${tpSlTarget.coin}-${tpSlTarget.side}-tpsl` : 'tpsl-closed'
        }
        visible={tpSlTarget !== null}
        onClose={() => setTpSlTargetCoin(null)}
        symbol={
          tpSlTarget
            ? instrumentForCoin(tpSlTarget.coin)?.symbol ?? cleanCoin(tpSlTarget.coin)
            : ''
        }
        side={tpSlTarget?.side ?? 'long'}
        size={tpSlTarget?.size ?? 0}
        entryPx={tpSlTarget?.entryPx ?? 0}
        markPx={tpSlTarget?.markPx ?? 0}
        leverage={tpSlTarget?.leverage ?? 1}
        szDecimals={tpSlTarget ? (meta?.[tpSlTarget.coin]?.szDecimals ?? 8) : 8}
        priceDecimals={
          tpSlTarget
            ? priceDecimalsFor(instrumentForCoin(tpSlTarget.coin)?.priceDecimals ?? 6, tpSlTarget.markPx)
            : 2
        }
        tradable={tradable}
        busy={tpSlMutation.isPending}
        allowPartial
        existingOrders={existingTpSlOrders}
        onCancelExisting={(id) => {
          const order = openOrders?.find((item) => item.oid === Number(id));
          if (order) confirmCancel(order);
        }}
        cancelBusyId={cancelMutation.isPending ? cancelMutation.variables?.o.oid : null}
        onSubmit={(legs) => {
          if (tpSlTarget) confirmTpSl(tpSlTarget, legs);
        }}
      />

      {/* Add / remove isolated margin on a position. */}
      <MarginSheet
        key={marginTarget ? `${marginTarget.coin}-margin` : 'margin-closed'}
        visible={marginTarget !== null}
        symbol={
          marginTarget
            ? instrumentForCoin(marginTarget.coin)?.symbol ?? cleanCoin(marginTarget.coin)
            : ''
        }
        marginUsed={marginTarget?.marginUsed ?? 0}
        removalSafetyLimit={
          marginTarget &&
          meta?.[marginTarget.coin] &&
          meta[marginTarget.coin].marginMode !== 'strictIsolated'
            ? isolatedMarginRemovalSafetyLimit(marginTarget)
            : 0
        }
        removalAllowed={
          marginTarget ? meta?.[marginTarget.coin]?.marginMode !== 'strictIsolated' : false
        }
        available={account.freeCollateral}
        side={marginTarget?.side ?? 'long'}
        markPx={marginTarget?.markPx ?? 0}
        liquidationPx={marginTarget?.liquidationPx ?? null}
        positionValue={marginTarget?.positionValue ?? 0}
        leverage={marginTarget?.leverage ?? 1}
        priceDecimals={
          marginTarget
            ? priceDecimalsFor(
                instrumentForCoin(marginTarget.coin)?.priceDecimals ?? 6,
                marginTarget.markPx,
              )
            : 2
        }
        tradable={tradable}
        busy={marginMutation.isPending}
        onClose={() => setMarginTargetCoin(null)}
        onSubmit={(signed) => {
          if (marginTarget) confirmAdjustMargin(marginTarget, signed);
        }}
      />
    </Screen>
  );
}

function OverviewMetric({ label, value, color, note }: { label: string; value: string; color?: string; note?: string }) {
  return <View style={styles.overviewMetric}><AppText variant="caption" muted>{label}</AppText><AppText numeric style={styles.overviewValue} color={color} numberOfLines={1} adjustsFontSizeToFit>{value}</AppText>{note ? <AppText style={styles.overviewNote} color={Colors.textFaint}>{note}</AppText> : null}</View>;
}

const MAINTENANCE_WARNING_PCT = 50;
const MAINTENANCE_URGENT_PCT = 75;
const LIQUIDATION_WARNING_PCT = 20;
const LIQUIDATION_URGENT_PCT = 10;
const LEVERAGE_WARNING = 5;

function RiskStrip({
  summary,
  hidden,
}: {
  summary: AccountRiskSummary;
  hidden: boolean;
}) {
  const maintenance = summary.maintenanceUsagePct;
  const maintenanceUrgent = maintenance != null && maintenance >= MAINTENANCE_URGENT_PCT;
  const maintenanceWarning = maintenance != null && maintenance >= MAINTENANCE_WARNING_PCT;
  const liquidation = summary.closestLiquidation;
  const liquidationUrgent =
    liquidation != null && liquidation.distancePct <= LIQUIDATION_URGENT_PCT;
  const liquidationWarning =
    liquidation != null && liquidation.distancePct <= LIQUIDATION_WARNING_PCT;
  const mask = (value: string) => (hidden ? MASK : value);

  return (
    <View style={styles.riskCard}>
      <View style={styles.riskMetrics}>
        <RiskMetric label="Margin usage" value={maintenance == null ? '—' : mask(`${maintenance.toFixed(1)}%`)} color={maintenanceUrgent ? Colors.down : maintenanceWarning ? Colors.warning : undefined} />
        <RiskMetric label="Leverage" value={summary.effectiveLeverage == null ? '—' : mask(`${summary.effectiveLeverage.toFixed(1)}×`)} />
        <RiskMetric label="Closest liq." value={liquidation ? mask(`${liquidation.distancePct.toFixed(1)}%`) : '—'} sub={liquidation ? (hidden ? MASK : cleanCoin(liquidation.coin)) : undefined} color={liquidationUrgent ? Colors.down : liquidationWarning ? Colors.warning : undefined} />
      </View>

      {maintenanceWarning ? (
        <RiskWarning
          urgent={maintenanceUrgent}
          text={
            hidden
              ? 'Maintenance usage is elevated.'
              : `Maintenance uses ${maintenance!.toFixed(1)}% of perp equity${maintenanceUrgent ? ' — liquidation risk is high.' : '.'}`
          }
        />
      ) : null}
      {liquidationWarning ? (
        <RiskWarning
          urgent={liquidationUrgent}
          text={
            hidden
              ? 'A position is close to liquidation.'
              : `${cleanCoin(liquidation!.coin)} is ${liquidation!.distancePct.toFixed(1)}% from liquidation.`
          }
        />
      ) : null}
      {(summary.effectiveLeverage ?? 0) >= LEVERAGE_WARNING ? (
        <RiskWarning
          text={
            hidden
              ? 'Gross account leverage is elevated.'
              : `Gross exposure is ${summary.effectiveLeverage!.toFixed(1)}× perp equity.`
          }
        />
      ) : null}
    </View>
  );
}

function RiskMetric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <View style={styles.riskMetric}>
      <AppText variant="caption" muted numberOfLines={1}>
        {label}
      </AppText>
      <AppText
        numeric
        color={color}
        numberOfLines={1}
        style={styles.riskMetricValue}>
        {value}
      </AppText>
      {sub ? (
        <AppText variant="caption" color={Colors.textFaint} numberOfLines={1}>
          {sub}
        </AppText>
      ) : null}
    </View>
  );
}

function RiskWarning({ text, urgent = false }: { text: string; urgent?: boolean }) {
  return (
    <View style={[styles.riskWarning, urgent && styles.riskWarningUrgent]}>
      <Ionicons
        name={urgent ? 'alert-circle' : 'warning'}
        size={13}
        color={urgent ? Colors.down : Colors.warning}
      />
      <AppText variant="caption" color={urgent ? Colors.down : Colors.warning} style={styles.riskWarningText}>
        {text}
      </AppText>
    </View>
  );
}

function TabButton({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <AppText variant="label" color={active ? Colors.text : Colors.textMuted}>
        {label}
      </AppText>
      {count != null ? (
        <View style={[styles.tabCount, active && styles.tabCountActive]}>
          <AppText variant="caption" color={active ? Colors.text : Colors.textFaint}>
            {count}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

// Memoized so a 5s account refetch only re-renders positions whose data actually
// changed (React Query structural-shares unchanged rows). The inline callbacks close
// over stable ids, so their identity is deliberately excluded from the comparison.
const PositionCard = memo(PositionCardImpl, (prev, next) =>
  prev.p === next.p &&
  prev.instrument?.id === next.instrument?.id &&
  prev.protection === next.protection &&
  prev.expanded === next.expanded &&
  prev.busy === next.busy &&
  prev.hidden === next.hidden,
);

function PositionCardImpl({
  p,
  instrument,
  protection,
  expanded,
  busy,
  hidden,
  onToggle,
  onChart,
  onLimitClose,
  onMarketClose,
  onReverse,
  onAdjustMargin,
  onSetTpSl,
}: {
  p: HlPosition;
  instrument: Instrument | undefined;
  protection: PositionProtectionLevels | undefined;
  expanded: boolean;
  busy: boolean;
  hidden: boolean;
  onToggle: () => void;
  onChart: () => void;
  onLimitClose: () => void;
  onMarketClose: () => void;
  onReverse: () => void;
  onAdjustMargin: () => void;
  onSetTpSl: () => void;
}) {
  const pnlColor = p.unrealizedPnl >= 0 ? Colors.up : Colors.down;
  const sideColor = p.side === 'long' ? Colors.up : Colors.down;
  const symbol = instrument?.symbol ?? cleanCoin(p.coin);
  const decimals = priceDecimalsFor(instrument?.priceDecimals ?? 6, p.markPx);
  const m = (s: string) => (hidden ? MASK : s);
  const tp = protection?.takeProfitPx;
  const sl = protection?.stopLossPx;
  const protectionLabel = hidden
    ? MASK
    : `${tp != null ? formatPrice(tp, decimals) : '—'} / ${
        sl != null ? formatPrice(sl, decimals) : '—'
      }`;

  return (
    <View style={styles.positionCard}>
      <View style={styles.positionBody}>
        <View style={styles.positionSummary}>
          <Pressable
            style={({ pressed }) => [
              styles.positionSummaryTapTarget,
              pressed && styles.positionSummaryPressed,
            ]}
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${symbol} position`}
            accessibilityState={{ expanded }}>
            <View style={[styles.positionSummaryCell, styles.positionMarketCell]}>
              <AppText style={styles.positionColumnLabel}>Market</AppText>
              <View style={styles.marketValueRow}>
                <AppText
                  style={[styles.positionSymbol, { color: sideColor }]}
                  numberOfLines={1}>
                  {symbol}
                </AppText>
                <View style={[styles.positionLeverageBadge, { backgroundColor: sideColor + '16' }]}>
                  <AppText style={[styles.positionLeverageText, { color: sideColor }]} numeric>
                    {p.leverage}×
                  </AppText>
                </View>
              </View>
            </View>
            <PositionMetric
              label="Size"
              value={m(`${qty(p.size)} ${symbol}`)}
              color={sideColor}
            />
            <View style={[styles.positionSummaryCell, styles.positionPnlCell]}>
              <AppText style={styles.positionColumnLabel}>PNL (ROE %)</AppText>
              <View style={styles.pnlValueRow}>
                {busy ? (
                  <ActivityIndicator size="small" color={Colors.textMuted} />
                ) : (
                  <View style={styles.positionPnlText}>
                    <AppText
                      numeric
                      color={pnlColor}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.78}
                      style={styles.positionPnlAmount}>
                      {m(signedUsd(p.unrealizedPnl))}
                    </AppText>
                    <AppText
                      numeric
                      color={pnlColor}
                      numberOfLines={1}
                      style={styles.positionRoeText}>
                      {m(formatPercent(p.roe * 100))}
                    </AppText>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
          <Pressable
            onPress={onChart}
            hitSlop={8}
            style={({ pressed }) => [
              styles.positionChartButton,
              pressed && styles.actionBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${symbol} chart`}>
            <Ionicons name="open-outline" size={15} color={Colors.accent} />
          </Pressable>
        </View>

        {expanded ? (
          <View style={styles.positionDetails}>
          <View style={styles.gridRow}>
            <Cell label="Entry Price" value={formatPrice(p.entryPx, decimals)} />
            <Cell label="Mark Price" value={formatPrice(p.markPx, decimals)} />
            <Cell
              label="Liq. Price"
              value={p.liquidationPx != null ? formatPrice(p.liquidationPx, decimals) : '—'}
              color={p.liquidationPx != null ? Colors.warning : undefined}
            />
          </View>
          <View style={styles.gridRow}>
            <Cell label="Position Value" value={m(`${formatPrice(p.positionValue, 2)} USDC`)} />
            <Cell
              label="Margin"
              value={m(`${usd(p.marginUsed)} (${p.leverageType === 'isolated' ? 'Isolated' : 'Cross'})`)}
              onEdit={p.leverageType === 'isolated' ? onAdjustMargin : undefined}
            />
            <Cell label="TP / SL" value={protectionLabel} onEdit={onSetTpSl} />
          </View>
          <View style={styles.gridRow}>
            <Cell
              label="Funding"
              value={m(signedUsd(p.funding))}
              color={p.funding > 0 ? Colors.up : p.funding < 0 ? Colors.down : undefined}
            />
            <View style={styles.cell} />
            <View style={styles.cell} />
          </View>
        </View>
      ) : null}

      </View>

      <View style={styles.positionDivider} />
      <View style={styles.positionActions}>
        <PositionQuickAction label="Limit Close" onPress={onLimitClose} disabled={busy} />
        <PositionQuickAction label="Market Close" onPress={onMarketClose} disabled={busy} />
        <PositionQuickAction label="Reverse" onPress={onReverse} disabled={busy} />
        <Pressable
          style={({ pressed }) => [styles.collapseAction, pressed && styles.actionBtnPressed]}
          onPress={onToggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse position' : 'Expand position'}>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={Colors.text}
          />
        </Pressable>
      </View>
    </View>
  );
}

function PositionMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.positionSummaryCell}>
      <AppText style={styles.positionColumnLabel}>{label}</AppText>
      <AppText
        numeric
        color={color}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.76}
        style={styles.positionPrimaryValue}>
        {value}
      </AppText>
    </View>
  );
}

function PositionQuickAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const color = disabled ? Colors.textFaint : Colors.accent;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.quickAction,
        pressed && !disabled && styles.actionBtnPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <AppText color={color} numberOfLines={1} style={styles.quickActionText}>
        {label}
      </AppText>
    </Pressable>
  );
}

function Cell({
  label,
  value,
  sub,
  color,
  onEdit,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  /** When set, the value becomes tappable and shows a pencil (e.g. adjust margin). */
  onEdit?: () => void;
}) {
  const valueRow = (
    <View style={styles.cellValueRow}>
      <AppText
        variant="label"
        numeric
        color={color}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        style={styles.cellValue}>
        {value}
      </AppText>
      {onEdit ? <Ionicons name="pencil" size={13} color={Colors.accent} /> : null}
    </View>
  );
  return (
    <View style={styles.cell}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      {onEdit ? (
        <Pressable onPress={onEdit} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Adjust ${label}`}>
          {valueRow}
        </Pressable>
      ) : (
        valueRow
      )}
      {sub ? (
        <AppText variant="caption" muted numberOfLines={1}>
          {sub}
        </AppText>
      ) : null}
    </View>
  );
}

const SpotCard = memo(SpotCardImpl, (prev, next) =>
  prev.b === next.b &&
  prev.instrument?.id === next.instrument?.id &&
  prev.symbol === next.symbol &&
  prev.expanded === next.expanded &&
  prev.hidden === next.hidden,
);

function SpotCardImpl({
  b,
  instrument,
  symbol,
  expanded,
  hidden,
  onToggle,
  onChart,
}: {
  b: HlSpotBalance;
  instrument: Instrument | undefined;
  symbol: string;
  expanded: boolean;
  hidden: boolean;
  onToggle: () => void;
  onChart: () => void;
}) {
  // Derived per-token price; USDC ≈ $1, others off the spot mid.
  const price = Math.abs(b.total) > 1e-9 ? b.usdValue / b.total : 0;
  const m = (s: string) => (hidden ? MASK : s);
  const coinAmt = (v: number) => `${tokenAmt(v)} ${symbol}`;
  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
        onPress={onToggle}>
        <SymbolLogo instrument={instrument} coin={b.coin} size={40} />
        <View style={styles.mid}>
          <AppText style={styles.symbol} numberOfLines={1}>
            {symbol}
          </AppText>
          {/* Collapsed: just the token amount — "available" lives in the detail so nothing truncates. */}
          <AppText style={styles.sub} numeric numberOfLines={1}>
            {hidden ? `${MASK} ${symbol}` : coinAmt(b.total)}
          </AppText>
        </View>
        <AppText
          style={[styles.spotValue, b.usdValue < 0 && styles.spotLiability]}
          numeric
          numberOfLines={1}>
          {b.priceKnown !== true ? '—' : m(`${b.usdValue < 0 ? '−' : ''}${usd(b.usdValue)}`)}
        </AppText>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.textFaint}
          style={styles.chevron}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.spotDetail}>
          {/* Key→value list reads cleaner than a 3-col grid for long token amounts. */}
          <DetailRow label="Total" value={hidden ? `${MASK} ${symbol}` : coinAmt(b.total)} />
          <DetailRow label="Available" value={hidden ? `${MASK} ${symbol}` : coinAmt(b.available)} />
          {b.hold > 1e-8 ? (
            <DetailRow label="In Orders" value={hidden ? `${MASK} ${symbol}` : coinAmt(b.hold)} />
          ) : null}
          <DetailRow
            label="Price"
            value={b.priceKnown !== true ? 'Unavailable' : `$${formatPrice(price, displayPriceDecimals(b.coin, instrument, price))}`}
          />
          <DetailRow label="USD Value" value={b.priceKnown !== true ? 'Unavailable' : m(`${b.usdValue < 0 ? '−' : ''}${usd(b.usdValue)}`)} strong />
          {instrument ? (
            <Pressable style={styles.chartLink} onPress={onChart} hitSlop={6}>
              <AppText variant="caption" color={Colors.accent}>
                View chart
              </AppText>
              <Ionicons name="chevron-forward" size={13} color={Colors.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A label-left / value-right row; values line up on the right edge. */
function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="label" numeric color={strong ? Colors.text : Colors.textMuted}>
        {value}
      </AppText>
    </View>
  );
}

const OrderCard = memo(OrderCardImpl, (prev, next) =>
  prev.o === next.o &&
  prev.instrument?.id === next.instrument?.id &&
  prev.symbol === next.symbol &&
  prev.tradable === next.tradable &&
  prev.busy === next.busy &&
  prev.hidden === next.hidden,
);

function OrderCardImpl({
  o,
  instrument,
  symbol,
  tradable,
  busy,
  hidden,
  onCancel,
}: {
  o: HlOpenOrder;
  instrument: Instrument | undefined;
  symbol: string;
  tradable: boolean;
  busy: boolean;
  hidden: boolean;
  onCancel: () => void;
}) {
  const decimals = displayPriceDecimals(o.coin, instrument, o.limitPx);
  const sideColor = o.side === 'buy' ? Colors.up : Colors.down;
  const filledPct = o.origSize > o.size ? ((o.origSize - o.size) / o.origSize) * 100 : 0;
  const typeLabel = o.isTrigger ? `Stop ${o.orderType}`.trim() : o.orderType;
  const m = (s: string) => (hidden ? MASK : s);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        {instrument ? (
          <SymbolLogo instrument={instrument} size={40} />
        ) : (
          <View style={styles.coinFallback}>
            <AppText variant="label">{symbol.slice(0, 3)}</AppText>
          </View>
        )}
        <View style={styles.mid}>
          <View style={styles.titleRow}>
            <AppText style={styles.symbol} numberOfLines={1}>
              {symbol}
            </AppText>
            <View style={[styles.sideBadge, { backgroundColor: sideColor + '22' }]}>
              <AppText variant="caption" color={sideColor}>
                {o.side === 'buy' ? 'Buy' : 'Sell'}
              </AppText>
            </View>
            {o.reduceOnly ? (
              <View style={styles.xyzBadge}>
                <AppText variant="caption" muted>
                  Reduce
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText style={styles.sub} numeric numberOfLines={1}>
            {m(`${qty(o.size)} ${symbol}`)} @ ${formatPrice(o.limitPx, decimals)}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {typeLabel} · {whenLabel(o.timestamp)}
            {filledPct > 0.5 ? ` · ${filledPct.toFixed(0)}% filled` : ''}
          </AppText>
        </View>
        {busy ? (
          <ActivityIndicator color={Colors.textMuted} />
        ) : (
          <Pressable
            style={({ pressed }) => [styles.cancelBtn, pressed && tradable && styles.actionBtnPressed]}
            onPress={onCancel}
            disabled={!tradable}
            hitSlop={6}>
            <AppText variant="label" color={tradable ? Colors.down : Colors.textFaint}>
              Cancel
            </AppText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const FillCard = memo(FillCardImpl, (prev, next) =>
  prev.f === next.f &&
  prev.instrument?.id === next.instrument?.id &&
  prev.symbol === next.symbol &&
  prev.hidden === next.hidden &&
  prev.expanded === next.expanded,
);

function FillCardImpl({
  f,
  instrument,
  symbol,
  hidden,
  expanded,
  onToggle,
}: {
  f: HlFill;
  instrument: Instrument | undefined;
  symbol: string;
  hidden: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const decimals = displayPriceDecimals(f.coin, instrument, f.px);
  const sideColor = f.side === 'buy' ? Colors.up : Colors.down;
  const pnlColor = f.closedPnl >= 0 ? Colors.up : Colors.down;
  const m = (s: string) => (hidden ? MASK : s);

  const isXyz = f.coin.startsWith('xyz:');
  const tradeValue = f.px * f.size;
  const isRebate = f.fee < 0;
  // Fee shown as its P&L impact: a paid fee is negative, a maker rebate positive.
  const feeText = f.pnlKnown !== true ? '—' : f.feeToken?.toUpperCase() === 'USDC' ? signMoneyExact(-f.fee) : `${f.fee > 0 ? '−' : f.fee < 0 ? '+' : ''}${tokenAmt(Math.abs(f.fee))} ${f.feeToken ?? 'token'}`;
  const netPnl = f.pnlKnown === true ? fillNetPnl(f) : null;
  const netColor = netPnl == null ? Colors.textMuted : netPnl >= 0 ? Colors.up : Colors.down;
  // Only closing fills realize PnL; opens book 0. Show the gross→net split only then.
  const showPnl = f.closedPnl !== 0 || /close|reduce/i.test(f.dir);
  const hashValid = /^0x[0-9a-fA-F]{2,}$/.test(f.hash);

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
        onPress={onToggle}>
        {instrument ? (
          <SymbolLogo instrument={instrument} size={40} />
        ) : (
          <View style={styles.coinFallback}>
            <AppText variant="label">{symbol.slice(0, 3)}</AppText>
          </View>
        )}
        <View style={styles.mid}>
          <View style={styles.titleRow}>
            <AppText style={styles.symbol} numberOfLines={1}>
              {symbol}
            </AppText>
            <View style={[styles.sideBadge, { backgroundColor: sideColor + '22' }]}>
              <AppText variant="caption" color={sideColor}>
                {f.dir}
              </AppText>
            </View>
            {isXyz ? (
              <View style={styles.xyzBadge}>
                <AppText variant="caption" muted>
                  xyz
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText style={styles.sub} numeric numberOfLines={1}>
            {m(`${qty(f.size)} ${symbol}`)} @ ${formatPrice(f.px, decimals)} · {whenLabel(f.timestamp)}
          </AppText>
        </View>
        {/* At-a-glance figure is the NET realized PnL (after fees), matching HL's web
            "Closed PNL"; the gross→fee→net split lives in the expanded detail. */}
        {f.closedPnl !== 0 ? (
          <AppText style={[styles.pnl, { color: netColor }]} numeric numberOfLines={1}>
            {netPnl == null ? '—' : m(signedUsd(netPnl))}
          </AppText>
        ) : null}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.textFaint}
          style={styles.chevron}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.detail}>
          <View style={styles.gridRow}>
            <Cell label="Trade Value" value={m(usdExact(tradeValue))} />
            <Cell
              label={isRebate ? 'Rebate' : 'Fee'}
              value={m(feeText)}
              color={isRebate ? Colors.up : undefined}
            />
            <Cell label="Type" value={f.crossed ? 'Taker' : 'Maker'} />
          </View>
          <View style={styles.gridRow}>
            <Cell
              label="Closed PnL"
              value={showPnl && f.pnlKnown === true ? m(signMoneyExact(f.closedPnl)) : '—'}
              color={showPnl ? pnlColor : undefined}
              sub={showPnl ? 'before fees' : undefined}
            />
            <Cell
              label="Net PnL"
              value={showPnl && netPnl != null ? m(signMoneyExact(netPnl)) : '—'}
              color={showPnl ? netColor : undefined}
              sub={showPnl ? netPnl == null ? 'USD fee unavailable' : 'after fees' : undefined}
            />
            <Cell label="Time" value={fullWhen(f.timestamp)} />
          </View>

          {hashValid ? (
            <Pressable
              style={styles.chartLink}
              onPress={() => Linking.openURL(`https://app.hyperliquid.xyz/explorer/tx/${f.hash}`)}
              hitSlop={6}>
              <AppText variant="caption" color={Colors.accent}>
                View on explorer
              </AppText>
              <Ionicons name="open-outline" size={13} color={Colors.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AccountReadStatus({ label, query, freshForMs }: {
  label: string;
  query: { data: unknown; isError: boolean; isFetching: boolean; dataUpdatedAt: number; refetch: () => Promise<unknown> };
  freshForMs: number;
}) {
  const state = accountReadState(query, freshForMs);
  const updated = query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt).toLocaleTimeString() : null;
  return (
    <View style={styles.readStatus}>
      {query.isFetching ? <ActivityIndicator size="small" color={Colors.accent} /> : null}
      <AppText variant="caption" muted>
        {state === 'loading' ? `Loading ${label}…` : state === 'error' ? `Couldn’t load ${label}` : state === 'stale'
          ? `${label[0].toUpperCase() + label.slice(1)} may be out of date${updated ? ` · last updated ${updated}` : ''}${query.isError ? ' · refresh failed' : ''}`
          : state === 'refreshing' ? `Refreshing ${label}…` : `Updated ${updated ?? 'just now'}`}
      </AppText>
      {state === 'error' || state === 'stale' ? (
        <Pressable accessibilityRole="button" disabled={query.isFetching} onPress={() => { void query.refetch(); }}>
          <AppText variant="label" color={Colors.accent}>{query.isFetching ? 'Retrying…' : 'Retry'}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function HistoryLoading() {
  return (
    <View style={styles.historyState}>
      <ActivityIndicator color={Colors.accent} />
      <AppText variant="caption" muted>Loading recent account history…</AppText>
    </View>
  );
}

function HistoryError({ label, detail, onRetry }: { label: string; detail?: string; onRetry: () => void }) {
  return (
    <View style={styles.historyState}>
      <AppText variant="body" muted>{`Couldn’t load ${label}`}</AppText>
      {detail ? <AppText variant="caption" muted style={styles.historyEmptyDetail}>{detail}</AppText> : null}
      <Pressable onPress={onRetry} hitSlop={8}>
        <AppText variant="label" color={Colors.accent}>Retry</AppText>
      </Pressable>
    </View>
  );
}

function HistoryEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.historyState}>
      <View style={styles.historyEmptyIcon}>
        <Ionicons name="receipt-outline" size={22} color={Colors.textFaint} />
      </View>
      <AppText variant="body">{title}</AppText>
      <AppText variant="caption" muted style={styles.historyEmptyDetail}>
        {detail}
      </AppText>
    </View>
  );
}

function HistoryIntro({
  icon,
  title,
  detail,
}: {
  icon: 'swap-vertical-outline' | 'time-outline';
  title: string;
  detail: string;
}) {
  return (
    <View style={styles.historyIntro}>
      <View style={styles.historyIntroIcon}>
        <Ionicons name={icon} size={16} color={Colors.accent} />
      </View>
      <View style={styles.historyIntroCopy}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" muted>{detail}</AppText>
      </View>
    </View>
  );
}

const FundingHistoryCard = memo(function FundingHistoryCard({
  row,
  hidden,
}: {
  row: HlUserFunding;
  hidden: boolean;
}) {
  const side = row.signedSize >= 0 ? 'Long' : 'Short';
  const sideColor = row.signedSize >= 0 ? Colors.up : Colors.down;
  const paymentColor = row.payment > 0 ? Colors.up : row.payment < 0 ? Colors.down : Colors.textMuted;
  const symbol = cleanCoin(row.coin);
  return (
    <View style={styles.historyCard}>
      <View style={styles.historyCardTop}>
        <View style={styles.historyMarket}>
          <View style={styles.historyTitleRow}>
            <AppText style={styles.historySymbol}>{symbol}</AppText>
            <View style={[styles.historySideBadge, { backgroundColor: sideColor + '18' }]}>
              <AppText variant="caption" color={sideColor}>{side}</AppText>
            </View>
          </View>
          <AppText variant="caption" muted numeric>{fullWhen(row.timestamp)}</AppText>
        </View>
        <View style={styles.historyPayment}>
          <AppText variant="caption" muted>Payment</AppText>
          <AppText numeric color={paymentColor} style={styles.historyPaymentValue}>
            {hidden ? `${MASK} USDC` : `${historyTokenAmount(row.payment)} USDC`}
          </AppText>
        </View>
      </View>
      <View style={styles.historyMetaRow}>
        <View style={styles.historyMetaCell}>
          <AppText variant="caption" muted>Size</AppText>
          <AppText variant="label" numeric numberOfLines={1}>
            {hidden ? `${MASK} ${symbol}` : `${qty(Math.abs(row.signedSize))} ${symbol}`}
          </AppText>
        </View>
        <View style={styles.historyMetaCell}>
          <AppText variant="caption" muted>Rate</AppText>
          <AppText variant="label" numeric>{formatFundingRatePercent(row.rate)}</AppText>
        </View>
        <View style={[styles.historyMetaCell, styles.historyMetaRight]}>
          <AppText variant="caption" muted>Interval</AppText>
          <AppText variant="label" numeric>
            {row.sampleCount && row.sampleCount > 1 ? `${row.sampleCount}h grouped` : 'Hourly'}
          </AppText>
        </View>
      </View>
    </View>
  );
});

const InterestHistoryCard = memo(function InterestHistoryCard({
  row,
  hidden,
}: {
  row: HlBorrowLendInterest;
  hidden: boolean;
}) {
  const paid = row.paid > 0;
  const earned = row.earned > 0;
  return (
    <View style={styles.historyCard}>
      <View style={styles.interestHead}>
        <View style={styles.interestAssetIcon}>
          <AppText variant="label">{row.token.slice(0, 1)}</AppText>
        </View>
        <View style={styles.interestAssetCopy}>
          <AppText style={styles.historySymbol}>{row.token}</AppText>
          <AppText variant="caption" muted numeric>{fullWhen(row.timestamp)}</AppText>
        </View>
      </View>
      <View style={styles.interestValues}>
        <View style={styles.interestValueCell}>
          <AppText variant="caption" muted>Paid</AppText>
          <AppText
            numeric
            color={paid ? Colors.down : Colors.textFaint}
            style={styles.interestValue}>
            {hidden ? MASK : paid ? historyTokenAmount(row.paid, '-') : '—'}
          </AppText>
          <AppText variant="caption" color={Colors.textFaint}>{row.token}</AppText>
        </View>
        <View style={styles.interestValueDivider} />
        <View style={styles.interestValueCell}>
          <AppText variant="caption" muted>Earned</AppText>
          <AppText
            numeric
            color={earned ? Colors.up : Colors.textFaint}
            style={styles.interestValue}>
            {hidden ? MASK : earned ? historyTokenAmount(row.earned, '+') : '—'}
          </AppText>
          <AppText variant="caption" color={Colors.textFaint}>{row.token}</AppText>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  scroll: { paddingBottom: Spacing.xxxl },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { marginTop: Spacing.sm },
  emptyBody: { textAlign: 'center', maxWidth: 320, lineHeight: 23 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 52,
    backgroundColor: Colors.accent,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
    borderRadius: 6,
    marginTop: Spacing.sm,
  },
  demoLink: { paddingVertical: Spacing.sm },
  retryBtn: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },

  demoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    backgroundColor: Colors.warning + '14',
  },
  balanceCard: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  balanceLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  portfolioTitle: { fontSize: 25, lineHeight: 31, fontWeight: '600' },
  overviewActions: { flexDirection: 'row', alignItems: 'center', gap: 23 },
  accountAddress: { marginTop: 5 },
  equityLabel: { marginTop: 24 },
  equity: { fontSize: 36, lineHeight: 43, fontWeight: '500', marginTop: 5 },
  overviewMetrics: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 21, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  overviewMetric: { width: '50%', minHeight: 60, paddingTop: 11, paddingRight: 10, paddingBottom: 5, gap: 4 },
  accountDetails: { marginHorizontal: Spacing.lg, marginTop: 12 },
  overviewValue: { fontSize: 19, lineHeight: 24, fontWeight: '500' },
  overviewNote: { fontSize: 10, lineHeight: 14 },
  coverageNote: { marginTop: 7, fontSize: 10, lineHeight: 15 },
  ledgerRow: { minHeight: 74, paddingHorizontal: Spacing.lg, paddingVertical: 13, flexDirection: 'row', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  ledgerCopy: { flex: 1, gap: 5 },
  ledgerValue: { alignItems: 'flex-end', justifyContent: 'center', gap: 5 },
  ledgerNote: { marginHorizontal: Spacing.lg, marginBottom: 8, lineHeight: 16 },
  pnlRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },

  riskCard: { marginHorizontal: Spacing.lg, marginTop: 18, paddingVertical: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  riskHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  riskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  maintenanceBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  maintenanceBadgeWarning: { backgroundColor: Colors.warning + '14' },
  maintenanceBadgeUrgent: { backgroundColor: Colors.down + '16' },
  riskMetrics: {
    flexDirection: 'row',
    gap: 2,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  riskMetric: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: 'transparent',
    gap: 3,
  },
  riskMetricValue: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
  riskWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
    borderRadius: Radius.sm,
    backgroundColor: Colors.warning + '0F',
  },
  riskWarningUrgent: { backgroundColor: Colors.down + '12' },
  riskWarningText: { flex: 1 },

  tabBarWrap: { marginTop: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  tabBar: {
    flexDirection: 'row',
    gap: 0,
    padding: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Colors.accent },
  tabCount: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  tabCountActive: { backgroundColor: Colors.accentSoft },
  noPositions: { padding: Spacing.xl, alignItems: 'center' },

  historyList: { paddingTop: Spacing.sm, gap: Spacing.sm },
  readStatus: {
    minHeight: 38,
    marginHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  historyState: {
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  historyEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.045)',
    marginBottom: Spacing.xs,
  },
  historyEmptyDetail: { maxWidth: 300, textAlign: 'center', lineHeight: 16 },
  historyIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  historyIntroIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentSoft,
  },
  historyIntroCopy: { flex: 1, gap: 2 },
  historyCard: {
    marginHorizontal: Spacing.lg,
    padding: 14,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.075)',
    backgroundColor: Colors.surface,
    gap: Spacing.md,
  },
  historyCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  historyMarket: { flex: 1, minWidth: 0, gap: 4 },
  historyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  historySymbol: { color: Colors.text, fontSize: 17, lineHeight: 21, fontWeight: '600' },
  historySideBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  historyPayment: { flex: 1.2, minWidth: 0, alignItems: 'flex-end', gap: 3 },
  historyPaymentValue: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  historyMetaRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  historyMetaCell: { flex: 1, minWidth: 0, gap: 3 },
  historyMetaRight: { alignItems: 'flex-end' },
  interestHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  interestAssetIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  interestAssetCopy: { flex: 1, gap: 3 },
  interestValues: {
    flexDirection: 'row',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.035)',
    paddingVertical: Spacing.sm,
  },
  interestValueCell: { flex: 1, alignItems: 'center', gap: 2 },
  interestValueDivider: { width: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  interestValue: { fontSize: 16, lineHeight: 21, fontWeight: '600' },

  // Rows mirror the main watchlist (SymbolRow): full-width hairline, logo 40,
  // 16/700 symbol, 16/600 value, 13px muted sub.
  list: {},
  positionCard: {
    marginHorizontal: Spacing.lg,
    marginTop: 12,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  positionBody: { padding: 13, gap: 16 },
  positionDetails: { gap: Spacing.lg },
  positionSummary: { minHeight: 58 },
  positionSummaryTapTarget: { flexDirection: 'row', gap: 10, minHeight: 58 },
  positionSummaryPressed: {
    opacity: 0.78,
  },
  positionSummaryCell: { flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: 7 },
  positionMarketCell: { flex: 1.05 },
  positionPnlCell: { flex: 1.25, paddingRight: 34 },
  positionColumnLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
    letterSpacing: 0.65,
    textTransform: 'uppercase',
  },
  marketValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32 },
  positionSymbol: { flexShrink: 0, fontSize: 20, lineHeight: 25, fontWeight: '600' },
  positionLeverageBadge: {
    flexShrink: 0,
    minWidth: 25,
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 6,
  },
  positionLeverageText: { fontSize: 12, lineHeight: 15, fontWeight: '600' },
  positionPrimaryValue: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  pnlValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  positionPnlText: { flex: 1, minWidth: 0, gap: 1 },
  positionPnlAmount: { fontSize: 18, lineHeight: 21, fontWeight: '600' },
  positionRoeText: { fontSize: 12, lineHeight: 15, fontWeight: '600' },
  positionChartButton: {
    position: 'absolute',
    top: 22,
    right: 0,
    width: 28,
    height: 28,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.accentSoft,
  },
  positionDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.border,
  },
  positionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 8,
    minHeight: 54,
  },
  collapseAction: {
    width: 34,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 13,
  },
  pressed: { backgroundColor: Colors.surface },
  coinFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { flex: 1, marginLeft: Spacing.md, paddingRight: Spacing.sm, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  symbol: { fontSize: 16, fontWeight: '600', color: Colors.text },
  sub: { fontSize: 13, color: Colors.textMuted },
  sideBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.sm },
  xyzBadge: { backgroundColor: Colors.surfaceAlt, paddingHorizontal: 5, paddingVertical: 1, borderRadius: Radius.sm },
  right: { alignItems: 'flex-end', marginLeft: Spacing.sm, gap: 2 },
  pnl: { fontSize: 16, fontWeight: '600' },
  roe: { fontSize: 13, fontWeight: '500' },
  spotValue: { fontSize: 16, fontWeight: '600', color: Colors.text, marginLeft: Spacing.sm },
  spotLiability: { color: Colors.down },
  chevron: { marginLeft: Spacing.sm },
  quickActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 38,
    paddingHorizontal: 5,
    paddingVertical: Spacing.sm,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.075)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  quickActionText: { fontSize: 13, lineHeight: 17, fontWeight: '600', textAlign: 'center' },

  // Expanded detail
  detail: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.md },
  gridRow: { flexDirection: 'row', gap: Spacing.sm },
  cell: { flex: 1, minWidth: 0, gap: 3 },
  spotDetail: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, paddingBottom: Spacing.md },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  cellValue: { marginTop: 1, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  cellValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 27 },
  actionBtnPressed: { backgroundColor: Colors.surfacePress },
  cancelBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    marginLeft: Spacing.sm,
  },
  chartLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: Spacing.xs },

  portfolioWrap: { paddingHorizontal: Spacing.lg },
  disclaimer: { textAlign: 'center', marginTop: Spacing.lg },
});
