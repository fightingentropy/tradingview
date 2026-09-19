import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';

import { MarginSheet } from '@/components/MarginSheet';
import { OrderRecoveryNotice } from '@/components/OrderRecoveryNotice';
import {
  TpSlSheet,
  type TpSlExistingOrder,
  type TpSlLegInput,
} from '@/components/TpSlSheet';
import { TradeTicket } from '@/components/TradeTicket';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors } from '@/constants/theme';
import {
  useHlAccount,
  useHlFills,
  useHlHistoricalOrders,
  useHlOpenOrders,
  useTradingIdentity
} from '@/data/useHlAccount';
import { useHlAccountActivity, useHlBorrowLendInterest, useHlUserFunding } from '@/data/useHlHistory';
import { useHlMeta } from '@/data/useHlMeta';
import { useAllMarkets } from '@/data/useMarkets';
import type { Instrument } from '@/domain/types';
import {
  buildAccountRiskSummary,
  isProtectiveStop
} from '@/lib/accountRisk';
import { formatPrice, priceDecimalsFor, usd } from '@/lib/format';
import {
  cancelOrder,
  marketClose,
  OrderRejectedError,
  placePositionTpSl,
  reversePosition,
  updateIsolatedMargin,
  type OrderResult,
} from '@/lib/hyperliquid/exchange';
import type {
  HlOpenOrder,
  HlPosition
} from '@/lib/hyperliquid/info';
import { fetchHlAccount, fetchOpenOrders } from '@/lib/hyperliquid/info';
import { priceToWire, sizeToWire } from '@/lib/hyperliquid/sign';
import {
  assertTradingIdentityCurrent,
  signedIdentityBinding,
  TradingIdentityError,
  type SignedTradingIdentityBinding,
} from '@/lib/hyperliquid/tradingIdentity';
import { queryKeys } from '@/lib/queryKeys';
import { DEMO_ADDRESS, useHlConnection } from '@/store/hlConnection';
import { SMALL_BALANCE_USD, usePreferences } from '@/store/preferences';

import { AccountReadStatus, FillCard, FundingHistoryCard, HistoryEmpty, HistoryError, HistoryIntro, HistoryLoading, InterestHistoryCard, OrderCard, PositionCard, RiskStrip, SpotCard, TabButton } from '@/components/account/AccountRows';
import { styles } from '@/components/account/accountStyles';
import { AccountSummary } from '@/components/account/AccountSummary';
import { AccountMutationStatusUnknownError, AccountPreflightError, cleanCoin, displayPriceDecimals, fullWhen, ISOLATED_MARGIN_BUFFER_USD, isolatedMarginRemovalSafetyLimit, LIQUIDATION_REVIEW_DRIFT_PCT, MARKET_ACTION_SLIPPAGE, marketCoinKey, MASK, orderAssetMeta, positionLiquidationDistancePct, PositionProtectionLevels, protectionAckIsAccepted, protectionAckLabel, protectionLevelsForPosition, ProtectionPreflightError, qty, tokenAmt } from '@/lib/accountPresentation';

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
  const tab = usePreferences((s) => s.accountTab);
  const setTab = usePreferences((s) => s.setAccountTab);
  const accountQuery = useHlAccount();
  const { data: account, isLoading, isFetching, refetch } = accountQuery;
  const identityQuery = useTradingIdentity();
  const { data: tradingIdentity } = identityQuery;
  const executionIdentity = signedIdentityBinding(tradingIdentity);
  const ordersQuery = useHlOpenOrders();
  const { data: openOrders } = ordersQuery;
    const fillsQuery = useHlFills(tab === 'history');
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
            Your positions, orders, and balances in one place.
          </AppText>
          <Pressable style={styles.primaryBtn} onPress={() => router.navigate('/settings')}>
            <Ionicons name="link" size={16} color={Colors.background} />
            <AppText variant="label" color={Colors.background}>Connect account</AppText>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => connectDemo(DEMO_ADDRESS)} style={styles.demoLink}>
            <AppText variant="label" color={Colors.accent}>
              Preview account
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


  return (
    <Screen>
      <ScrollView testID="account-screen" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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

        <AccountSummary account={account} riskSummary={openOrders !== undefined ? riskSummary ?? undefined : undefined} address={tradingIdentity?.accountAddress ?? address} refreshing={isFetching} onRefresh={() => { void refetch(); void ordersQuery.refetch(); }} />
        {openOrders !== undefined ? <RiskStrip compact summary={riskSummary!} hidden={privacyMode} /> : null}
        {ordersQuery.isError ? <AccountReadStatus label="orders" query={ordersQuery} freshForMs={20_000} /> : null}

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
              label="Open orders"
              count={openOrders?.length}
              active={tab === 'orders'}
              onPress={() => setTab('orders')}
            />
            <TabButton
              label="Balances"
              count={account.spotBalancesLoaded ? visibleBalances.length : undefined}
              active={tab === 'balances'}
              onPress={() => setTab('balances')}
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
