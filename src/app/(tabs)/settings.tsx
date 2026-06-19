import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Fragment } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { HlAccountCard } from '@/components/HlAccountCard';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatPrice } from '@/lib/format';
import { fetchStockQuotes } from '@/providers/stocks/client';
import { useAlerts } from '@/store/alerts';
import { useChartSettings } from '@/store/chartSettings';
import { SMALL_BALANCE_USD, usePreferences } from '@/store/preferences';
import { useWatchlists } from '@/store/watchlists';

function StatusRow({ label, detail, color }: { label: string; detail: string; color: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <AppText variant="body">{label}</AppText>
      </View>
      <AppText variant="caption" muted>
        {detail}
      </AppText>
    </View>
  );
}

export default function SettingsScreen() {
  const resetDefaults = useWatchlists((s) => s.resetDefaults);
  const alerts = useAlerts((s) => s.alerts);
  const removeAlert = useAlerts((s) => s.remove);
  const clearAlerts = useAlerts((s) => s.clearAll);
  const hideSmallBalances = usePreferences((s) => s.hideSmallBalances);
  const setHideSmallBalances = usePreferences((s) => s.setHideSmallBalances);
  const showPosition = useChartSettings((s) => s.showPosition);
  const setShowPosition = useChartSettings((s) => s.setShowPosition);

  const stocksHealth = useQuery({
    queryKey: ['stocks-health'],
    queryFn: async () => {
      const q = await fetchStockQuotes(['AAPL']);
      return Object.values(q).some((v) => v && v.close !== undefined);
    },
    staleTime: 60_000,
  });

  const stocksDetail =
    stocksHealth.data === undefined
      ? 'Checking…'
      : stocksHealth.data
        ? 'Live (Twelve Data)'
        : 'Add TWELVE_DATA_KEY';

  const onReset = () =>
    Alert.alert('Reset watchlists?', 'Restores the default Crypto and Stocks lists.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetDefaults },
    ]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <AppText variant="caption" muted style={styles.sectionLabel}>
          HYPERLIQUID ACCOUNT
        </AppText>
        <HlAccountCard />

        <AppText variant="caption" muted style={styles.sectionLabel}>
          DISPLAY
        </AppText>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <AppText variant="body">Hide small balances</AppText>
              <AppText variant="caption" muted>
                Hide spot balances worth under ${SMALL_BALANCE_USD}.
              </AppText>
            </View>
            <Switch
              value={hideSmallBalances}
              onValueChange={setHideSmallBalances}
              trackColor={{ false: Colors.surfaceAlt, true: Colors.accent }}
              ios_backgroundColor={Colors.surfaceAlt}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <AppText variant="body">Position &amp; PnL on charts</AppText>
              <AppText variant="caption" muted>
                Mark your entry, liquidation, and unrealized PnL on a symbol&apos;s chart.
              </AppText>
            </View>
            <Switch
              value={showPosition}
              onValueChange={setShowPosition}
              trackColor={{ false: Colors.surfaceAlt, true: Colors.accent }}
              ios_backgroundColor={Colors.surfaceAlt}
            />
          </View>
        </View>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          DATA SOURCES
        </AppText>
        <View style={styles.card}>
          <StatusRow label="Hyperliquid" detail="Live · keyless" color={Colors.up} />
          <View style={styles.divider} />
          <StatusRow label="trade.xyz perps" detail="Live · keyless" color="#B07CFF" />
          <View style={styles.divider} />
          <StatusRow
            label="US Stocks"
            detail={stocksDetail}
            color={stocksHealth.data ? Colors.up : Colors.textFaint}
          />
          <View style={styles.divider} />
          <StatusRow label="VIX · Cboe" detail="Live · keyless" color="#4DD0E1" />
        </View>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          WATCHLISTS
        </AppText>
        <Pressable style={styles.card} onPress={onReset}>
          <View style={styles.row}>
            <AppText variant="body" color={Colors.down}>
              Reset to defaults
            </AppText>
          </View>
        </Pressable>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          PRICE ALERTS
        </AppText>
        <View style={styles.card}>
          {alerts.length === 0 ? (
            <View style={styles.row}>
              <AppText variant="caption" muted>
                Long-press (or right-click) any symbol to set one.
              </AppText>
            </View>
          ) : (
            alerts.map((a, i) => (
              <Fragment key={a.id}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.row}>
                  <View style={styles.alertText}>
                    <AppText variant="body">
                      {a.symbol} · {a.direction === 'up' ? '▲' : a.direction === 'down' ? '▼' : '±'}
                      {a.pct}%
                    </AppText>
                    <AppText variant="caption" muted>
                      {a.triggeredAt
                        ? `Triggered @ ${formatPrice(a.triggeredPrice)}`
                        : `Armed from ${formatPrice(a.anchorPrice)}`}
                    </AppText>
                  </View>
                  <Pressable
                    hitSlop={8}
                    onPress={() => removeAlert(a.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Delete alert">
                    <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
                  </Pressable>
                </View>
              </Fragment>
            ))
          )}
        </View>
        {alerts.length > 0 ? (
          <Pressable style={styles.card} onPress={clearAlerts}>
            <View style={styles.row}>
              <AppText variant="body" color={Colors.down}>
                Clear all alerts
              </AppText>
            </View>
          </Pressable>
        ) : null}

        <View style={styles.footer}>
          <AppText variant="caption" muted>
            TradingView Clone · v{Constants.expoConfig?.version ?? '1.0.0'}
          </AppText>
          <AppText variant="caption" muted>
            Data: Hyperliquid + trade.xyz + Twelve Data + Cboe
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.sm },
  sectionLabel: { marginTop: Spacing.md, marginLeft: Spacing.xs, letterSpacing: 1 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowText: { flex: 1, gap: 2, paddingRight: Spacing.md },
  alertText: { flex: 1, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginLeft: Spacing.lg },
  footer: { marginTop: Spacing.xl, alignItems: 'center', gap: 4 },
});
