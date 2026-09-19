import { PortfolioCard } from '@/components/PortfolioCard';
import { AppText } from '@/components/ui/AppText';
import { Colors, Spacing } from '@/constants/theme';
import { useHlAccountFees, useHlEarnBalance } from '@/data/useHlAccount';
import { signedUsd, usd } from '@/lib/format';
import type { AccountRiskSummary } from '@/lib/accountRisk';
import { RiskStrip } from './AccountRows';
import type { HlAccount } from '@/lib/hyperliquid/info';
import { usePreferences } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

const MASK = '••••••';

export function AccountSummary({ account, address, refreshing, onRefresh, riskSummary }: {
  account: HlAccount; address: string | null; refreshing: boolean; onRefresh: () => void; riskSummary?: AccountRiskSummary;
}) {
  const router = useRouter();
  const hidden = usePreferences((s) => s.privacyMode);
  const setHidden = usePreferences((s) => s.setPrivacyMode);
  const [expanded, setExpanded] = useState(false);
  const money = (value: number | null) => value == null ? '—' : hidden ? MASK : `${value < 0 ? '−' : ''}${usd(value)}`;
  return <View style={styles.summary}>
    <View style={styles.heading}>
      <AppText variant="heading">Account</AppText>
      <View style={styles.actions}>
        <Pressable style={styles.icon} onPress={() => setHidden(!hidden)} accessibilityLabel={hidden ? 'Show balances' : 'Hide balances'}><Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={19} color={Colors.textMuted} /></Pressable>
        <Pressable style={styles.icon} onPress={onRefresh} disabled={refreshing} accessibilityLabel="Refresh account" accessibilityState={{ busy: refreshing }}>
          {refreshing ? <ActivityIndicator size="small" color={Colors.textMuted} /> : <Ionicons name="refresh-outline" size={19} color={Colors.textMuted} />}
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
    {expanded ? <AccountOverview account={account} address={address} hidden={hidden} riskSummary={riskSummary} /> : null}
  </View>;
}

/** Optional account details only subscribe while their disclosure is open. */
function AccountOverview({ account, address, hidden, riskSummary }: { account: HlAccount; address: string | null; hidden: boolean; riskSummary?: AccountRiskSummary }) {
  const fees = useHlAccountFees();
  const earn = useHlEarnBalance();
  const money = (value: number | null | undefined) => value == null ? '—' : hidden ? MASK : `${value < 0 ? '−' : ''}${usd(value)}`;
  const rate = (value: number | null | undefined) => value == null ? '—' : hidden ? MASK : `${(value * 100).toFixed(4)}%`;
  return <View testID="account-overview" style={styles.overview}>
    <PortfolioCard hidden={hidden} />
    {riskSummary ? <RiskStrip summary={riskSummary} hidden={hidden} showWarnings={false} /> : null}
    <Detail label="Account" value={hidden ? MASK : address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'} />
    <Detail label="USDC Earn" value={money(earn.data?.suppliedUsdc)} />
    <Detail label="14-day volume" value={money(fees.data?.volume14d)} />
    <Detail label="Maker / taker fees" value={`${rate(fees.data?.makerRate)} / ${rate(fees.data?.takerRate)}`} />
    {account.abstractionMode === 'standard' || account.abstractionMode === 'dexAbstraction' ? <AppText variant="caption" muted>Total value covers connected perpetual markets, spot balances and vault holdings.</AppText> : null}
    {fees.isError || earn.isError ? <Pressable accessibilityRole="button" onPress={() => { void fees.refetch(); void earn.refetch(); }} style={styles.overviewButton}><AppText variant="caption" color={Colors.accent}>Refresh unavailable details</AppText></Pressable> : null}
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
  detail: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
});
