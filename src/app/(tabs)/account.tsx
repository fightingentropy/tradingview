import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MarginSheet } from '@/components/MarginSheet';
import { PortfolioCard } from '@/components/PortfolioCard';
import { SymbolLogo } from '@/components/SymbolLogo';
import { TpSlSheet, type TpSlLegInput } from '@/components/TpSlSheet';
import { TradeTicket } from '@/components/TradeTicket';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useMarkets } from '@/data/useMarkets';
import { useHlAccount, useHlFills, useHlOpenOrders } from '@/data/useHlAccount';
import { useHlMeta } from '@/data/useHlMeta';
import { cancelOrder, marketClose, placePositionTpSl, reversePosition, updateIsolatedMargin } from '@/lib/hyperliquid/exchange';
import type { HlFill, HlOpenOrder, HlPosition, HlSpotBalance } from '@/lib/hyperliquid/info';
import { formatCompact, formatPercent, formatPrice, priceDecimalsFor, signedUsd, usd } from '@/lib/format';
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

/** Token balance amount, comma-grouped with adaptive precision. */
function tokenAmt(v: number): string {
  if (v >= 1_000_000_000) return formatCompact(v);
  return formatPrice(v, v >= 1000 ? 2 : v >= 1 ? 4 : 6);
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

/** A pending "Limit Close" ticket spawned from a position. */
interface CloseTicket {
  coin: string;
  symbol: string;
  markPx: number;
  decimals: number;
  side: 'buy' | 'sell';
  sizeCoin: number;
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
  const { data: openOrders } = useHlOpenOrders();
  const { data: fills } = useHlFills();
  const { data: markets } = useMarkets();
  const { data: meta } = useHlMeta();

  const tradable = hasKey && !demo;
  const [tab, setTab] = useState<'positions' | 'orders' | 'balances' | 'history'>('positions');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [closeTicket, setCloseTicket] = useState<CloseTicket | null>(null);
  const [marginTarget, setMarginTarget] = useState<HlPosition | null>(null);
  const [tpSlTarget, setTpSlTarget] = useState<HlPosition | null>(null);
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

  const closeMutation = useMutation({
    mutationFn: (p: HlPosition) => {
      const m = meta?.[p.coin];
      if (!m) throw new Error(`No market metadata for ${p.coin}`);
      return marketClose({
        network,
        assetIndex: m.assetIndex,
        szDecimals: m.szDecimals,
        positionIsLong: p.side === 'long',
        size: p.size,
        markPx: p.markPx,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() }),
    onError: (e: unknown) =>
      Alert.alert('Close failed', e instanceof Error ? e.message : 'Unknown error'),
  });

  const reverseMutation = useMutation({
    mutationFn: (p: HlPosition) => {
      const m = meta?.[p.coin];
      if (!m) throw new Error(`No market metadata for ${p.coin}`);
      return reversePosition({
        network,
        assetIndex: m.assetIndex,
        szDecimals: m.szDecimals,
        positionIsLong: p.side === 'long',
        size: p.size,
        markPx: p.markPx,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() }),
    onError: (e: unknown) =>
      Alert.alert('Reverse failed', e instanceof Error ? e.message : 'Unknown error'),
  });

  const cancelMutation = useMutation({
    mutationFn: (o: HlOpenOrder) => {
      const m = meta?.[o.coin];
      if (!m) throw new Error(`No market metadata for ${o.coin}`);
      return cancelOrder({ network, assetIndex: m.assetIndex, oid: o.oid });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
    },
    onError: (e: unknown) =>
      Alert.alert('Cancel failed', e instanceof Error ? e.message : 'Unknown error'),
  });

  const marginMutation = useMutation({
    mutationFn: ({ p, signedUsd }: { p: HlPosition; signedUsd: number }) => {
      const mInfo = meta?.[p.coin];
      if (!mInfo) throw new Error(`No market metadata for ${p.coin}`);
      return updateIsolatedMargin({ network, assetIndex: mInfo.assetIndex, usd: signedUsd });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      setMarginTarget(null);
    },
    onError: (e: unknown) =>
      Alert.alert('Margin update failed', e instanceof Error ? e.message : 'Unknown error'),
  });

  const tpSlMutation = useMutation({
    mutationFn: ({ p, legs }: { p: HlPosition; legs: TpSlLegInput[] }) => {
      const mInfo = meta?.[p.coin];
      if (!mInfo) throw new Error(`No market metadata for ${p.coin}`);
      return placePositionTpSl({
        network,
        assetIndex: mInfo.assetIndex,
        szDecimals: mInfo.szDecimals,
        positionIsLong: p.side === 'long',
        size: p.size,
        legs,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
      setTpSlTarget(null);
    },
    onError: (e: unknown) =>
      Alert.alert('Couldn’t set TP/SL', e instanceof Error ? e.message : 'Unknown error'),
  });

  const confirmClose = useCallback(
    (p: HlPosition) => {
      if (!tradable) return;
      const sym = cleanCoin(p.coin);
      Alert.alert(
        `Market close ${sym}?`,
        `Market-close your ${p.side} ${qty(p.size)} ${sym} position` +
          (network === 'mainnet' ? '.\n\nThis uses real funds on mainnet.' : ' on testnet.'),
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Close position', style: 'destructive', onPress: () => closeMutation.mutate(p) },
        ],
      );
    },
    [tradable, network, closeMutation],
  );

  const confirmReverse = useCallback(
    (p: HlPosition) => {
      if (!tradable) return;
      const sym = cleanCoin(p.coin);
      const target = p.side === 'long' ? 'short' : 'long';
      Alert.alert(
        `Reverse ${sym}?`,
        `Close your ${p.side} ${qty(p.size)} ${sym} and open an equal ${target} (market, 2× size).` +
          (network === 'mainnet' ? '\n\nThis uses real funds on mainnet.' : '\n\nTestnet order.'),
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reverse', style: 'destructive', onPress: () => reverseMutation.mutate(p) },
        ],
      );
    },
    [tradable, network, reverseMutation],
  );

  const confirmCancel = useCallback(
    (o: HlOpenOrder) => {
      if (!tradable) return;
      const sym = cleanCoin(o.coin);
      const dec = priceDecimalsFor(6, o.limitPx);
      Alert.alert(
        'Cancel order?',
        `Cancel your ${o.side} ${qty(o.size)} ${sym} @ $${formatPrice(o.limitPx, dec)}` +
          (network === 'mainnet' ? '.' : ' (testnet).'),
        [
          { text: 'Keep', style: 'cancel' },
          { text: 'Cancel order', style: 'destructive', onPress: () => cancelMutation.mutate(o) },
        ],
      );
    },
    [tradable, network, cancelMutation],
  );

  const confirmAdjustMargin = useCallback(
    (p: HlPosition, signedUsd: number) => {
      if (!tradable || signedUsd === 0) return;
      const sym = cleanCoin(p.coin);
      const add = signedUsd > 0;
      Alert.alert(
        `${add ? 'Add' : 'Remove'} margin?`,
        `${add ? 'Add' : 'Remove'} ${usd(Math.abs(signedUsd))} ${add ? 'to' : 'from'} your ${sym} isolated margin` +
          (network === 'mainnet' ? '.\n\nThis uses real funds on mainnet.' : ' on testnet.'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: add ? 'Add margin' : 'Remove margin',
            onPress: () => marginMutation.mutate({ p, signedUsd }),
          },
        ],
      );
    },
    [tradable, network, marginMutation],
  );

  const confirmTpSl = useCallback(
    (p: HlPosition, legs: TpSlLegInput[]) => {
      if (!tradable || legs.length === 0) return;
      const sym = cleanCoin(p.coin);
      const dec = priceDecimalsFor(instrumentForCoin(p.coin)?.priceDecimals ?? 6, p.markPx);
      const lines = legs
        .map(
          (l) =>
            `${l.tpsl === 'tp' ? 'Take profit' : 'Stop loss'} @ $${formatPrice(l.triggerPx, dec)}`,
        )
        .join('\n');
      Alert.alert(
        `Set TP/SL on ${sym}?`,
        `${lines}\n\nMarket triggers that reduce-only close your ${p.side} ${qty(p.size)} ${sym}.` +
          (network === 'mainnet' ? '\n\nThis uses real funds on mainnet.' : '\n\nTestnet order.'),
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set orders', onPress: () => tpSlMutation.mutate({ p, legs }) },
        ],
      );
    },
    [tradable, network, tpSlMutation, instrumentForCoin],
  );

  const openLimitClose = useCallback(
    (p: HlPosition) => {
      if (!tradable) return;
      const inst = instrumentForCoin(p.coin);
      setCloseTicket({
        coin: p.coin,
        symbol: inst?.symbol ?? cleanCoin(p.coin),
        markPx: p.markPx,
        decimals: priceDecimalsFor(inst?.priceDecimals ?? 6, p.markPx),
        side: p.side === 'long' ? 'sell' : 'buy',
        sizeCoin: p.size,
      });
    },
    [tradable, instrumentForCoin],
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

        {/* Stats — "Available" is free spot USDC (the real deployable cash); under
            unified margin the perp collateral is a reserved slice of it. */}
        <View style={styles.tiles}>
          <Stat label="Available" value={mask(usd(account.availableUsdc ?? account.withdrawable))} />
          <Stat label="Margin Used" value={mask(usd(account.totalMarginUsed))} />
          <Stat label="Exposure" value={mask(usd(account.totalNotional))} />
        </View>

        {/* Portfolio value sparkline + period change / drawdown. */}
        <PortfolioCard hidden={privacyMode} />

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
                    (closeMutation.isPending && closeMutation.variables?.coin === p.coin) ||
                    (reverseMutation.isPending && reverseMutation.variables?.coin === p.coin)
                  }
                  hidden={privacyMode}
                  onToggle={() => toggleExpand(p.coin)}
                  onChart={() => openChart(p.coin)}
                  onLimitClose={() => openLimitClose(p)}
                  onMarketClose={() => confirmClose(p)}
                  onReverse={() => confirmReverse(p)}
                  onAdjustMargin={() => setMarginTarget(p)}
                  onSetTpSl={() => setTpSlTarget(p)}
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
                  busy={cancelMutation.isPending && cancelMutation.variables?.oid === o.oid}
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

        {demo ? (
          <AppText variant="caption" muted style={styles.disclaimer}>
            Demo address — connect your own account in Settings to trade.
          </AppText>
        ) : null}
      </ScrollView>

      {/* Limit-close sheet (reduce-only, size prefilled). */}
      <TradeTicket
        key={closeTicket ? `${closeTicket.coin}-close` : 'closed'}
        visible={closeTicket !== null}
        onClose={() => setCloseTicket(null)}
        coin={closeTicket?.coin ?? ''}
        symbol={closeTicket?.symbol}
        markPx={closeTicket?.markPx ?? 0}
        priceDecimals={closeTicket?.decimals ?? 2}
        initialSide={closeTicket?.side}
        initialType="limit"
        initialSizeCoin={closeTicket?.sizeCoin}
        closing
      />

      {/* Set take-profit / stop-loss on an open position (reduce-only market triggers).
          Keyed per coin so each open mounts fresh — no price carries across positions. */}
      <TpSlSheet
        key={tpSlTarget ? `${tpSlTarget.coin}-tpsl` : 'tpsl-closed'}
        visible={tpSlTarget !== null}
        onClose={() => setTpSlTarget(null)}
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
        priceDecimals={
          tpSlTarget
            ? priceDecimalsFor(instrumentForCoin(tpSlTarget.coin)?.priceDecimals ?? 6, tpSlTarget.markPx)
            : 2
        }
        tradable={tradable}
        busy={tpSlMutation.isPending}
        onSubmit={(legs) => {
          if (tpSlTarget) confirmTpSl(tpSlTarget, legs);
        }}
      />

      {/* Add / remove isolated margin on a position. */}
      <MarginSheet
        visible={marginTarget !== null}
        symbol={
          marginTarget
            ? instrumentForCoin(marginTarget.coin)?.symbol ?? cleanCoin(marginTarget.coin)
            : ''
        }
        marginUsed={marginTarget?.marginUsed ?? 0}
        available={account.availableUsdc ?? account.withdrawable ?? 0}
        tradable={tradable}
        busy={marginMutation.isPending}
        onClose={() => setMarginTarget(null)}
        onSubmit={(signed) => {
          if (marginTarget) confirmAdjustMargin(marginTarget, signed);
        }}
      />
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.tile}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText
        variant="label"
        numeric
        color={color}
        style={styles.tileValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}>
        {value}
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

          <Pressable
            style={({ pressed }) => [styles.tpslBtn, pressed && tradable && !busy && styles.actionBtnPressed]}
            onPress={onSetTpSl}
            disabled={!tradable || busy}>
            <Ionicons
              name="shield-half-outline"
              size={15}
              color={!tradable || busy ? Colors.textFaint : Colors.accent}
            />
            <AppText variant="label" color={!tradable || busy ? Colors.textFaint : Colors.accent}>
              Set TP / SL
            </AppText>
          </Pressable>

          <View style={styles.actions}>
            <ActionBtn label="Limit Close" onPress={onLimitClose} disabled={!tradable || busy} />
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

  tiles: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  tile: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md },
  tileValue: { marginTop: 4 },

  tabBarWrap: {
    marginTop: Spacing.xl,
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
  tpslBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
  },
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

  disclaimer: { textAlign: 'center', marginTop: Spacing.lg },
});
