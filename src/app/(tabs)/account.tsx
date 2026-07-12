import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, type ComponentProps, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MarginSheet } from '@/components/MarginSheet';
import { PortfolioCard } from '@/components/PortfolioCard';
import { SymbolLogo } from '@/components/SymbolLogo';
import {
  TpSlSheet,
  type TpSlExistingOrder,
  type TpSlLegInput,
} from '@/components/TpSlSheet';
import { TradeTicket } from '@/components/TradeTicket';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useMarkets } from '@/data/useMarkets';
import {
  useHlAccount,
  useHlFills,
  useHlOpenOrders,
  useTradingIdentity,
} from '@/data/useHlAccount';
import { useHlMeta } from '@/data/useHlMeta';
import {
  buildAccountRiskSummary,
  isProtectiveStop,
  type AccountRiskSummary,
} from '@/lib/accountRisk';
import {
  cancelOrder,
  placePositionTpSl,
  reversePosition,
  updateIsolatedMargin,
  type OrderResult,
} from '@/lib/hyperliquid/exchange';
import { fetchHlAccount, fetchOpenOrders, fetchOrderBook } from '@/lib/hyperliquid/info';
import type { HlFill, HlOpenOrder, HlPosition, HlSpotBalance } from '@/lib/hyperliquid/info';
import {
  assertTradingIdentityCurrent,
  signedIdentityBinding,
  TradingIdentityError,
  type SignedTradingIdentityBinding,
} from '@/lib/hyperliquid/tradingIdentity';
import { formatCompact, formatPercent, formatPrice, priceDecimalsFor, signedUsd, usd } from '@/lib/format';
import { priceToWire, sizeToWire } from '@/lib/hyperliquid/sign';
import { queryKeys } from '@/lib/queryKeys';
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
const REVERSE_SLIPPAGE = 0.05;
/** A 10bp midpoint/adverse-touch move requires a fresh reverse confirmation. */
const REVERSE_RECONFIRM_DRIFT_PCT = 0.1;

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

class ReverseReconfirmationRequiredError extends AccountPreflightError {}

class AccountMutationStatusUnknownError extends Error {
  constructor(
    readonly action: 'reverse' | 'margin' | 'cancel',
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : 'Unknown exchange error');
  }
}

/** Clean ticker for a position coin ("xyz:SNDK" → "SNDK"). */
const cleanCoin = (coin: string) => coin.replace(/^xyz:/, '');

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

/** A pending close ticket. Live size, side, and mark are re-resolved by coin. */
interface CloseTicket {
  coin: string;
  type: 'market' | 'limit';
}

/** Immutable values the user explicitly reviews before a reverse can be signed. */
interface ReverseDraft {
  readonly coin: string;
  readonly symbol: string;
  readonly priceDecimals: number;
  readonly expectedSide: HlPosition['side'];
  readonly expectedSize: number;
  readonly expectedLeverage: number;
  readonly expectedLeverageType: HlPosition['leverageType'];
  readonly targetSide: HlPosition['side'];
  readonly orderIsBuy: boolean;
  readonly requestedOrderSize: number;
  readonly reviewedBid: number;
  readonly reviewedAsk: number;
  readonly reviewedMidPx: number;
  readonly reviewedIocCapPx: number;
  readonly reviewedIocCapWire: string;
  readonly assetIndex: number;
  readonly szDecimals: number;
  readonly identity: SignedTradingIdentityBinding;
}

interface ReverseExecutionResult {
  readonly draft: ReverseDraft;
  readonly acknowledgement: OrderResult;
  /** `null` means flat; `undefined` means the post-trade refresh failed. */
  readonly actualPosition: HlPosition | null | undefined;
  readonly refreshError?: string;
}

function lotSize(size: number, szDecimals: number): number {
  return Number(sizeToWire(size, szDecimals));
}

function lotSizeLabel(size: number, szDecimals: number): string {
  return sizeToWire(size, szDecimals);
}

