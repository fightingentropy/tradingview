import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
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
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  useHlAccount,
  useHlLegalCheck,
  useTradingIdentity,
} from '@/data/useHlAccount';
import { useOutcomeMarkets } from '@/data/useMarkets';
import { useOrderBook } from '@/data/useOrderBook';
import { estimateExecution } from '@/domain/execution';
import { formatPrice, usd } from '@/lib/format';
import { placeOrder, type OrderResult } from '@/lib/hyperliquid/exchange';
import { fetchLegalCheck, type HlAccount, type HlOrderBook, type HlNetwork } from '@/lib/hyperliquid/info';
import {
  assertTradingIdentityCurrent,
  signedIdentityBinding,
  type SignedTradingIdentityBinding,
} from '@/lib/hyperliquid/tradingIdentity';
import type { OutcomeChoice, OutcomeEvent, OutcomeTradeContract } from '@/lib/outcomeMarkets';
import { storage } from '@/lib/mmkv';
import {
  OUTCOME_MARKET_SLIPPAGE,
  OUTCOME_MAX_PRICE,
  OUTCOME_MIN_NOTIONAL,
  OUTCOME_MIN_PRICE,
  OUTCOME_SIZE_DECIMALS,
  isOutcomeTradingAllowed,
  meetsOutcomeMinimumNotional,
  outcomeMarketIocPrice,
  outcomeOrderNotional,
  outcomeSharesFromQuote,
  wholeOutcomeShares,
} from '@/lib/outcomeTrading';
import { queryKeys } from '@/lib/queryKeys';
import {
  shouldDismissTradeTicket,
  shouldStartTradeTicketDismiss,
} from '@/lib/tradeTicket';
import { useHlConnection } from '@/store/hlConnection';

type TradeAction = 'buy' | 'sell';
type OrderType = 'market' | 'limit';
type AmountUnit = 'shares' | 'quote';
type Stage = 'form' | 'review' | 'result';

interface OutcomeTradeDraft {
  readonly eventId: string;
  readonly choiceId: string;
  readonly choiceLabel: string;
  readonly contract: Readonly<OutcomeTradeContract>;
  readonly action: TradeAction;
  readonly orderType: OrderType;
  readonly shares: number;
  readonly expectedPrice: number;
  readonly wirePrice: number;
  readonly estimatedNotional: number;
  readonly network: HlNetwork;
  readonly connectionAddress: string | null;
  readonly identity: SignedTradingIdentityBinding;
}

interface OutcomeSubmission {
  readonly draft: OutcomeTradeDraft;
  readonly result: OrderResult;
}

class OutcomeTradePreflightError extends Error {
  override name = 'OutcomeTradePreflightError';
}

class OutcomeTradeStatusUnknownError extends Error {
  override name = 'OutcomeTradeStatusUnknownError';
}

// A lost exchange response may still have produced a real order. Keep that
// account/contract/action locked for the lifetime of the app until the user
// explicitly confirms they checked Orders and History.
const UNCERTAIN_OUTCOME_ORDERS_KEY = 'outcome-orders-requiring-reconciliation-v1';

