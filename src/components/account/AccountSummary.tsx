import { PortfolioCard } from '@/components/PortfolioCard';
import { AppText } from '@/components/ui/AppText';
import { Colors, Spacing } from '@/constants/theme';
import { useHlAccountFees, useHlAccountOverview, useHlEarnBalance } from '@/data/useHlAccount';
import { signedUsd, usd } from '@/lib/format';
import type { HlAccountOverview } from '@/lib/accountOverview';
import type { HlAccount } from '@/lib/hyperliquid/info';
import { usePreferences } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

const MASK = '••••••';

export function AccountSummary({ account, address, refreshing, onRefresh }: {
  account: HlAccount; address: string | null; refreshing: boolean; onRefresh: () => void;
}) {
  const router = useRouter();
  const hidden = usePreferences((s) => s.privacyMode);
  const setHidden = usePreferences((s) => s.setPrivacyMode);
  const [expanded, setExpanded] = useState(false);
  const overview = useHlAccountOverview(account.abstractionMode, expanded);
  const busy = refreshing || (expanded && overview.isFetching);
  const money = (value: number | null) => value == null ? '—' : hidden ? MASK : `${value < 0 ? '−' : ''}${usd(value)}`;
  return <View style={styles.summary}>
    <View style={styles.heading}>
      <AppText variant="heading">Account</AppText>
      <View style={styles.actions}>
        <Pressable style={styles.icon} onPress={() => setHidden(!hidden)} accessibilityLabel={hidden ? 'Show balances' : 'Hide balances'}><Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={19} color={Colors.textMuted} /></Pressable>
        <Pressable style={styles.icon} onPress={() => { onRefresh(); if (expanded) void overview.refetch(); }} disabled={busy} accessibilityLabel="Refresh account" accessibilityState={{ busy }}>
          {busy ? <ActivityIndicator size="small" color={Colors.textMuted} /> : <Ionicons name="refresh-outline" size={19} color={Colors.textMuted} />}
        </Pressable>
        <Pressable style={styles.icon} onPress={() => router.push('/settings')} accessibilityLabel="Account settings"><Ionicons name="settings-outline" size={19} color={Colors.textMuted} /></Pressable>
      </View>
    </View>
    <View style={styles.values}>
      <View style={styles.value}>
        <AppText variant="caption" muted>Total value</AppText>
        <AppText numeric style={styles.equity}>{money(account.totalEquityLoaded === true ? account.totalEquity : null)}</AppText>
      </View>
      <View style={styles.value}>
        <AppText variant="caption" muted>Open P&L</AppText>
        <AppText numeric style={styles.pnl} color={account.unrealizedPnl >= 0 ? Colors.up : Colors.down}>{hidden ? MASK : signedUsd(account.unrealizedPnl)}</AppText>
      </View>
    </View>
    {account.totalEquityLoaded !== true ? <AppText variant="caption" color={Colors.warning}>Some balances couldn’t refresh.</AppText> : null}
    <View style={styles.footer}>
      <AppText variant="caption" muted>Available <AppText variant="caption" numeric>{money(account.totalEquityLoaded === true ? account.freeCollateral : null)}</AppText></AppText>
      <Pressable testID="account-overview-toggle" style={styles.overviewButton} accessibilityRole="button" accessibilityLabel="Account overview" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}>
        <AppText variant="caption" muted>Overview</AppText><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textMuted} />
      </Pressable>
    </View>
    {expanded ? <AccountOverview account={account} address={address} hidden={hidden} overview={overview.data} /> : null}
  </View>;
}