/** Re-run every reviewed reverse invariant after identity proof, at the signing boundary. */
async function validateReverseDraftImmediately(
  draft: ReverseDraft,
  currentMeta: { assetIndex: number; szDecimals: number } | undefined,
): Promise<void> {
  if (
    !currentMeta ||
    currentMeta.assetIndex !== draft.assetIndex ||
    currentMeta.szDecimals !== draft.szDecimals
  ) {
    throw new ReverseReconfirmationRequiredError(
      'Market metadata changed after review. Prepare the reverse again; no order was sent.',
    );
  }

  let book: Awaited<ReturnType<typeof fetchOrderBook>>;
  try {
    book = await fetchOrderBook(draft.coin, draft.identity.network);
  } catch (error) {
    throw new AccountPreflightError(
      `Could not refresh the order book; no reverse order was sent: ${
        error instanceof Error ? error.message : 'network error'
      }`,
    );
  }
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (
    !(bestBid && bestAsk) ||
    !Number.isFinite(bestBid) ||
    !Number.isFinite(bestAsk) ||
    bestAsk < bestBid
  ) {
    throw new AccountPreflightError(
      'A fresh two-sided order book is unavailable. No reverse order was sent.',
    );
  }

  const liveMid = (bestBid + bestAsk) / 2;
  const reviewedTouch = draft.orderIsBuy ? draft.reviewedAsk : draft.reviewedBid;
  const liveTouch = draft.orderIsBuy ? bestAsk : bestBid;
  const midpointDriftPct =
    (Math.abs(liveMid - draft.reviewedMidPx) / draft.reviewedMidPx) * 100;
  const adverseTouchDriftPct = draft.orderIsBuy
    ? (Math.max(0, liveTouch - reviewedTouch) / reviewedTouch) * 100
    : (Math.max(0, reviewedTouch - liveTouch) / reviewedTouch) * 100;
  const reviewedCapStillMatches =
    priceToWire(
      draft.reviewedMidPx *
        (draft.orderIsBuy ? 1 + REVERSE_SLIPPAGE : 1 - REVERSE_SLIPPAGE),
      draft.szDecimals,
    ) === draft.reviewedIocCapWire;
  const liveTouchOutsideReviewedCap = draft.orderIsBuy
    ? liveTouch > draft.reviewedIocCapPx
    : liveTouch < draft.reviewedIocCapPx;
  if (
    !reviewedCapStillMatches ||
    liveTouchOutsideReviewedCap ||
    midpointDriftPct >= REVERSE_RECONFIRM_DRIFT_PCT ||
    adverseTouchDriftPct >= REVERSE_RECONFIRM_DRIFT_PCT
  ) {
    throw new ReverseReconfirmationRequiredError(
      `The executable market moved after review (midpoint ${midpointDriftPct.toFixed(
        2,
      )}%, adverse touch ${adverseTouchDriftPct.toFixed(
        2,
      )}%). Prepare the reverse again to review a new IOC cap; no order was sent.`,
    );
  }

  // Account/position is authoritative and deliberately fetched last. Bound how
  // long the already-validated book may age while that final read is in flight.
  const bookValidatedAt = Date.now();
  let liveAccount;
  try {
    liveAccount = await fetchHlAccount(draft.identity.accountAddress, draft.identity.network);
  } catch (error) {
    throw new AccountPreflightError(
      `Could not recheck the live position; no reverse order was sent: ${
        error instanceof Error ? error.message : 'network error'
      }`,
    );
  }
  if (Date.now() - bookValidatedAt > 1_500) {
    throw new ReverseReconfirmationRequiredError(
      'The final account check took too long and the reviewed book may be stale. Prepare the reverse again; no order was sent.',
    );
  }
  const live = liveAccount.positions.find((position) => position.coin === draft.coin);
  if (
    !live ||
    live.side !== draft.expectedSide ||
    lotSize(live.size, draft.szDecimals) !== draft.expectedSize ||
    live.leverage !== draft.expectedLeverage ||
    live.leverageType !== draft.expectedLeverageType
  ) {
    throw new ReverseReconfirmationRequiredError(
      'The live position side, size, leverage, or margin mode changed after review. Prepare the reverse again; no order was sent.',
    );
  }

  if (lotSize(live.size * 2, draft.szDecimals) !== draft.requestedOrderSize) {
    throw new ReverseReconfirmationRequiredError(
      'The exact 2× order size changed after review. Prepare the reverse again; no order was sent.',
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
  const { data: account, isLoading, isError, refetch } = useHlAccount();
  const { data: tradingIdentity } = useTradingIdentity();
  const executionIdentity = signedIdentityBinding(tradingIdentity);
  const { data: openOrders } = useHlOpenOrders();
  const { data: fills } = useHlFills();
  const { data: markets } = useMarkets();
  const { data: meta } = useHlMeta();

  const tradable = hasKey && !demo && !!executionIdentity;
  const [tab, setTab] = useState<'positions' | 'orders' | 'balances' | 'history'>('positions');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [closeTicket, setCloseTicket] = useState<CloseTicket | null>(null);
  const [reversePreparingCoin, setReversePreparingCoin] = useState<string | null>(null);
  // Long-lived sheets store identifiers only. Account state refreshes every 5s;
  // retaining a position snapshot here could close or protect a stale size/mark.
  const [marginTargetCoin, setMarginTargetCoin] = useState<string | null>(null);
  const [tpSlTargetCoin, setTpSlTargetCoin] = useState<string | null>(null);
  const hideSmallBalances = usePreferences((s) => s.hideSmallBalances);
  const privacyMode = usePreferences((s) => s.privacyMode);
  const setPrivacyMode = usePreferences((s) => s.setPrivacyMode);
  // Privacy mode masks every account value/amount; market prices stay visible.
  const mask = useCallback((s: string) => (privacyMode ? MASK : s), [privacyMode]);

  // Resolve a position's coin to a real catalog instrument (logo + chart link + decimals).
  // `coinKey` matches both default perps ("BTC") and trade.xyz coins ("xyz:SNDK").
  const instrumentForCoin = useCallback(
    (coin: string): Instrument | undefined => markets?.byCoinKey.get(coin),
    [markets],
  );

  const closePosition = closeTicket
    ? account?.positions.find((position) => position.coin === closeTicket.coin) ?? null
    : null;
  const marginTarget = marginTargetCoin
    ? account?.positions.find((position) => position.coin === marginTargetCoin) ?? null
    : null;
  const tpSlTarget = tpSlTargetCoin
    ? account?.positions.find((position) => position.coin === tpSlTargetCoin) ?? null
    : null;

  const reverseMutation = useMutation({
    mutationFn: async (draft: ReverseDraft): Promise<ReverseExecutionResult> => {
      const identity = draft.identity;
      const assertIdentityCurrent = () =>
        assertTradingIdentityCurrent(identity, useHlConnection.getState());
      try {
        assertIdentityCurrent();
      } catch (error) {
        throw new AccountPreflightError(error instanceof Error ? error.message : 'Trading identity changed.');
      }

      const m = meta?.[draft.coin];
      if (
        !m ||
        m.assetIndex !== draft.assetIndex ||
        m.szDecimals !== draft.szDecimals
      ) {
        throw new ReverseReconfirmationRequiredError(
          'Market metadata changed after review. Prepare the reverse again; no order was sent.',
        );
      }

      let liveAccount;
      try {
        liveAccount = await fetchHlAccount(identity.accountAddress, identity.network);
      } catch (error) {
        throw new AccountPreflightError(
          `Could not recheck the live position; no reverse order was sent: ${
            error instanceof Error ? error.message : 'network error'
          }`,
        );
      }
      const live = liveAccount.positions.find((position) => position.coin === draft.coin);
      if (
        !live ||
        live.side !== draft.expectedSide ||
        lotSize(live.size, draft.szDecimals) !== draft.expectedSize ||
        live.leverage !== draft.expectedLeverage ||
        live.leverageType !== draft.expectedLeverageType
      ) {
        throw new ReverseReconfirmationRequiredError(
          'The live position side, size, leverage, or margin mode changed after review. Prepare the reverse again; no order was sent.',
        );
      }

      let book: Awaited<ReturnType<typeof fetchOrderBook>>;
      try {
        book = await fetchOrderBook(draft.coin, identity.network);
      } catch (error) {
        throw new AccountPreflightError(
          `Could not refresh the order book; no reverse order was sent: ${
            error instanceof Error ? error.message : 'network error'
          }`,
        );
      }
      const bestBid = book.bids[0]?.price;
      const bestAsk = book.asks[0]?.price;
      if (
        !(bestBid && bestAsk) ||
        !Number.isFinite(bestBid) ||
        !Number.isFinite(bestAsk) ||
        bestAsk < bestBid
      ) {
        throw new AccountPreflightError('A fresh two-sided order book is unavailable. No reverse order was sent.');
      }

      const liveMid = (bestBid + bestAsk) / 2;
      const reviewedTouch = draft.orderIsBuy ? draft.reviewedAsk : draft.reviewedBid;
      const liveTouch = draft.orderIsBuy ? bestAsk : bestBid;
      const midpointDriftPct =
        (Math.abs(liveMid - draft.reviewedMidPx) / draft.reviewedMidPx) * 100;
      const adverseTouchDriftPct = draft.orderIsBuy
        ? (Math.max(0, liveTouch - reviewedTouch) / reviewedTouch) * 100
        : (Math.max(0, reviewedTouch - liveTouch) / reviewedTouch) * 100;
      const reviewedCapStillMatches =
        priceToWire(
          draft.reviewedMidPx *
            (draft.orderIsBuy ? 1 + REVERSE_SLIPPAGE : 1 - REVERSE_SLIPPAGE),
          draft.szDecimals,
        ) === draft.reviewedIocCapWire;
      const liveTouchOutsideReviewedCap = draft.orderIsBuy
        ? liveTouch > draft.reviewedIocCapPx
        : liveTouch < draft.reviewedIocCapPx;
      if (
        !reviewedCapStillMatches ||
        liveTouchOutsideReviewedCap ||
        midpointDriftPct >= REVERSE_RECONFIRM_DRIFT_PCT ||
        adverseTouchDriftPct >= REVERSE_RECONFIRM_DRIFT_PCT
      ) {
        throw new ReverseReconfirmationRequiredError(
          `The executable market moved after review (midpoint ${midpointDriftPct.toFixed(
            2,
          )}%, adverse touch ${adverseTouchDriftPct.toFixed(
            2,
          )}%). Prepare the reverse again to review a new IOC cap; no order was sent.`,
        );
      }

      const liveRequestedSize = lotSize(live.size * 2, draft.szDecimals);
      if (liveRequestedSize !== draft.requestedOrderSize) {
        throw new ReverseReconfirmationRequiredError(
          'The exact 2× order size changed after review. Prepare the reverse again; no order was sent.',
        );
      }

      let postAttempted = false;
      let acknowledgement: OrderResult;
      try {
        acknowledgement = await reversePosition({
          network: identity.network,
          identity,
          validateImmediatelyBeforeSigning: () =>
            validateReverseDraftImmediately(draft, meta?.[draft.coin]),
          assertIdentityCurrent,
          assetIndex: draft.assetIndex,
          szDecimals: draft.szDecimals,
          positionIsLong: draft.expectedSide === 'long',
          size: draft.expectedSize,
          // The midpoint is the immutable value shown in the confirmation. The
          // exchange derives the exact reviewed 5% IOC bound from this same value.
          markPx: draft.reviewedMidPx,
          slippage: REVERSE_SLIPPAGE,
          onPostAttempt: () => {
            postAttempted = true;
          },
        });
      } catch (error) {
        if (!postAttempted) {
          if (error instanceof ReverseReconfirmationRequiredError) throw error;
          throw new AccountPreflightError(
            error instanceof Error ? error.message : 'Trading identity could not be verified. No order was sent.',
          );
        }
        // Once the exchange POST begins, a timeout/lost response cannot prove the
        // order was rejected. Treat every such error as ambiguous to prevent retries.
        throw new AccountMutationStatusUnknownError('reverse', error);
      }

      let actualPosition: HlPosition | null | undefined;
      let refreshError: string | undefined;
      try {
        const after = await fetchHlAccount(identity.accountAddress, identity.network);
        actualPosition = after.positions.find((position) => position.coin === draft.coin) ?? null;
      } catch (error) {
        actualPosition = undefined;
        refreshError = error instanceof Error ? error.message : 'network error';
      }
      return { draft, acknowledgement, actualPosition, refreshError };
    },
    onSuccess: ({ draft, acknowledgement, actualPosition, refreshError }) => {
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlFillsPrefix() });
      qc.invalidateQueries({ queryKey: ['hl', 'activeAsset'] });

      const requestedLabel = lotSizeLabel(draft.requestedOrderSize, draft.szDecimals);
      const filledSize =
        acknowledgement.status === 'filled' &&
        acknowledgement.totalSz != null &&
        Number.isFinite(acknowledgement.totalSz)
          ? lotSize(acknowledgement.totalSz, draft.szDecimals)
          : null;
      const fullFillAcknowledged =
        acknowledgement.status === 'filled' && filledSize === draft.requestedOrderSize;
      const actualMatchesTarget =
        actualPosition != null &&
        actualPosition.side === draft.targetSide &&
        lotSize(actualPosition.size, draft.szDecimals) === draft.expectedSize;
      const completed = fullFillAcknowledged && actualMatchesTarget;
      const partiallyFilled =
        acknowledgement.status === 'filled' &&
        filledSize != null &&
        filledSize > 0 &&
        filledSize < draft.requestedOrderSize;

      const acknowledgementLine =
        acknowledgement.status === 'filled'
          ? `Exchange acknowledgement: filled ${
              filledSize == null ? 'unknown' : lotSizeLabel(filledSize, draft.szDecimals)
            } of ${requestedLabel} ${draft.symbol}.`
          : `Exchange acknowledgement: ${acknowledgement.status}.`;
      const actualLine =
        actualPosition === undefined
          ? `Actual position: unavailable — refresh failed${refreshError ? ` (${refreshError})` : ''}.`
          : actualPosition === null
            ? 'Actual position: Flat.'
            : `Actual position: ${actualPosition.side === 'long' ? 'Long' : 'Short'} ${lotSizeLabel(
                actualPosition.size,
                draft.szDecimals,
              )} ${draft.symbol}.`;
      const title = completed
        ? 'Reverse completed'
        : partiallyFilled
          ? 'Reverse partially filled'
          : fullFillAcknowledged
            ? 'Reverse fill not verified'
            : 'Reverse not completed';
      const outcome = completed
        ? `The reviewed 2× order filled and the live position matches the expected ${draft.targetSide} ${lotSizeLabel(
            draft.expectedSize,
            draft.szDecimals,
          )} ${draft.symbol}.`
        : 'This is not a verified completed reverse. Review the live position and fills before taking another action; do not submit another reverse until verified.';
      Alert.alert(title, `${acknowledgementLine}\n${actualLine}\n\n${outcome}`);
    },
    onError: (e: unknown) => {
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlFillsPrefix() });
      qc.invalidateQueries({ queryKey: ['hl', 'activeAsset'] });
      if (e instanceof ReverseReconfirmationRequiredError) {
        Alert.alert('Reverse needs a new review', e.message);
        return;
      }
      if (e instanceof AccountPreflightError) {
        Alert.alert('Reverse not sent', e.message);
        return;
      }
      Alert.alert(
        'Reverse status unknown',
        `${e instanceof Error ? e.message : 'The exchange response was not confirmed.'}\n\nReview the live position, Open Orders, and fills before taking another action. Do not retry the reverse until verified.`,
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ o, identity }: { o: HlOpenOrder; identity: SignedTradingIdentityBinding }) => {
      const assertIdentityCurrent = () =>
        assertTradingIdentityCurrent(identity, useHlConnection.getState());
      const m = meta?.[o.coin];
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
              priceToWire(live.triggerPx, m.szDecimals) ===
                priceToWire(o.triggerPx, m.szDecimals);
        if (
          !live ||
          live.coin !== o.coin ||
          live.side !== o.side ||
          live.reduceOnly !== o.reduceOnly ||
          live.isTrigger !== o.isTrigger ||
          sizeToWire(live.size, m.szDecimals) !== sizeToWire(o.size, m.szDecimals) ||
          priceToWire(live.limitPx, m.szDecimals) !== priceToWire(o.limitPx, m.szDecimals) ||
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
      const latestQuery = await refetch();
      if (latestQuery.isError || !latestQuery.data) {
        throw new ProtectionPreflightError('Could not recheck the live position. No TP/SL order was sent.');
      }
      const live = latestQuery.data.positions.find((position) => position.coin === p.coin);
      const sizeTolerance = 1 / 10 ** mInfo.szDecimals;
      if (
        !live ||
        live.side !== p.side ||
        Math.abs(live.size - p.size) >= sizeTolerance ||
        firstLeg.size > live.size + 1e-12
      ) {
        throw new ProtectionPreflightError('The live position side or size changed. Review TP/SL again; no orders were sent.');
      }
      const triggerStillValid = legs.every((leg) =>
        live.side === 'long'
          ? leg.tpsl === 'tp'
            ? leg.triggerPx > live.markPx
            : leg.triggerPx < live.markPx
          : leg.tpsl === 'tp'
            ? leg.triggerPx < live.markPx
            : leg.triggerPx > live.markPx,
      );
      if (!triggerStillValid) {
        throw new ProtectionPreflightError('The mark price moved past a trigger. Review the TP/SL levels again; no orders were sent.');
      }
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
          network: identity.network,
          identity,
          validateImmediatelyBeforeSigning,
          assertIdentityCurrent,
          assetIndex: mInfo.assetIndex,
          szDecimals: mInfo.szDecimals,
          positionIsLong: live.side === 'long',
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

  const confirmReverse = useCallback(
    async (p: HlPosition) => {
      if (!tradable || !executionIdentity) return;
      const identity = executionIdentity;
      setReversePreparingCoin(p.coin);
      try {
        assertTradingIdentityCurrent(identity, useHlConnection.getState());
        const m = meta?.[p.coin];
        if (!m) throw new Error(`No market metadata for ${p.coin}.`);

        const freshAccount = await fetchHlAccount(identity.accountAddress, identity.network);
        const live = freshAccount.positions.find((position) => position.coin === p.coin);
        const reviewedSize = lotSize(p.size, m.szDecimals);
        if (
          !live ||
          live.side !== p.side ||
          lotSize(live.size, m.szDecimals) !== reviewedSize
        ) {
          qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
          throw new Error('The position changed before review. Refresh the position and prepare the reverse again.');
        }

        const book = await fetchOrderBook(p.coin, identity.network);
        const bestBid = book.bids[0]?.price;
        const bestAsk = book.asks[0]?.price;
        if (
          !(bestBid && bestAsk) ||
          !Number.isFinite(bestBid) ||
          !Number.isFinite(bestAsk) ||
          bestAsk < bestBid
        ) {
          throw new Error('A fresh two-sided order book is unavailable.');
        }

        const symbol = instrumentForCoin(p.coin)?.symbol ?? cleanCoin(p.coin);
        const orderIsBuy = live.side === 'short';
        const targetSide: HlPosition['side'] = live.side === 'long' ? 'short' : 'long';
        const midpoint = (bestBid + bestAsk) / 2;
        const rawCap = midpoint *
          (orderIsBuy ? 1 + REVERSE_SLIPPAGE : 1 - REVERSE_SLIPPAGE);
        const capWire = priceToWire(rawCap, m.szDecimals);
        const requestedOrderSize = lotSize(live.size * 2, m.szDecimals);
        if (!(requestedOrderSize > 0)) throw new Error('The exact 2× order size is invalid.');
        const priceDecimals = priceDecimalsFor(
          instrumentForCoin(p.coin)?.priceDecimals ?? 6,
          midpoint,
        );
        const draft: ReverseDraft = Object.freeze({
          coin: p.coin,
          symbol,
          priceDecimals,
          expectedSide: live.side,
          expectedSize: lotSize(live.size, m.szDecimals),
          expectedLeverage: live.leverage,
          expectedLeverageType: live.leverageType,
          targetSide,
          orderIsBuy,
          requestedOrderSize,
          reviewedBid: bestBid,
          reviewedAsk: bestAsk,
          reviewedMidPx: midpoint,
          reviewedIocCapPx: Number(capWire),
          reviewedIocCapWire: capWire,
          assetIndex: m.assetIndex,
          szDecimals: m.szDecimals,
          identity,
        });

        Alert.alert(
          `Review reverse ${symbol}`,
          `Current position: ${draft.expectedSide === 'long' ? 'Long' : 'Short'} ${lotSizeLabel(
            draft.expectedSize,
            draft.szDecimals,
          )} ${symbol}\n` +
            `Order: ${draft.orderIsBuy ? 'Buy' : 'Sell'} ${lotSizeLabel(
              draft.requestedOrderSize,
              draft.szDecimals,
            )} ${symbol} (2× current size)\n` +
            `Reviewed bid / ask: $${formatPrice(
              draft.reviewedBid,
              draft.priceDecimals,
            )} / $${formatPrice(draft.reviewedAsk, draft.priceDecimals)}\n` +
            `Reviewed midpoint: $${formatPrice(
              draft.reviewedMidPx,
              draft.priceDecimals,
            )}\n` +
            `Exact 5% IOC ${draft.orderIsBuy ? 'buy ceiling' : 'sell floor'}: $${
              draft.reviewedIocCapWire
            }\n\n` +
            `Only a complete fill would produce the expected ${draft.targetSide} ${lotSizeLabel(
              draft.expectedSize,
              draft.szDecimals,
            )} ${symbol}. A partial fill can leave you ${draft.expectedSide}, flat, or with a smaller ${draft.targetSide}.` +
            (identity.network === 'mainnet'
              ? '\n\nThis uses real funds on mainnet.'
              : '\n\nTestnet order.'),
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Submit reviewed reverse',
              style: 'destructive',
              onPress: () => reverseMutation.mutate(draft),
            },
          ],
        );
      } catch (error) {
        Alert.alert(
          'Reverse review unavailable',
          `${error instanceof Error ? error.message : 'Could not prepare a fresh reverse review'}\n\nNo order was sent.`,
        );
      } finally {
        setReversePreparingCoin(null);
      }
    },
    [executionIdentity, instrumentForCoin, meta, qc, reverseMutation, tradable],
  );

  const confirmCancel = useCallback(
    (o: HlOpenOrder) => {
      if (!tradable || !executionIdentity) return;
      const identity = executionIdentity;
      const sym = cleanCoin(o.coin);
      const dec = priceDecimalsFor(6, o.limitPx);
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
    [executionIdentity, tradable, network, cancelMutation],
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

  const openCloseTicket = useCallback(
    (p: HlPosition, type: CloseTicket['type']) => {
      if (!tradable) return;
      setCloseTicket({ coin: p.coin, type });
    },
    [tradable],
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
        (b) => !hideSmallBalances || b.usdValue >= SMALL_BALANCE_USD,
      ),
    [account, hideSmallBalances],
  );

  const riskSummary = useMemo(
    () => (account ? buildAccountRiskSummary(account, openOrders ?? []) : null),
    [account, openOrders],
  );
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
            <Ionicons name="link" size={16} color={Colors.text} />
            <AppText variant="label">Connect in Settings</AppText>
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

  if (isLoading && !account) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      </Screen>
    );
  }

  if (isError || !account) {
    return (
      <Screen>
        <View style={styles.center}>
          <AppText muted>Couldn’t load account</AppText>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <AppText variant="label" color={Colors.accent}>
              Retry
            </AppText>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const pnlColor = account.unrealizedPnl >= 0 ? Colors.up : Colors.down;
  const equityBase = account.totalEquity ?? account.accountValue;
  const pnlPct = equityBase ? (account.unrealizedPnl / equityBase) * 100 : 0;

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

        {/* Total equity = perps + spot + vaults (Hyperliquid's "Total Equity"). */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceLabelRow}>
            <AppText variant="caption" muted>
              Account Value · Hyperliquid
            </AppText>
            <Pressable
              hitSlop={12}
              onPress={() => setPrivacyMode(!privacyMode)}
              accessibilityLabel={privacyMode ? 'Show balances' : 'Hide balances'}>
              <Ionicons
                name={privacyMode ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={Colors.textMuted}
              />
            </Pressable>
          </View>
          <AppText variant="title" numeric style={styles.equity}>
            {mask(usd(account.totalEquity ?? account.accountValue))}
          </AppText>
          <View style={styles.pnlRow}>
            <Ionicons
              name={account.unrealizedPnl >= 0 ? 'caret-up' : 'caret-down'}
              size={12}
              color={pnlColor}
            />
            <AppText variant="label" numeric color={pnlColor}>
              {mask(`${signedUsd(account.unrealizedPnl)} (${formatPercent(pnlPct)})`)}
            </AppText>
            <AppText variant="caption" muted>
              Unrealized
            </AppText>
          </View>
        </View>

        {/* Live risk outranks historical portfolio aesthetics while capital is deployed. */}
        <RiskStrip summary={riskSummary!} hidden={privacyMode} />

        {/* Positions / Orders / Balances / History tabs */}
        <View style={styles.tabBarWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBar}>
            <TabButton
              label="Positions"
              count={account.positions.length}
              active={tab === 'positions'}
              onPress={() => setTab('positions')}
            />
            <TabButton
              label="Orders"
              count={openOrders?.length ?? 0}
              active={tab === 'orders'}
              onPress={() => setTab('orders')}
            />
            <TabButton
              label="Balances"
              count={visibleBalances.length}
              active={tab === 'balances'}
              onPress={() => setTab('balances')}
            />
            <TabButton
              label="History"
              count={fills?.length ?? 0}
              active={tab === 'history'}
              onPress={() => setTab('history')}
            />
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
                  expanded={expanded.has(p.coin)}
                  tradable={tradable}
                  busy={
                    reversePreparingCoin === p.coin ||
                    (reverseMutation.isPending && reverseMutation.variables?.coin === p.coin)
                  }
                  hidden={privacyMode}
                  onToggle={() => toggleExpand(p.coin)}
                  onChart={() => openChart(p.coin)}
                  onLimitClose={() => openCloseTicket(p, 'limit')}
                  onMarketClose={() => openCloseTicket(p, 'market')}
                  onReverse={() => confirmReverse(p)}
                  onAdjustMargin={() => setMarginTargetCoin(p.coin)}
                  onSetTpSl={() => setTpSlTargetCoin(p.coin)}
                />
              ))}
            </View>
          )
        ) : tab === 'orders' ? (
          (openOrders?.length ?? 0) === 0 ? (
            <View style={styles.noPositions}>
              <AppText variant="body" muted>
                No open orders
              </AppText>
            </View>
          ) : (
            <View style={styles.list}>
              {openOrders!.map((o) => (
                <OrderCard
                  key={o.oid}
                  o={o}
                  instrument={instrumentForCoin(o.coin)}
                  tradable={tradable}
                  busy={cancelMutation.isPending && cancelMutation.variables?.o.oid === o.oid}
                  hidden={privacyMode}
                  onCancel={() => confirmCancel(o)}
                />
              ))}
            </View>
          )
        ) : tab === 'balances' ? (
          visibleBalances.length > 0 ? (
            <View style={styles.list}>
              {visibleBalances.map((b) => (
                <SpotCard
                  key={b.coin}
                  b={b}
                  instrument={instrumentForCoin(b.coin)}
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
        ) : (fills?.length ?? 0) === 0 ? (
          <View style={styles.noPositions}>
            <AppText variant="body" muted>
              No trade history
            </AppText>
          </View>
        ) : (
          <View style={styles.list}>
            {fills!.map((f) => (
              <FillCard
                key={f.key}
                f={f}
                instrument={instrumentForCoin(f.coin)}
                hidden={privacyMode}
                expanded={expanded.has('fill:' + f.key)}
                onToggle={() => toggleExpand('fill:' + f.key)}
              />
            ))}
          </View>
        )}

        {/* History remains available, but stays compact and below live positions/risk. */}
        <View style={styles.portfolioWrap}>
          <PortfolioCard
            key={sortedPositions.length > 0 ? 'portfolio-active' : 'portfolio-flat'}
            hidden={privacyMode}
            compact={sortedPositions.length > 0}
          />
        </View>

        {demo ? (
          <AppText variant="caption" muted style={styles.disclaimer}>
            Demo address — connect your own account in Settings to trade.
          </AppText>
        ) : null}
      </ScrollView>

      {/* Reviewed close sheet (reduce-only, live size prefilled). */}
      <TradeTicket
        key={
          closePosition && closeTicket
            ? `${closePosition.coin}-${closePosition.side}-${closePosition.size}-${closeTicket.type}-close`
            : 'closed'
        }
        visible={closeTicket !== null && closePosition !== null}
        onClose={() => setCloseTicket(null)}
        coin={closePosition?.coin ?? ''}
        symbol={
          closePosition
            ? instrumentForCoin(closePosition.coin)?.symbol ?? cleanCoin(closePosition.coin)
            : undefined
        }
        markPx={closePosition?.markPx ?? 0}
        priceDecimals={
          closePosition
            ? priceDecimalsFor(
                instrumentForCoin(closePosition.coin)?.priceDecimals ?? 6,
                closePosition.markPx,
              )
            : 2
        }
        initialSide={
          closePosition ? (closePosition.side === 'long' ? 'sell' : 'buy') : undefined
        }
        initialType={closeTicket?.type ?? 'market'}
        initialSizeCoin={closePosition?.size}
        closing
      />

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
        cancelBusy={cancelMutation.isPending}
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

const MAINTENANCE_WARNING_PCT = 50;
const MAINTENANCE_URGENT_PCT = 75;
const LIQUIDATION_WARNING_PCT = 20;
const LIQUIDATION_URGENT_PCT = 10;
const LEVERAGE_WARNING = 5;

function riskUsd(value: number): string {
  return '$' + formatCompact(Math.abs(value));
}

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
  const hasWarning =
    maintenanceWarning ||
    liquidationWarning ||
    (summary.effectiveLeverage ?? 0) >= LEVERAGE_WARNING;
  const mask = (value: string) => (hidden ? MASK : value);

  return (
    <View style={styles.riskCard}>
      <View style={styles.riskHead}>
        <View style={styles.riskTitleRow}>
          <Ionicons
            name={hasWarning ? 'warning-outline' : 'shield-checkmark-outline'}
            size={16}
            color={hasWarning ? Colors.warning : Colors.up}
          />
          <AppText variant="label">Live risk</AppText>
        </View>
        <View
          style={[
            styles.maintenanceBadge,
            maintenanceWarning && styles.maintenanceBadgeWarning,
            maintenanceUrgent && styles.maintenanceBadgeUrgent,
          ]}>
          <AppText
            variant="caption"
            numeric
            color={maintenanceUrgent ? Colors.down : maintenanceWarning ? Colors.warning : Colors.textMuted}>
            Maintenance {maintenance == null ? '—' : mask(`${maintenance.toFixed(1)}%`)}
          </AppText>
        </View>
      </View>

      <View style={styles.riskMetrics}>
        <RiskMetric label="Free collateral" value={mask(riskUsd(summary.freeCollateral))} />
        <RiskMetric
          label="Exposure"
          value={mask(riskUsd(summary.totalExposure))}
          sub={
            summary.effectiveLeverage == null
              ? '—'
              : mask(`${summary.effectiveLeverage.toFixed(1)}× equity`)
          }
        />
        <RiskMetric
          label="Closest liq."
          value={liquidation ? mask(`${liquidation.distancePct.toFixed(1)}%`) : '—'}
          sub={liquidation ? (hidden ? MASK : cleanCoin(liquidation.coin)) : 'No liq. price'}
          color={liquidationUrgent ? Colors.down : liquidationWarning ? Colors.warning : undefined}
        />
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
        variant="label"
        numeric
        color={color}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}>
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
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <AppText variant="label" color={active ? Colors.text : Colors.textMuted}>
        {label}
      </AppText>
      <View style={[styles.tabCount, active && styles.tabCountActive]}>
        <AppText variant="caption" color={active ? Colors.text : Colors.textFaint}>
          {count}
        </AppText>
      </View>
    </Pressable>
  );
}

// Memoized so a 5s account refetch only re-renders positions whose data actually
// changed (React Query structural-shares unchanged rows). The inline callbacks close
// over stable ids, so their identity is deliberately excluded from the comparison.
const PositionCard = memo(PositionCardImpl, (prev, next) =>
  prev.p === next.p &&
  prev.instrument?.id === next.instrument?.id &&
  prev.expanded === next.expanded &&
  prev.tradable === next.tradable &&
  prev.busy === next.busy &&
  prev.hidden === next.hidden,
);

function PositionCardImpl({
  p,
  instrument,
  expanded,
  tradable,
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
  expanded: boolean;
  tradable: boolean;
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
                {p.side === 'long' ? 'Long' : 'Short'} {p.leverage}x
              </AppText>
            </View>
            {p.dex === 'xyz' ? (
              <View style={styles.xyzBadge}>
                <AppText variant="caption" muted>
                  xyz
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText style={styles.sub} numeric numberOfLines={1}>
            {hidden ? `${symbol} · ${MASK}` : `${qty(p.size)} ${symbol} · ${usd(p.positionValue)}`}
          </AppText>
        </View>

        {busy ? (
          <ActivityIndicator color={Colors.textMuted} />
        ) : (
          <View style={styles.right}>
            <AppText style={[styles.pnl, { color: pnlColor }]} numeric numberOfLines={1}>
              {m(signedUsd(p.unrealizedPnl))}
            </AppText>
            <AppText style={[styles.roe, { color: pnlColor }]} numeric numberOfLines={1}>
              {m(formatPercent(p.roe * 100))}
            </AppText>
          </View>
        )}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.textFaint}
          style={styles.chevron}
        />
      </Pressable>

      <View style={styles.quickActions}>
        <PositionQuickAction icon="stats-chart-outline" label="Chart" onPress={onChart} />
        <PositionQuickAction
          icon="shield-half-outline"
          label="TP / SL"
          onPress={onSetTpSl}
          disabled={!tradable || busy}
          tone={Colors.accent}
        />
        <PositionQuickAction
          icon="remove-circle-outline"
          label="Close"
          onPress={onMarketClose}
          disabled={!tradable || busy}
          tone={Colors.down}
        />
      </View>

      {expanded ? (
        <View style={styles.detail}>
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
            <Cell label="Size" value={m(`${qty(p.size)} ${symbol}`)} />
            <Cell
              label="Margin"
              value={m(usd(p.marginUsed))}
              sub={p.leverageType === 'isolated' ? 'Isolated' : 'Cross'}
              onEdit={p.leverageType === 'isolated' ? onAdjustMargin : undefined}
            />
            <Cell
              label="Funding"
              value={m(signedUsd(p.funding))}
              color={p.funding > 0 ? Colors.up : p.funding < 0 ? Colors.down : undefined}
            />
          </View>

          <View style={styles.actions}>
            <ActionBtn
              label="Market Close"
              onPress={onMarketClose}
              disabled={!tradable || busy}
              tone={Colors.down}
            />
            <ActionBtn label="Reverse" onPress={onReverse} disabled={!tradable || busy} />
          </View>

          {!tradable ? (
            <AppText variant="caption" color={Colors.warning} style={styles.actionHint}>
              Add an API wallet key in Settings to close or reverse positions.
            </AppText>
          ) : null}

          <Pressable style={styles.chartLink} onPress={onChart} hitSlop={6}>
            <AppText variant="caption" color={Colors.accent}>
              View chart
            </AppText>
            <Ionicons name="chevron-forward" size={13} color={Colors.accent} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function PositionQuickAction({
  icon,
  label,
  onPress,
  disabled = false,
  tone = Colors.textMuted,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: string;
}) {
  const color = disabled ? Colors.textFaint : tone;
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
      <Ionicons name={icon} size={14} color={color} />
      <AppText variant="caption" color={color}>
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
      <AppText variant="label" numeric color={color} numberOfLines={1} style={styles.cellValue}>
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

function ActionBtn({
  label,
  onPress,
  disabled,
  tone = Colors.accent,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.actionBtn, pressed && !disabled && styles.actionBtnPressed]}
      onPress={onPress}
      disabled={disabled}>
      <AppText variant="label" color={disabled ? Colors.textFaint : tone}>
        {label}
      </AppText>
    </Pressable>
  );
}

const SpotCard = memo(SpotCardImpl, (prev, next) =>
  prev.b === next.b &&
  prev.instrument?.id === next.instrument?.id &&
  prev.expanded === next.expanded &&
  prev.hidden === next.hidden,
);

function SpotCardImpl({
  b,
  instrument,
  expanded,
  hidden,
  onToggle,
  onChart,
}: {
  b: HlSpotBalance;
  instrument: Instrument | undefined;
  expanded: boolean;
  hidden: boolean;
  onToggle: () => void;
  onChart: () => void;
}) {
  // Derived per-token price; USDC ≈ $1, others off the spot mid.
  const price = b.total > 1e-9 ? b.usdValue / b.total : 0;
  const m = (s: string) => (hidden ? MASK : s);
  const coinAmt = (v: number) => `${tokenAmt(v)} ${b.coin}`;
  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
        onPress={onToggle}>
        <SymbolLogo instrument={instrument} coin={b.coin} size={40} />
        <View style={styles.mid}>
          <AppText style={styles.symbol} numberOfLines={1}>
            {b.coin}
          </AppText>
          {/* Collapsed: just the token amount — "available" lives in the detail so nothing truncates. */}
          <AppText style={styles.sub} numeric numberOfLines={1}>
            {hidden ? `${MASK} ${b.coin}` : coinAmt(b.total)}
          </AppText>
        </View>
        <AppText style={styles.spotValue} numeric numberOfLines={1}>
          {m(usd(b.usdValue))}
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
          <DetailRow label="Total" value={hidden ? `${MASK} ${b.coin}` : coinAmt(b.total)} />
          <DetailRow label="Available" value={hidden ? `${MASK} ${b.coin}` : coinAmt(b.available)} />
          {b.hold > 1e-8 ? (
            <DetailRow label="In Orders" value={hidden ? `${MASK} ${b.coin}` : coinAmt(b.hold)} />
          ) : null}
          <DetailRow label="Price" value={usd(price)} />
          <DetailRow label="USD Value" value={m(usd(b.usdValue))} strong />
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
  prev.tradable === next.tradable &&
  prev.busy === next.busy &&
  prev.hidden === next.hidden,
);

function OrderCardImpl({
  o,
  instrument,
  tradable,
  busy,
  hidden,
  onCancel,
}: {
  o: HlOpenOrder;
  instrument: Instrument | undefined;
  tradable: boolean;
  busy: boolean;
  hidden: boolean;
  onCancel: () => void;
}) {
  const symbol = instrument?.symbol ?? cleanCoin(o.coin);
  const decimals = priceDecimalsFor(instrument?.priceDecimals ?? 6, o.limitPx);
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
  prev.hidden === next.hidden &&
  prev.expanded === next.expanded,
);

function FillCardImpl({
  f,
  instrument,
  hidden,
  expanded,
  onToggle,
}: {
  f: HlFill;
  instrument: Instrument | undefined;
  hidden: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const symbol = instrument?.symbol ?? cleanCoin(f.coin);
  const decimals = priceDecimalsFor(instrument?.priceDecimals ?? 6, f.px);
  const sideColor = f.side === 'buy' ? Colors.up : Colors.down;
  const pnlColor = f.closedPnl >= 0 ? Colors.up : Colors.down;
  const m = (s: string) => (hidden ? MASK : s);

  const isXyz = f.coin.startsWith('xyz:');
  const tradeValue = f.px * f.size;
  const isRebate = f.fee < 0;
  // Fee shown as its P&L impact: a paid fee is negative, a maker rebate positive.
  const feeText = signMoneyExact(-f.fee);
  const netPnl = f.closedPnl - f.fee;
  const netColor = netPnl >= 0 ? Colors.up : Colors.down;
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
            {m(signedUsd(netPnl))}
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
              value={showPnl ? m(signMoneyExact(f.closedPnl)) : '—'}
              color={showPnl ? pnlColor : undefined}
              sub={showPnl ? 'before fees' : undefined}
            />
            <Cell
              label="Net PnL"
              value={showPnl ? m(signMoneyExact(netPnl)) : '—'}
              color={showPnl ? netColor : undefined}
              sub={showPnl ? 'after fees' : undefined}
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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  scroll: { paddingBottom: Spacing.xxl },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { marginTop: Spacing.sm },
  emptyBody: { textAlign: 'center', maxWidth: 300 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
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
  balanceCard: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.md },
  balanceLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  equity: { marginTop: 2 },
  pnlRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },

  riskCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  riskHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  riskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  maintenanceBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceAlt,
  },
  maintenanceBadgeWarning: { backgroundColor: Colors.warning + '14' },
  maintenanceBadgeUrgent: { backgroundColor: Colors.down + '16' },
  riskMetrics: {
    flexDirection: 'row',
    gap: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.border,
  },
  riskMetric: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceAlt,
    gap: 2,
  },
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

  tabBarWrap: {
    marginTop: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  tabBar: {
    flexDirection: 'row',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  tabActive: { borderBottomColor: Colors.accent },
  tabCount: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
  },
  tabCountActive: { backgroundColor: Colors.accentSoft },
  noPositions: { padding: Spacing.xl, alignItems: 'center' },

  // Rows mirror the main watchlist (SymbolRow): full-width hairline, logo 40,
  // 16/700 symbol, 16/600 value, 13px muted sub.
  list: {},
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
  symbol: { fontSize: 16, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 13, color: Colors.textMuted },
  sideBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.sm },
  xyzBadge: { backgroundColor: Colors.surfaceAlt, paddingHorizontal: 5, paddingVertical: 1, borderRadius: Radius.sm },
  right: { alignItems: 'flex-end', marginLeft: Spacing.sm, gap: 2 },
  pnl: { fontSize: 16, fontWeight: '600' },
  roe: { fontSize: 13, fontWeight: '500' },
  spotValue: { fontSize: 16, fontWeight: '600', color: Colors.text, marginLeft: Spacing.sm },
  chevron: { marginLeft: Spacing.sm },
  quickActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  quickAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
  },

  // Expanded detail
  detail: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.md },
  gridRow: { flexDirection: 'row' },
  cell: { flex: 1, gap: 2 },
  spotDetail: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, paddingBottom: Spacing.md },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  cellValue: { marginTop: 1 },
  cellValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
  },
  actionBtnPressed: { backgroundColor: Colors.surfacePress },
  cancelBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    marginLeft: Spacing.sm,
  },
  actionHint: { marginTop: -Spacing.xs },
  chartLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: Spacing.xs },

  portfolioWrap: { paddingHorizontal: Spacing.lg, marginTop: Spacing.xl },
  disclaimer: { textAlign: 'center', marginTop: Spacing.lg },
});