function loadUncertainOutcomeOrders(): Set<string> {
  try {
    const parsed = JSON.parse(storage.getString(UNCERTAIN_OUTCOME_ORDERS_KEY) ?? '[]');
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

const uncertainOutcomeOrders = loadUncertainOutcomeOrders();

function setOutcomeOrderReconciliationLock(key: string, locked: boolean): void {
  if (locked) uncertainOutcomeOrders.add(key);
  else uncertainOutcomeOrders.delete(key);
  storage.set(UNCERTAIN_OUTCOME_ORDERS_KEY, JSON.stringify([...uncertainOutcomeOrders]));
}

function outcomeOrderLockKey({
  accountAddress,
  network,
  assetId,
  action,
}: {
  accountAddress: string | null | undefined;
  network: HlNetwork;
  assetId: number | null | undefined;
  action: TradeAction;
}): string | null {
  if (!accountAddress || assetId == null) return null;
  return `${network}:${accountAddress.toLowerCase()}:${assetId}:${action}`;
}

function safeOutcomeBuyCapacity(account: HlAccount | undefined): number {
  return account?.spotBalancesLoaded &&
    account.spendableUsdcLoaded &&
    Number.isFinite(account.spendableUsdc)
    ? Math.max(0, account.spendableUsdc)
    : 0;
}

export interface OutcomeOrderTicketProps {
  visible: boolean;
  onClose: () => void;
  event: OutcomeEvent;
  choice: OutcomeChoice;
  initialAction?: TradeAction;
}

const ACCESSORY_ID = 'outcome-order-ticket-kb';
const LIQUID_GLASS = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
const GLASS_FILL = 'rgba(255,255,255,0.06)';
const GLASS_FILL_STRONG = 'rgba(255,255,255,0.13)';
const HAIRLINE = 'rgba(255,255,255,0.11)';

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

function numberInput(value: string): number {
  const parsed = Number(value.replace(/,/g, '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: number | null | undefined): string {
  if (!(value != null && Number.isFinite(value) && value > 0)) return '—';
  const amount = value * 100;
  return `${amount.toFixed(amount < 1 ? 3 : 2)}¢`;
}

function sharesLabel(value: number): string {
  return `${Math.floor(value).toLocaleString('en-US')} share${Math.floor(value) === 1 ? '' : 's'}`;
}

function outcomeBalance(account: HlAccount | undefined, tokenName: string): number {
  return account?.spotBalances.find((balance) => balance.coin === tokenName)?.available ?? 0;
}

function fillableWithinCap(
  book: HlOrderBook | undefined,
  isBuy: boolean,
  cap: number,
  requested: number,
): number {
  if (!book || !(requested > 0)) return 0;
  const levels = isBuy ? book.asks : book.bids;
  let fillable = 0;
  for (const level of levels) {
    const inside = isBuy ? level.price <= cap : level.price >= cap;
    if (!inside) continue;
    fillable += level.size;
    if (fillable >= requested) break;
  }
  return fillable;
}

function legalReason(
  network: HlNetwork,
  legal: ReturnType<typeof useHlLegalCheck>,
): string | null {
  if (network !== 'mainnet') {
    return 'This Outcomes catalog is mainnet-only. Switch the connected account to Mainnet.';
  }
  if (legal.isLoading || legal.isFetching) return 'Checking Hyperliquid trading eligibility…';
  if (legal.isError || !legal.data) {
    return 'Outcome trading stays disabled until Hyperliquid eligibility can be verified.';
  }
  if (!legal.data.acceptedTerms) {
    return 'Accept the current Hyperliquid terms before placing an Outcome order.';
  }
  if (!legal.data.userAllowed || legal.data.restrictions === 'a') {
    return 'Hyperliquid has disabled trading actions for this account or connection.';
  }
  if (legal.data.restrictions === 'u') {
    return 'Hyperliquid currently restricts Outcome trading from the United Kingdom.';
  }
  if (legal.data.restrictions === 'o') {
    return 'Hyperliquid currently restricts Outcome markets for this location.';
  }
  if (!isOutcomeTradingAllowed(legal.data)) {
    return 'Hyperliquid did not return an unrestricted Outcome-trading status.';
  }
  return null;
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <AppText variant="caption" muted>{label}</AppText>
      <AppText style={[styles.summaryValue, strong && styles.summaryStrong]} numeric>
        {value}
      </AppText>
    </View>
  );
}

export function OutcomeOrderTicket({
  visible,
  onClose,
  event,
  choice,
  initialAction = 'buy',
}: OutcomeOrderTicketProps) {
  const qc = useQueryClient();
  const network = useHlConnection((state) => state.network);
  const connectionAddress = useHlConnection((state) => state.address);
  const hasKey = useHlConnection((state) => state.hasKey);
  const demo = useHlConnection((state) => state.demo);
  const { data: identityData, isLoading: identityLoading, isError: identityError } =
    useTradingIdentity();
  const identity = signedIdentityBinding(identityData);
  const { data: account, isLoading: accountLoading, refetch: refetchAccount } = useHlAccount();
  const legal = useHlLegalCheck();
  const { data: outcomes, refetch: refetchOutcomes } = useOutcomeMarkets();

  const [stage, setStage] = useState<Stage>('form');
  const [action, setAction] = useState<TradeAction>(initialAction);
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [amountUnit, setAmountUnit] = useState<AmountUnit>('shares');
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [contractSide, setContractSide] = useState(choice.side);
  const [draft, setDraft] = useState<OutcomeTradeDraft | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reconciliationLock, setReconciliationLock] = useState<string | null>(null);
  const [sheetTranslateY] = useState(() => new Animated.Value(0));
  const [sheetAtTop, setSheetAtTop] = useState(true);

  const liveEvent = outcomes?.outcomeEvents.find((candidate) => candidate.id === event.id) ?? event;
  const liveChoice = liveEvent.choices.find((candidate) => candidate.id === choice.id) ?? choice;
  const contract =
    liveChoice.tradeContracts.find((candidate) => candidate.side === contractSide) ??
    liveChoice.tradeContracts[0];

  const { data: orderBook, isLoading: bookLoading, refetch: refetchOrderBook } = useOrderBook(
    visible && network === 'mainnet' ? contract?.coinKey : undefined,
  );

  const liveContextRef = useRef({
    visible,
    eventId: event.id,
    choiceId: choice.id,
    contractSide,
    mounted: true,
  });
  useEffect(() => {
    liveContextRef.current = {
      visible,
      eventId: event.id,
      choiceId: choice.id,
      contractSide,
      mounted: true,
    };
    return () => {
      liveContextRef.current.mounted = false;
    };
  }, [visible, event.id, choice.id, contractSide]);

  const isBuy = action === 'buy';
  const bestBid = orderBook?.bids[0]?.price ?? null;
  const bestAsk = orderBook?.asks[0]?.price ?? null;
  const touchPrice = isBuy ? bestAsk : bestBid;
  const limitNumber = numberInput(limitPrice);
  const midpoint =
    bestBid != null && bestAsk != null
      ? (bestBid + bestAsk) / 2
      : (contract?.probability ?? null);
  const marketIocPrice =
    orderType === 'market' && midpoint
      ? outcomeMarketIocPrice(midpoint, isBuy, OUTCOME_MARKET_SLIPPAGE)
      : null;
  const wirePrice = orderType === 'limit' ? limitNumber : (marketIocPrice ?? 0);
  const shares =
    amountUnit === 'shares'
      ? wholeOutcomeShares(numberInput(amount))
      : outcomeSharesFromQuote(numberInput(amount), wirePrice);
  const execution = estimateExecution(orderBook, isBuy, shares);
  const expectedPrice =
    orderType === 'limit'
      ? limitNumber
      : (execution?.averagePrice ?? touchPrice ?? contract?.probability ?? 0);
  const expectedNotional = outcomeOrderNotional(shares, expectedPrice);
  const wireNotional = outcomeOrderNotional(shares, wirePrice);
  const sellAvailable = contract ? outcomeBalance(account, contract.tokenName) : 0;
  const buyAvailable = safeOutcomeBuyCapacity(account);
  const capacityShares =
    wirePrice > 0
      ? isBuy
        ? wholeOutcomeShares((buyAvailable * 0.995) / wirePrice)
        : wholeOutcomeShares(sellAvailable)
      : 0;
  const withinBalance = isBuy
    ? wireNotional <= buyAvailable * 0.995
    : shares <= sellAvailable;
  const visibleCapDepth =
    orderType === 'market' && marketIocPrice
      ? fillableWithinCap(orderBook, isBuy, marketIocPrice, shares)
      : shares;
  const sufficientCapDepth = orderType === 'limit' || visibleCapDepth >= shares;
  const iocCrossesTouch =
    touchPrice != null && marketIocPrice != null &&
    (isBuy ? marketIocPrice >= touchPrice : marketIocPrice <= touchPrice);
  const priceValid =
    orderType === 'market'
      ? iocCrossesTouch
      : limitNumber >= OUTCOME_MIN_PRICE && limitNumber <= OUTCOME_MAX_PRICE;
  const minimumMet = meetsOutcomeMinimumNotional(shares, wirePrice);
  const regionReason = legalReason(network, legal);
  const accountReady = !!account && account.spotBalancesLoaded;
  const currentLockKey = outcomeOrderLockKey({
    accountAddress: identity?.accountAddress,
    network,
    assetId: contract?.assetId,
    action,
  });
  const requiresReconciliation =
    currentLockKey != null &&
    (reconciliationLock === currentLockKey || uncertainOutcomeOrders.has(currentLockKey));

  const unavailableReason = (() => {
    if (demo) return 'Connect your own account and verified API wallet to trade.';
    if (!connectionAddress) return 'Connect a Hyperliquid account to trade.';
    if (!hasKey) return 'Add a verified Hyperliquid API wallet key to trade.';
    if (identityLoading) return 'Verifying the API wallet and master account…';
    if (identityError || !identity) return 'The API wallet identity could not be verified.';
    if (regionReason) return regionReason;
    if (accountLoading) return 'Loading live spot balances…';
    if (!accountReady) return 'Spot balances could not be verified. Trading remains disabled.';
    if (!contract) return 'This Outcome contract is no longer active.';
    if (contract.quoteToken !== 'USDC') {
      return `${contract.quoteToken} quoted Outcomes are not supported yet. No order will be sent.`;
    }
    if (requiresReconciliation) {
      return 'A previous exchange response was not confirmed. Check Account → Orders and History before retrying.';
    }
    if (
      isBuy &&
      account &&
      (account.abstractionMode === 'portfolioMargin' || account.abstractionMode === 'dexAbstraction')
    ) {
      return 'Outcome buys stay disabled in this account mode because safe available-to-trade cannot be verified. Selling owned shares is still available.';
    }
    if (isBuy && account && !account.spendableUsdcLoaded) {
      return 'Outcome buys stay disabled until margin across every USDC-backed Hyperliquid venue can be verified.';
    }
    if (orderType === 'market' && bookLoading) return 'Loading the live order book…';
    if (!priceValid) return orderType === 'limit'
      ? 'Enter a price between 0.00001 and 0.99999.'
      : 'The live spread is outside the reviewed 8% midpoint bound.';
    if (!(shares > 0)) return 'Enter at least one whole share.';
    if (!minimumMet) return `Hyperliquid requires at least ${usd(OUTCOME_MIN_NOTIONAL)} of order value.`;
    if (!withinBalance) {
      return isBuy
        ? `Only ${usd(buyAvailable)} USDC is available.`
        : `Only ${Math.floor(sellAvailable).toLocaleString('en-US')} ${contract.sideLabel} shares are available.`;
    }
    if (!sufficientCapDepth) {
      return `Only ${Math.floor(visibleCapDepth).toLocaleString('en-US')} shares are visible inside the reviewed IOC cap.`;
    }
    return null;
  })();

  const assertContextStillMatches = (reviewed: OutcomeTradeDraft) => {
    const current = useHlConnection.getState();
    const live = liveContextRef.current;
    if (
      !live.mounted ||
      !live.visible ||
      live.eventId !== reviewed.eventId ||
      live.choiceId !== reviewed.choiceId ||
      live.contractSide !== reviewed.contract.side ||
      current.network !== reviewed.network ||
      current.address !== reviewed.connectionAddress
    ) {
      throw new OutcomeTradePreflightError(
        'The account, network, event, or selected side changed after review. No order was sent.',
      );
    }
    assertTradingIdentityCurrent(reviewed.identity, current);
  };

  const validateDraft = async (reviewed: OutcomeTradeDraft) => {
    assertContextStillMatches(reviewed);
    if (reviewed.contract.quoteToken !== 'USDC') {
      throw new OutcomeTradePreflightError(
        'This Outcome is not quoted in USDC. No order was sent.',
      );
    }
    const [freshLegal, accountQuery, outcomesQuery, bookQuery] = await Promise.all([
      fetchLegalCheck(reviewed.identity.accountAddress, reviewed.network),
      refetchAccount(),
      refetchOutcomes(),
      reviewed.orderType === 'market' ? refetchOrderBook() : Promise.resolve(null),
    ]);
    if (!isOutcomeTradingAllowed(freshLegal)) {
      throw new OutcomeTradePreflightError(
        'Hyperliquid no longer reports this account and connection as eligible for Outcome trading.',
      );
    }
    const freshAccount = accountQuery.data;
    if (accountQuery.isError || !freshAccount?.spotBalancesLoaded) {
      throw new OutcomeTradePreflightError('Could not refresh verified spot balances. No order was sent.');
    }
    const freshEvent = outcomesQuery.data?.outcomeEvents.find(
      (candidate) => candidate.id === reviewed.eventId,
    );
    const freshChoice = freshEvent?.choices.find(
      (candidate) => candidate.id === reviewed.choiceId,
    );
    const freshContract = freshChoice?.tradeContracts.find(
      (candidate) => candidate.side === reviewed.contract.side,
    );
    if (
      !freshContract ||
      freshContract.outcomeId !== reviewed.contract.outcomeId ||
      freshContract.assetId !== reviewed.contract.assetId ||
      freshContract.coinKey !== reviewed.contract.coinKey ||
      freshContract.quoteToken !== 'USDC'
    ) {
      throw new OutcomeTradePreflightError(
        'This Outcome rolled, settled, or changed after review. Refresh it before trading.',
      );
    }
    if (reviewed.action === 'buy') {
      if (!freshAccount.spendableUsdcLoaded) {
        throw new OutcomeTradePreflightError(
          'Could not refresh margin across every USDC-backed Hyperliquid venue. No order was sent.',
        );
      }
      const maximumCost = outcomeOrderNotional(reviewed.shares, reviewed.wirePrice);
      if (safeOutcomeBuyCapacity(freshAccount) * 0.995 + 1e-9 < maximumCost) {
        throw new OutcomeTradePreflightError(
          'Safe available-to-trade USDC changed after review. No order was sent.',
        );
      }
    } else if (
      outcomeBalance(freshAccount, reviewed.contract.tokenName) + 1e-9 < reviewed.shares
    ) {
      throw new OutcomeTradePreflightError('Available Outcome shares changed after review. No order was sent.');
    }
    if (reviewed.orderType === 'market') {
      const freshBook = bookQuery?.data;
      const freshTouch =
        reviewed.action === 'buy' ? freshBook?.asks[0]?.price : freshBook?.bids[0]?.price;
      const stillCrosses =
        freshTouch != null &&
        (reviewed.action === 'buy'
          ? freshTouch <= reviewed.wirePrice
          : freshTouch >= reviewed.wirePrice);
      const fillable = fillableWithinCap(
        freshBook,
        reviewed.action === 'buy',
        reviewed.wirePrice,
        reviewed.shares,
      );
      if (!stillCrosses || fillable + 1e-9 < reviewed.shares) {
        throw new OutcomeTradePreflightError(
          'The live book moved beyond the reviewed IOC cap. Review the order again.',
        );
      }
    }
    assertContextStillMatches(reviewed);
  };

  const mutation = useMutation<OutcomeSubmission, unknown, OutcomeTradeDraft>({
    mutationFn: async (reviewed) => {
      let postAttempted = false;
      try {
        await validateDraft(reviewed);
        const result = await placeOrder({
          network: reviewed.network,
          identity: reviewed.identity,
          validateImmediatelyBeforeSigning: () => validateDraft(reviewed),
          assertIdentityCurrent: () => assertContextStillMatches(reviewed),
          assetIndex: reviewed.contract.assetId,
          szDecimals: OUTCOME_SIZE_DECIMALS,
          priceKind: 'spot',
          isBuy: reviewed.action === 'buy',
          size: reviewed.shares,
          reduceOnly: false,
          limitPrice: reviewed.orderType === 'limit' ? reviewed.wirePrice : undefined,
          marketIocPrice: reviewed.orderType === 'market' ? reviewed.wirePrice : undefined,
          onPostAttempt: () => {
            postAttempted = true;
            const key = outcomeOrderLockKey({
              accountAddress: reviewed.identity.accountAddress,
              network: reviewed.network,
              assetId: reviewed.contract.assetId,
              action: reviewed.action,
            });
            if (key) {
              // Persist before the HTTP request starts so a crash or force-quit
              // cannot make an uncertain real order look safely retryable.
              setOutcomeOrderReconciliationLock(key, true);
              setReconciliationLock(key);
            }
          },
        });
        if (result.status !== 'filled' && result.status !== 'resting') {
          throw new OutcomeTradeStatusUnknownError(
            'Hyperliquid acknowledged the request without a final filled or resting status.',
          );
        }
        return { draft: reviewed, result };
      } catch (error) {
        if (postAttempted) {
          throw new OutcomeTradeStatusUnknownError(
            `${error instanceof Error ? error.message : 'The exchange response was not confirmed.'}\n\nCheck Orders and History before retrying.`,
          );
        }
        if (error instanceof OutcomeTradePreflightError) throw error;
        throw new OutcomeTradePreflightError(
          error instanceof Error ? error.message : 'The Outcome order was not sent.',
        );
      }
    },
    onSuccess: ({ draft: completedDraft }) => {
      const key = outcomeOrderLockKey({
        accountAddress: completedDraft.identity.accountAddress,
        network: completedDraft.network,
        assetId: completedDraft.contract.assetId,
        action: completedDraft.action,
      });
      if (key) setOutcomeOrderReconciliationLock(key, false);
      setSubmitError(null);
      setReconciliationLock(null);
      setStage('result');
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlFillsPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.instruments() });
      qc.invalidateQueries({ queryKey: ['hl', 'l2Book'] });
    },
    onError: (error, reviewed) => {
      if (error instanceof OutcomeTradeStatusUnknownError) {
        const key = outcomeOrderLockKey({
          accountAddress: reviewed.identity.accountAddress,
          network: reviewed.network,
          assetId: reviewed.contract.assetId,
          action: reviewed.action,
        });
        if (key) {
          setOutcomeOrderReconciliationLock(key, true);
          setReconciliationLock(key);
        }
      }
      setSubmitError(error instanceof Error ? error.message : 'The Outcome order was not sent.');
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlFillsPrefix() });
    },
  });

  const reviewOrder = () => {
    if (unavailableReason || !identity || !contract || !(wirePrice > 0)) return;
    Keyboard.dismiss();
    setSubmitError(null);
    setDraft(
      Object.freeze({
        eventId: liveEvent.id,
        choiceId: liveChoice.id,
        choiceLabel: liveChoice.label,
        contract: Object.freeze({ ...contract }),
        action,
        orderType,
        shares,
        expectedPrice,
        wirePrice,
        estimatedNotional: expectedNotional,
        network,
        connectionAddress,
        identity,
      }),
    );
    setSheetAtTop(true);
    setStage('review');
  };

  const acknowledgeReconciliation = () => {
    if (currentLockKey) setOutcomeOrderReconciliationLock(currentLockKey, false);
    // Empty is a deliberate state change when a newly mounted ticket inherited
    // its lock from the module-level set.
    setReconciliationLock('');
    setSubmitError(null);
    mutation.reset();
  };

  const applyCapacity = (fraction: number) => {
    const nextShares = wholeOutcomeShares(capacityShares * fraction);
    if (amountUnit === 'shares') {
      setAmount(nextShares > 0 ? String(nextShares) : '');
    } else {
      const value = nextShares * wirePrice;
      setAmount(value > 0 ? value.toFixed(2) : '');
    }
  };

  const animateClose = () => {
    if (mutation.isPending) return;
    Keyboard.dismiss();
    Animated.timing(sheetTranslateY, {
      toValue: 720,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      sheetTranslateY.setValue(0);
      onClose();
    });
  };

  const finishSheetDrag = (dy: number, velocityY: number) => {
    if (shouldDismissTradeTicket(dy, velocityY)) {
      animateClose();
      return;
    }
    Animated.spring(sheetTranslateY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 24,
      stiffness: 260,
      mass: 0.8,
    }).start();
  };

  const makePanResponder = (ignoreScrollOffset: boolean) => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      shouldStartTradeTicketDismiss(
        gesture.dx,
        gesture.dy,
        ignoreScrollOffset || sheetAtTop ? 0 : 2,
        mutation.isPending,
      ),
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      shouldStartTradeTicketDismiss(
        gesture.dx,
        gesture.dy,
        ignoreScrollOffset || sheetAtTop ? 0 : 2,
        mutation.isPending,
      ),
    onPanResponderGrant: () => {
      sheetTranslateY.stopAnimation();
      Keyboard.dismiss();
    },
    onPanResponderMove: (_event, gesture) => {
      sheetTranslateY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => finishSheetDrag(gesture.dy, gesture.vy),
    onPanResponderTerminate: (_event, gesture) => finishSheetDrag(gesture.dy, gesture.vy),
    onPanResponderTerminationRequest: () => false,
  });
  const panResponder = makePanResponder(false);
  const headerPanResponder = makePanResponder(true);

  const submission = mutation.data;
  const resultTitle = submission?.result.status === 'filled' ? 'Order filled' :
    submission?.result.status === 'resting' ? 'Limit order placed' : 'Order acknowledged';

  const renderForm = () => (
    <ScrollView
      {...panResponder.panHandlers}
      bounces={false}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      onScroll={(event) => {
        const atTop = event.nativeEvent.contentOffset.y <= 1;
        setSheetAtTop((current) => current === atTop ? current : atTop);
      }}
      scrollEventThrottle={16}>
      {liveChoice.tradeContracts.length > 1 ? (
        <View style={styles.segment}>
          {liveChoice.tradeContracts.map((candidate) => {
            const active = candidate.side === contract?.side;
            return (
              <Pressable
                key={candidate.coinKey}
                onPress={() => setContractSide(candidate.side)}
                style={[styles.segmentButton, active && styles.segmentButtonOn]}>
                <AppText style={[styles.segmentText, active && styles.segmentTextOn]}>
                  {candidate.sideLabel}
                </AppText>
                <AppText variant="caption" numeric color={active ? Colors.text : Colors.textMuted}>
                  {candidate.probability == null ? '—' : cents(candidate.probability)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.segment}>
        {(['buy', 'sell'] as const).map((item) => {
          const active = action === item;
          return (
            <Pressable
              key={item}
              onPress={() => setAction(item)}
              style={[
                styles.segmentButton,
                active && (item === 'buy' ? styles.buyOn : styles.sellOn),
              ]}>
              <AppText style={[styles.segmentText, active && styles.segmentTextOn]}>
                {item === 'buy' ? 'Buy' : 'Sell'} {contract?.sideLabel ?? ''}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.inlineTabs}>
        {(['market', 'limit'] as const).map((item) => (
          <Pressable
            key={item}
            onPress={() => setOrderType(item)}
            style={[styles.inlineTab, orderType === item && styles.inlineTabOn]}>
            <AppText style={[styles.inlineTabText, orderType === item && styles.inlineTabTextOn]}>
              {item === 'market' ? 'Market' : 'Limit'}
            </AppText>
          </Pressable>
        ))}
        <View style={styles.bookPrices}>
          <AppText variant="caption" muted numeric>Bid {cents(bestBid)}</AppText>
          <AppText variant="caption" muted numeric>Ask {cents(bestAsk)}</AppText>
        </View>
      </View>

      {orderType === 'limit' ? (
        <View style={styles.field}>
          <AppText variant="caption" muted>Limit price</AppText>
          <View style={styles.inputRow}>
            <TextInput
              value={limitPrice}
              onChangeText={setLimitPrice}
              placeholder={contract?.probability ? contract.probability.toFixed(5) : '0.50000'}
              placeholderTextColor={Colors.textFaint}
              keyboardType="decimal-pad"
              inputAccessoryViewID={ACCESSORY_ID}
              style={styles.input}
            />
            <AppText style={styles.inputUnit}>USDC</AppText>
            <Pressable
              onPress={() => {
                const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : contract?.probability;
                if (mid) setLimitPrice(formatPrice(mid, 5));
              }}
              style={styles.midButton}>
              <AppText variant="caption" color={Colors.text}>Mid</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.field}>
        <View style={styles.fieldHeader}>
          <AppText variant="caption" muted>Size</AppText>
          <AppText variant="caption" muted numeric>
            Available · {isBuy ? usd(buyAvailable) : `${Math.floor(sellAvailable).toLocaleString('en-US')} shares`}
          </AppText>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor={Colors.textFaint}
            keyboardType="decimal-pad"
            inputAccessoryViewID={ACCESSORY_ID}
            style={styles.input}
          />
          <Pressable
            onPress={() => setAmountUnit((current) => current === 'shares' ? 'quote' : 'shares')}
            style={styles.unitButton}>
            <AppText style={styles.inputUnit}>{amountUnit === 'shares' ? 'Shares' : 'USDC'}</AppText>
            <Ionicons name="chevron-down" size={14} color={Colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.quickRow}>
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <Pressable key={fraction} onPress={() => applyCapacity(fraction)} style={styles.quickButton}>
              <AppText variant="caption" color={Colors.textMuted}>
                {fraction === 1 ? 'Max' : `${fraction * 100}%`}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.summaryCard}>
        <SummaryRow label="Shares" value={shares > 0 ? sharesLabel(shares) : '—'} />
        <SummaryRow
          label={orderType === 'market' ? 'Estimated average' : 'Limit price'}
          value={expectedPrice > 0 ? `${cents(expectedPrice)} · $${formatPrice(expectedPrice, 5)}` : '—'}
        />
        {orderType === 'market' ? (
          <>
            <SummaryRow
              label="Reference midpoint"
              value={midpoint ? `${cents(midpoint)} · $${formatPrice(midpoint, 5)}` : '—'}
            />
            <SummaryRow
              label={isBuy ? 'Maximum IOC price' : 'Minimum IOC price'}
              value={marketIocPrice ? `${cents(marketIocPrice)} · 8% cap` : '—'}
            />
          </>
        ) : null}
        <SummaryRow label={isBuy ? 'Estimated cost' : 'Estimated proceeds'} value={expectedNotional > 0 ? usd(expectedNotional) : '—'} strong />
        {orderType === 'market' ? (
          <SummaryRow
            label={isBuy ? 'Maximum spend' : 'Minimum proceeds'}
            value={wireNotional > 0 ? usd(wireNotional) : '—'}
          />
        ) : null}
        {isBuy && shares > 0 ? (
          <>
            <SummaryRow label={`Payout if ${contract?.sideLabel ?? 'selected side'} wins`} value={usd(shares)} />
            <SummaryRow label="Potential profit" value={expectedNotional > 0 ? usd(Math.max(0, shares - expectedNotional)) : '—'} />
          </>
        ) : null}
        {orderType === 'market' && execution && !execution.sufficientDepth ? (
          <AppText variant="caption" color={Colors.down} style={styles.warning}>
            The visible book cannot fill the full size.
          </AppText>
        ) : null}
      </View>

      {unavailableReason ? (
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.textMuted} />
          <AppText variant="caption" muted style={styles.noticeText}>{unavailableReason}</AppText>
        </View>
      ) : null}

      {requiresReconciliation ? (
        <Pressable onPress={acknowledgeReconciliation} style={styles.secondaryButton}>
          <AppText style={styles.secondaryLabel}>I checked Orders & History — unlock</AppText>
        </Pressable>
      ) : null}

      <Pressable
        onPress={reviewOrder}
        disabled={!!unavailableReason}
        style={({ pressed }) => [
          styles.primaryButton,
          action === 'sell' && styles.primarySell,
          !!unavailableReason && styles.buttonDisabled,
          pressed && !unavailableReason && styles.buttonPressed,
        ]}>
        <AppText style={styles.primaryLabel}>
          Review {action === 'buy' ? 'Buy' : 'Sell'} {contract?.sideLabel ?? ''}
        </AppText>
      </Pressable>
    </ScrollView>
  );

  const renderReview = () => {
    if (!draft) return null;
    return (
      <ScrollView
        {...panResponder.panHandlers}
        bounces={false}
        contentContainerStyle={styles.content}
        onScroll={(event) => {
          const atTop = event.nativeEvent.contentOffset.y <= 1;
          setSheetAtTop((current) => current === atTop ? current : atTop);
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <View style={styles.reviewHero}>
          <View style={[styles.reviewIcon, draft.action === 'buy' ? styles.buyIcon : styles.sellIcon]}>
            <Ionicons name={draft.action === 'buy' ? 'arrow-down' : 'arrow-up'} size={22} color={Colors.text} />
          </View>
          <AppText style={styles.reviewTitle}>
            {draft.action === 'buy' ? 'Buy' : 'Sell'} {draft.contract.sideLabel}
          </AppText>
          <AppText variant="caption" muted style={styles.reviewChoice}>{draft.choiceLabel}</AppText>
        </View>
        <View style={styles.summaryCard}>
          <SummaryRow label="Order" value={`${draft.orderType === 'market' ? 'Market IOC' : 'Limit GTC'} · ${sharesLabel(draft.shares)}`} />
          <SummaryRow label={draft.orderType === 'market' ? 'Expected price' : 'Limit price'} value={`${cents(draft.expectedPrice)} · $${formatPrice(draft.expectedPrice, 5)}`} />
          {draft.orderType === 'market' ? (
            <SummaryRow label={draft.action === 'buy' ? 'Maximum price' : 'Minimum price'} value={`${cents(draft.wirePrice)} · 8% cap`} />
          ) : null}
          <SummaryRow label={draft.action === 'buy' ? 'Estimated cost' : 'Estimated proceeds'} value={usd(draft.estimatedNotional)} strong />
          {draft.orderType === 'market' ? (
            <SummaryRow
              label={draft.action === 'buy' ? 'Maximum spend' : 'Minimum proceeds'}
              value={usd(outcomeOrderNotional(draft.shares, draft.wirePrice))}
            />
          ) : null}
          {draft.action === 'buy' ? (
            <>
              <SummaryRow label={`Payout if ${draft.contract.sideLabel} wins`} value={usd(draft.shares)} />
              <SummaryRow label="Potential profit" value={usd(Math.max(0, draft.shares - draft.estimatedNotional))} />
            </>
          ) : null}
        </View>
        <View style={styles.riskNotice}>
          <Ionicons name="shield-checkmark-outline" size={18} color={Colors.textMuted} />
          <AppText variant="caption" muted style={styles.noticeText}>
            Eligibility, balances, event identity, and the live book are checked again immediately before signing.
          </AppText>
        </View>
        {submitError ? (
          <View style={[styles.notice, styles.errorNotice]}>
            <Ionicons name="alert-circle-outline" size={18} color={Colors.down} />
            <AppText variant="caption" color={Colors.down} style={styles.noticeText}>{submitError}</AppText>
          </View>
        ) : null}
        {requiresReconciliation ? (
          <Pressable onPress={acknowledgeReconciliation} style={styles.secondaryButton}>
            <AppText style={styles.secondaryLabel}>I checked Orders & History — unlock</AppText>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => mutation.mutate(draft)}
          disabled={mutation.isPending || requiresReconciliation}
          style={({ pressed }) => [
            styles.primaryButton,
            draft.action === 'sell' && styles.primarySell,
            (mutation.isPending || requiresReconciliation) && styles.buttonDisabled,
            pressed && !mutation.isPending && !requiresReconciliation && styles.buttonPressed,
          ]}>
          {mutation.isPending ? (
            <ActivityIndicator color="#050505" />
          ) : (
            <AppText style={styles.primaryLabel}>
              Confirm {draft.action === 'buy' ? 'Buy' : 'Sell'}
            </AppText>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            setSubmitError(null);
            setSheetAtTop(true);
            setStage('form');
          }}
          disabled={mutation.isPending || requiresReconciliation}
          style={styles.secondaryButton}>
          <AppText style={styles.secondaryLabel}>Edit order</AppText>
        </Pressable>
      </ScrollView>
    );
  };

  const renderResult = () => {
    if (!submission) return null;
    const filled = submission.result.status === 'filled';
    const resting = submission.result.status === 'resting';
    return (
      <View style={styles.resultContent} {...panResponder.panHandlers}>
        <View style={[styles.resultIcon, filled || resting ? styles.resultSuccess : styles.resultNeutral]}>
          <Ionicons name={filled ? 'checkmark' : resting ? 'time-outline' : 'information'} size={30} color={Colors.text} />
        </View>
        <AppText style={styles.resultTitle}>{resultTitle}</AppText>
        <AppText variant="caption" muted style={styles.resultCopy}>
          {submission.draft.action === 'buy' ? 'Buy' : 'Sell'} {sharesLabel(submission.draft.shares)} of {submission.draft.choiceLabel} · {submission.draft.contract.sideLabel}.
        </AppText>
        {submission.result.status === 'filled' ? (
          <View style={styles.summaryCard}>
            <SummaryRow label="Filled" value={sharesLabel(submission.result.totalSz ?? submission.draft.shares)} />
            <SummaryRow label="Average price" value={submission.result.avgPx ? `${cents(submission.result.avgPx)} · $${formatPrice(submission.result.avgPx, 5)}` : '—'} strong />
          </View>
        ) : submission.result.status === 'resting' ? (
          <View style={styles.summaryCard}>
            <SummaryRow label="Order ID" value={submission.result.oid ? String(submission.result.oid) : 'Pending'} />
            <SummaryRow label="Limit" value={cents(submission.draft.wirePrice)} strong />
          </View>
        ) : (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.textMuted} />
            <AppText variant="caption" muted style={styles.noticeText}>
              Check Account → Orders and History before submitting another order.
            </AppText>
          </View>
        )}
        <Pressable onPress={animateClose} style={styles.primaryButton}>
          <AppText style={styles.primaryLabel}>Done</AppText>
        </Pressable>
        <Pressable
          onPress={() => {
            mutation.reset();
            setDraft(null);
            setAmount('');
            setSheetAtTop(true);
            setStage('form');
          }}
          style={styles.secondaryButton}>
          <AppText style={styles.secondaryLabel}>Trade again</AppText>
        </Pressable>
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={animateClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={animateClose} disabled={mutation.isPending} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardRoot}
          pointerEvents="box-none">
          <Animated.View
            style={[styles.animatedSheet, { transform: [{ translateY: sheetTranslateY }] }]}>
            <SheetSurface style={styles.sheet}>
              <View style={styles.sheetInner} {...panResponder.panHandlers}>
                <View {...headerPanResponder.panHandlers}>
                  <View style={styles.handleWrap}><View style={styles.handle} /></View>
                  <View style={styles.header}>
                    {stage !== 'form' ? (
                      <Pressable
                        hitSlop={10}
                        disabled={mutation.isPending}
                        onPress={() => {
                          setSubmitError(null);
                          setSheetAtTop(true);
                          if (stage === 'result') {
                            mutation.reset();
                            setDraft(null);
                          }
                          setStage('form');
                        }}
                        style={styles.headerButton}>
                        <Ionicons name="chevron-back" size={22} color={Colors.text} />
                      </Pressable>
                    ) : <View style={styles.headerButton} />}
                    <View style={styles.headerText}>
                      <AppText style={styles.headerTitle} numberOfLines={1}>
                        {stage === 'form' ? `Trade ${liveChoice.label}` : stage === 'review' ? 'Review order' : 'Order result'}
                      </AppText>
                      <AppText variant="caption" muted numberOfLines={1}>{liveEvent.title}</AppText>
                    </View>
                    <Pressable hitSlop={10} onPress={animateClose} disabled={mutation.isPending} style={styles.headerButton}>
                      <Ionicons name="close" size={22} color={Colors.textMuted} />
                    </Pressable>
                  </View>
                </View>
                {stage === 'form' ? renderForm() : stage === 'review' ? renderReview() : renderResult()}
              </View>
            </SheetSurface>
          </Animated.View>
        </KeyboardAvoidingView>
        {Platform.OS === 'ios' ? (
          <InputAccessoryView nativeID={ACCESSORY_ID}>
            <View style={styles.accessory}>
              <View style={styles.accessorySpacer} />
              <Pressable onPress={() => Keyboard.dismiss()} style={styles.doneButton}>
                <AppText style={styles.doneLabel}>Done</AppText>
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  keyboardRoot: { flex: 1, justifyContent: 'flex-end' },
  animatedSheet: { maxHeight: '94%' },
  sheet: {
    maxHeight: '100%',
    overflow: 'hidden',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  sheetFallback: { backgroundColor: '#0B0C0F' },
  sheetInner: { flexShrink: 1, maxHeight: '100%' },
  handleWrap: { height: 25, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  headerButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center', paddingHorizontal: Spacing.sm },
  headerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  content: { padding: Spacing.lg, paddingBottom: 34, gap: Spacing.md },
  segment: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.055)' },
  segmentButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: Radius.sm },
  segmentButtonOn: { backgroundColor: GLASS_FILL_STRONG },
  buyOn: { backgroundColor: 'rgba(42,207,158,0.24)' },
  sellOn: { backgroundColor: 'rgba(255,93,115,0.22)' },
  segmentText: { color: Colors.textMuted, fontSize: 14, fontWeight: '700' },
  segmentTextOn: { color: Colors.text },
  inlineTabs: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  inlineTab: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.pill, backgroundColor: GLASS_FILL },
  inlineTabOn: { backgroundColor: Colors.text },
  inlineTabText: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  inlineTabTextOn: { color: Colors.background },
  bookPrices: { flex: 1, alignItems: 'flex-end', gap: 1 },
  field: { gap: Spacing.sm },
  fieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inputRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: GLASS_FILL, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  input: { flex: 1, color: Colors.text, fontSize: 25, fontWeight: '600', paddingVertical: 8 },
  inputUnit: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  unitButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: Spacing.md, paddingVertical: 8 },
  midButton: { marginLeft: Spacing.sm, paddingHorizontal: Spacing.sm, paddingVertical: 7, borderRadius: Radius.sm, backgroundColor: GLASS_FILL_STRONG },
  quickRow: { flexDirection: 'row', gap: Spacing.sm },
  quickButton: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: Radius.sm, backgroundColor: GLASS_FILL },
  summaryCard: { padding: Spacing.md, gap: 10, borderRadius: Radius.md, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  summaryValue: { flexShrink: 1, color: Colors.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  summaryStrong: { color: Colors.text, fontSize: 14 },
  warning: { lineHeight: 17, marginTop: 2 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: GLASS_FILL },
  riskNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingHorizontal: Spacing.sm },
  noticeText: { flex: 1, lineHeight: 18 },
  errorNotice: { backgroundColor: 'rgba(255,93,115,0.09)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,93,115,0.25)' },
  primaryButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.up },
  primarySell: { backgroundColor: Colors.down },
  primaryLabel: { color: '#050505', fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: GLASS_FILL },
  secondaryLabel: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.42 },
  buttonPressed: { opacity: 0.78 },
  reviewHero: { alignItems: 'center', gap: 5, paddingVertical: Spacing.md },
  reviewIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  buyIcon: { backgroundColor: 'rgba(42,207,158,0.22)' },
  sellIcon: { backgroundColor: 'rgba(255,93,115,0.20)' },
  reviewTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  reviewChoice: { textAlign: 'center' },
  resultContent: { padding: Spacing.xl, paddingBottom: 38, alignItems: 'stretch', gap: Spacing.md },
  resultIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  resultSuccess: { backgroundColor: 'rgba(42,207,158,0.24)' },
  resultNeutral: { backgroundColor: GLASS_FILL_STRONG },
  resultTitle: { color: Colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  resultCopy: { textAlign: 'center', lineHeight: 18, marginBottom: Spacing.sm },
  accessory: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, backgroundColor: '#17181C', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
  accessorySpacer: { flex: 1 },
  doneButton: { paddingHorizontal: Spacing.md, paddingVertical: 7 },
  doneLabel: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
});
