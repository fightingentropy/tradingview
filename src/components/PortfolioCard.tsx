import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { EquityCurve } from '@/components/EquityCurve';
import { AppText } from '@/components/ui/AppText';
import { Colors } from '@/constants/theme';
import { useHlPortfolio } from '@/data/useHlAccount';
import { signedUsd, usd } from '@/lib/format';
import type { HlPortfolioPeriodKey } from '@/lib/hyperliquid/info';
import { portfolioWindowMetrics, rebasedPnl } from '@/lib/portfolioMetrics';

export const PORTFOLIO_PERIODS: { key: HlPortfolioPeriodKey; label: string }[] = [
  { key: 'day', label: '24H' }, { key: 'week', label: '7D' }, { key: 'month', label: '30D' }, { key: 'allTime', label: 'ALL' },
];
export type PortfolioChartMode = 'account' | 'pnl' | 'perps';
export const PORTFOLIO_MODES: { key: PortfolioChartMode; label: string }[] = [
  { key: 'account', label: 'Account value' }, { key: 'pnl', label: 'PNL' }, { key: 'perps', label: 'Perps PNL' },
];
export function PortfolioCard({ hidden }: { hidden: boolean; compact?: boolean }) {
  const query = useHlPortfolio();
  const [period, setPeriod] = useState<HlPortfolioPeriodKey>('month');
  const [mode, setMode] = useState<PortfolioChartMode>('account');
  const window = mode === 'perps' ? query.data?.perps?.[period] : query.data?.[period];
  const availableWindow = window?.available === true ? window : undefined;
  const metrics = portfolioWindowMetrics(availableWindow);
  const points = mode === 'account' ? availableWindow?.accountValue ?? [] : rebasedPnl(availableWindow?.pnl ?? []);
  const color = mode === 'account' || (metrics.pnl ?? 0) >= 0 ? Colors.accent : Colors.down;
  const amount = (value: number | null, signed = false) => value == null ? '—' : hidden ? '••••' : signed ? signedUsd(value) : `${value < 0 ? '−' : ''}${usd(value)}`;
  return <View style={styles.card}>
    <View style={styles.modes}>{PORTFOLIO_MODES.map((item) => <Pressable key={item.key} onPress={() => setMode(item.key)} style={[styles.mode, mode === item.key && styles.modeActive]} accessibilityRole="tab" accessibilityState={{ selected: mode === item.key }}><AppText variant="caption" color={mode === item.key ? Colors.text : Colors.textMuted}>{item.label}</AppText></Pressable>)}</View>
    <View style={styles.metrics}><View style={styles.metric}><AppText variant="caption" muted>Period PNL</AppText><AppText numeric style={styles.value} color={metrics.pnl == null ? Colors.textMuted : metrics.pnl >= 0 ? Colors.up : Colors.down} numberOfLines={1} adjustsFontSizeToFit>{amount(metrics.pnl, true)}</AppText></View><View style={styles.metric}><AppText variant="caption" muted>Volume</AppText><AppText numeric style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{amount(metrics.volume)}</AppText></View></View>
    {query.isPending || (query.isFetching && !availableWindow) ? <View style={styles.empty}><ActivityIndicator color={Colors.accent} /></View> : points.length >= 2 ? <EquityCurve key={`${mode}:${period}`} points={points} color={color} hidden={hidden} /> : <View style={styles.empty}><AppText variant="caption" muted>{query.isError ? 'Portfolio history unavailable' : window?.available === false ? 'This history is unavailable' : 'Not enough history yet'}</AppText>{query.isError ? <Pressable onPress={() => void query.refetch()}><AppText variant="caption" color={Colors.accent}>Retry</AppText></Pressable> : null}</View>}
    {query.isError && points.length >= 2 ? <Pressable onPress={() => void query.refetch()}><AppText variant="caption" color={Colors.warning}>History refresh failed · Retry</AppText></Pressable> : null}
    <View style={styles.footer}>{PORTFOLIO_PERIODS.map((item) => <Pressable key={item.key} onPress={() => setPeriod(item.key)} style={[styles.period, period === item.key && styles.periodActive]} accessibilityRole="button" accessibilityState={{ selected: period === item.key }}><AppText variant="caption" color={period === item.key ? Colors.accent : Colors.textMuted}>{item.label}</AppText></Pressable>)}</View>
    <View style={styles.details}><AppText variant="caption" color={Colors.textFaint}>Max PNL decline</AppText><AppText variant="caption" numeric color={Colors.textMuted}>{amount(metrics.maxPnlDrawdown)}</AppText></View>
    <AppText variant="caption" color={Colors.textFaint} style={styles.note}>{mode === 'account' ? 'Account value includes deposits and withdrawals.' : 'PNL shows the change in performance for this period.'}</AppText>
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 14, paddingBottom: 14 },
  modes: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, gap: 22 },
  mode: { paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: 'transparent' }, modeActive: { borderBottomColor: Colors.accent },
  metrics: { flexDirection: 'row', paddingTop: 16, paddingBottom: 6, gap: 20 }, metric: { flex: 1, gap: 5, minWidth: 0 }, value: { fontSize: 19, lineHeight: 25, fontWeight: '600' },
  empty: { height: 202, alignItems: 'center', justifyContent: 'center', gap: 12 }, footer: { flexDirection: 'row', gap: 6, marginTop: 16 },
  period: { minWidth: 48, paddingVertical: 8, alignItems: 'center', borderRadius: 6 }, periodActive: { backgroundColor: Colors.surfaceAlt },
  details: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 14, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border }, note: { marginTop: 8, fontSize: 10, lineHeight: 15 },
});