/** Optional account details only subscribe while their disclosure is open. */
function AccountOverview({ account, address, hidden, overview }: { account: HlAccount; address: string | null; hidden: boolean; overview?: HlAccountOverview }) {
  const fees = useHlAccountFees();
  const earn = useHlEarnBalance();
  const money = (value: number | null | undefined) => value == null ? '—' : hidden ? MASK : `${value < 0 ? '−' : ''}${usd(value)}`;
  const rate = (value: number | null | undefined) => value == null ? '—' : hidden ? MASK : `${(value * 100).toFixed(4)}%`;
  return <View testID="account-overview" style={styles.overview}>
    <MarginSummary mode={account.abstractionMode} overview={overview} hidden={hidden} />
    <PortfolioCard hidden={hidden} />
    <Detail label="Account" value={hidden ? MASK : address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'} />
    <Detail label="USDC Earn" value={money(earn.data?.suppliedUsdc)} />
    <Detail label="14-day volume" value={money(fees.data?.volume14d)} />
    <Detail label="Maker / taker fees" value={`${rate(fees.data?.makerRate)} / ${rate(fees.data?.takerRate)}`} />
    {account.abstractionMode === 'standard' || account.abstractionMode === 'dexAbstraction' ? <AppText variant="caption" muted>Total value covers connected perpetual markets, spot balances and vault holdings.</AppText> : null}
    {fees.isError || earn.isError ? <Pressable accessibilityRole="button" onPress={() => { void fees.refetch(); void earn.refetch(); }} style={styles.overviewButton}><AppText variant="caption" color={Colors.accent}>Refresh unavailable details</AppText></Pressable> : null}
  </View>;
}

function MarginSummary({ mode, overview, hidden }: { mode: HlAccount['abstractionMode']; overview?: HlAccountOverview; hidden: boolean }) {
  const portfolio = mode === 'portfolioMargin';
  const unified = mode === 'unified';
  const title = portfolio ? 'Portfolio Margin Summary' : unified ? 'Unified Account Summary' : 'Perps Account Summary';
  const ratioLabel = portfolio ? 'Portfolio Margin Ratio' : unified ? 'Unified Account Ratio' : 'Cross Margin Ratio';
  const leverageLabel = portfolio ? 'Portfolio Account Leverage' : unified ? 'Unified Account Leverage' : 'Perps Account Leverage';
  const money = (value: number | null | undefined) => value == null ? '—' : hidden ? MASK : `${value < 0 ? '−' : ''}${usd(value)}`;
  const percent = (value: number | null | undefined) => value == null ? '—' : hidden ? MASK : `${(value * 100).toFixed(2)}%`;
  const ratio = overview?.marginRatio;
  const threshold = portfolio ? 0.95 : 1;
  const ratioColor = ratio == null || hidden ? Colors.text : ratio >= threshold ? Colors.down : ratio >= threshold * 0.8 ? Colors.warning : Colors.accent;
  const pnl = overview?.unrealizedPnl;
  return <View testID="account-margin-summary" style={styles.marginSummary}>
    <AppText variant="label">{title}</AppText>
    <View style={styles.ratioBlock}>
      <Metric label={ratioLabel} value={percent(ratio)} prominent color={ratioColor}
        help={portfolio ? 'Your overall liquidation risk, reported by Hyperliquid. Liquidation can begin above 95%.' : 'How much of your cross-margin collateral is needed to keep positions open. Higher means less room before liquidation.'} />
      {!hidden && ratio != null ? <View style={styles.ratioTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.ratioFill, { width: `${Math.min(100, Math.max(0, ratio / threshold * 100))}%`, backgroundColor: ratioColor }]} />
      </View> : null}
    </View>
    <Metric label={portfolio || unified ? 'Portfolio Value' : 'Perps Account Value'} value={money(overview?.portfolioValue)} />
    <Metric label="Unrealized PNL" value={pnl == null ? '—' : hidden ? MASK : signedUsd(pnl)} color={hidden || pnl == null || pnl === 0 ? undefined : pnl > 0 ? Colors.up : Colors.down} />
    {portfolio ? <Metric label="Borrow Cap Used" value={percent(overview?.borrowCapUsed)} help="The highest share of a borrowing limit used by any asset in your account. At 100%, further trades need more of that asset as collateral." /> : null}
    <Metric label="Perps Maintenance Margin" value={money(overview?.perpsMaintenanceMargin)} help="The collateral required to keep your cross-margin perpetual positions open, across all Hyperliquid markets." />
    <Metric label={leverageLabel} value={overview?.accountLeverage == null ? '—' : hidden ? MASK : `${overview.accountLeverage.toFixed(2)}×`} />
  </View>;
}

function Metric({ label, value, color, prominent, help }: { label: string; value: string; color?: string; prominent?: boolean; help?: string }) {
  return <View style={styles.metric}>
    {help ? <Pressable accessibilityRole="button" accessibilityLabel={`About ${label}`} onPress={() => Alert.alert(label, help)} style={styles.metricLabel}>
      <AppText style={styles.metricText} muted>{label}</AppText>
      <Ionicons name="information-circle-outline" size={14} color={Colors.textFaint} />
    </Pressable> : <AppText style={[styles.metricLabel, styles.metricText]} muted>{label}</AppText>}
    <AppText numeric color={color} style={[styles.metricNumber, prominent && styles.ratioNumber]}>{value}</AppText>
  </View>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><AppText variant="caption" muted>{label}</AppText><AppText variant="caption" numeric>{value}</AppText></View>;
}

const styles = StyleSheet.create({
  summary: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 2 },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  values: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, rowGap: 12, paddingTop: 10 },
  value: { flexGrow: 1, gap: 4 },
  equity: { fontSize: 25, lineHeight: 32, fontWeight: '600', letterSpacing: -0.5 },
  pnl: { fontSize: 21, lineHeight: 32, fontWeight: '500' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginTop: 6 },
  overviewButton: { minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center' },
  overview: { gap: 14, paddingTop: 6, paddingBottom: 14 },
  marginSummary: { gap: 13, paddingVertical: 18, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  metric: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 16, rowGap: 4 },
  metricLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, minWidth: 150 },
  metricText: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  metricNumber: { fontSize: 15, lineHeight: 22, fontWeight: '500', marginLeft: 'auto' },
  ratioBlock: { gap: 10, paddingVertical: 3 },
  ratioNumber: { fontSize: 22, lineHeight: 30, fontWeight: '600' },
  ratioTrack: { height: 3, borderRadius: 2, backgroundColor: Colors.surfaceAlt, overflow: 'hidden' },
  ratioFill: { height: 3, borderRadius: 2 },
  detail: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
});
