import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Fragment, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { HlAccountCard } from '@/components/HlAccountCard';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { GlassToggle } from '@/components/ui/GlassToggle';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Spacing } from '@/constants/theme';
import {
  ALL_NEWS_NOTIFICATION_SOURCE_IDS,
  NEWS_NOTIFICATION_SOURCES,
  normalizeNewsNotificationSourceIds,
} from '@/domain/newsNotificationSources';
import { registerAlertTask, unregisterAlertTask } from '@/lib/alertTask';
import { formatPrice } from '@/lib/format';
import { ensureNotificationPermission } from '@/lib/notifications';
import {
  registerNewsPushNotifications,
  unregisterNewsPushNotifications,
} from '@/lib/newsPush';
import { useAlerts } from '@/store/alerts';
import { useChartSettings } from '@/store/chartSettings';
import { SMALL_BALANCE_USD, usePreferences } from '@/store/preferences';
import { useWatchlists } from '@/store/watchlists';

function StatusRow({ label, detail }: { label: string; detail: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={styles.statusIcon}>
          <Ionicons name="checkmark" size={11} color="#050506" />
        </View>
        <AppText variant="body">{label}</AppText>
      </View>
      <AppText variant="caption" color={Colors.textFaint}>
        {detail}
      </AppText>
    </View>
  );
}

export default function SettingsScreen() {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const resetDefaults = useWatchlists((s) => s.resetDefaults);
  const alerts = useAlerts((s) => s.alerts);
  const removeAlert = useAlerts((s) => s.remove);
  const clearAlerts = useAlerts((s) => s.clearAll);
  const hideSmallBalances = usePreferences((s) => s.hideSmallBalances);
  const setHideSmallBalances = usePreferences((s) => s.setHideSmallBalances);
  const showPosition = useChartSettings((s) => s.showPosition);
  const setShowPosition = useChartSettings((s) => s.setShowPosition);
  const alertNotifications = usePreferences((s) => s.alertNotifications);
  const setAlertNotifications = usePreferences((s) => s.setAlertNotifications);
  const newsNotifications = usePreferences((s) => s.newsNotifications);
  const setNewsNotifications = usePreferences((s) => s.setNewsNotifications);
  const storedNewsNotificationSources = usePreferences((s) => s.newsNotificationSources);
  const setNewsNotificationSources = usePreferences((s) => s.setNewsNotificationSources);
  const newsNotificationSources = normalizeNewsNotificationSourceIds(
    storedNewsNotificationSources,
  );

  const onReset = () =>
    Alert.alert('Reset watchlists?', 'Restores the default Crypto and Stocks lists.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetDefaults },
    ]);

  const onToggleNotifications = async (value: boolean) => {
    if (pendingAction) return;
    setPendingAction('price-alerts');
    try {
      if (!value) {
        setAlertNotifications(false);
        await unregisterAlertTask();
        return;
      }
      const granted = await ensureNotificationPermission();
      if (!granted) {
        Alert.alert(
          'Notifications are off',
          'Enable notifications for TradingView in iOS Settings to receive price alerts.',
        );
        return;
      }
      await registerAlertTask();
      setAlertNotifications(true);
    } catch (error) {
      if (value) setAlertNotifications(false);
      Alert.alert(
        'Price alerts unavailable',
        error instanceof Error ? error.message : 'Could not update price alert notifications.',
      );
    } finally {
      setPendingAction(null);
    }
  };

  const onToggleNewsNotifications = async (value: boolean) => {
    if (pendingAction) return;
    setPendingAction('news-alerts');
    try {
      if (!value) {
        setNewsNotifications(false);
        await unregisterNewsPushNotifications().catch(() => undefined);
        return;
      }
      const sourceIds =
        newsNotificationSources.length > 0
          ? newsNotificationSources
          : [...ALL_NEWS_NOTIFICATION_SOURCE_IDS];
      if (newsNotificationSources.length === 0) setNewsNotificationSources(sourceIds);
      await registerNewsPushNotifications(sourceIds);
      setNewsNotifications(true);
    } catch (error) {
      Alert.alert(
        'News alerts unavailable',
        error instanceof Error ? error.message : 'Could not register this device for news alerts.',
      );
    } finally {
      setPendingAction(null);
    }
  };

  const onToggleNewsSource = async (sourceId: string, value: boolean) => {
    if (pendingAction) return;
    setPendingAction(`news-source:${sourceId}`);
    const previous = newsNotificationSources;
    const next = value
      ? normalizeNewsNotificationSourceIds([...previous, sourceId])
      : previous.filter((id) => id !== sourceId);
    setNewsNotificationSources(next);

    try {
      if (!newsNotifications) return;
      if (next.length === 0) {
        setNewsNotifications(false);
        await unregisterNewsPushNotifications().catch(() => undefined);
        return;
      }
      await registerNewsPushNotifications(next);
    } catch (error) {
      setNewsNotificationSources(previous);
      Alert.alert(
        'Could not update news alerts',
        error instanceof Error ? error.message : 'The selected sources could not be saved.',
      );
    } finally {
      setPendingAction(null);
    }
  };

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
        <GlassSurface style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <AppText variant="body">Hide small balances</AppText>
              <AppText variant="caption" muted>
                Hide spot balances worth under ${SMALL_BALANCE_USD}.
              </AppText>
            </View>
            <GlassToggle
              value={hideSmallBalances}
              onValueChange={setHideSmallBalances}
              accessibilityLabel="Hide small balances"
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
            <GlassToggle
              value={showPosition}
              onValueChange={setShowPosition}
              accessibilityLabel="Position and PnL on charts"
            />
          </View>
        </GlassSurface>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          DATA SOURCES
        </AppText>
        <GlassSurface style={styles.card}>
          <StatusRow label="Hyperliquid" detail="Live · keyless" />
          <View style={styles.divider} />
          <StatusRow label="trade.xyz perps" detail="Live · keyless" />
          <View style={styles.divider} />
          <StatusRow label="VIX · Cboe" detail="Live · keyless" />
        </GlassSurface>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          WATCHLISTS
        </AppText>
        <GlassSurface style={styles.card} interactive>
          <Pressable style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]} onPress={onReset}>
            <View style={styles.rowLeft}>
              <Ionicons name="refresh" size={18} color={Colors.text} />
              <AppText variant="body">Reset to defaults</AppText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textFaint} />
          </Pressable>
        </GlassSurface>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          PRICE ALERTS
        </AppText>
        <GlassSurface style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <AppText variant="body">Notify me</AppText>
              <AppText variant="caption" muted>
                Get a notification when an alert triggers, even in the background.
              </AppText>
            </View>
            <GlassToggle
              value={alertNotifications}
              onValueChange={onToggleNotifications}
              disabled={pendingAction !== null}
              loading={pendingAction === 'price-alerts'}
              accessibilityLabel="Price alert notifications"
            />
          </View>
        </GlassSurface>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          NEWS ALERTS
        </AppText>
        <GlassSurface style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <AppText variant="body">Push notifications</AppText>
              <AppText variant="caption" muted>
                Notify me only when a selected feed source publishes.
              </AppText>
            </View>
            <GlassToggle
              value={newsNotifications}
              onValueChange={onToggleNewsNotifications}
              disabled={pendingAction !== null}
              loading={pendingAction === 'news-alerts'}
              accessibilityLabel="News push notifications"
            />
          </View>
          {NEWS_NOTIFICATION_SOURCES.map((source) => (
            <Fragment key={source.id}>
              <View style={styles.divider} />
              <View style={[styles.row, styles.sourceRow]}>
                <View style={styles.rowText}>
                  <AppText variant="body">{source.label}</AppText>
                  <AppText variant="caption" muted>
                    {source.detail}
                  </AppText>
                </View>
                <GlassToggle
                  value={newsNotificationSources.includes(source.id)}
                  onValueChange={(value) => void onToggleNewsSource(source.id, value)}
                  disabled={pendingAction !== null}
                  loading={pendingAction === `news-source:${source.id}`}
                  accessibilityLabel={`${source.label} news alerts`}
                />
              </View>
            </Fragment>
          ))}
        </GlassSurface>
        <GlassSurface style={styles.card}>
          {alerts.length === 0 ? (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="notifications-outline" size={16} color={Colors.textMuted} />
                </View>
                <AppText variant="caption" muted style={styles.emptyText}>
                  Long-press (or right-click) any symbol to set one.
                </AppText>
              </View>
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
        </GlassSurface>
        {alerts.length > 0 ? (
          <GlassSurface style={styles.card} interactive>
            <Pressable
              style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
              onPress={clearAlerts}>
              <View style={styles.rowLeft}>
                <Ionicons name="trash-outline" size={18} color={Colors.text} />
                <AppText variant="body">Clear all alerts</AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textFaint} />
            </Pressable>
          </GlassSurface>
        ) : null}

        <View style={styles.footer}>
          <AppText variant="caption" muted>
            TradingView Clone · v{Constants.expoConfig?.version ?? '1.0.0'}
          </AppText>
          <AppText variant="caption" muted>
            Data: Hyperliquid + trade.xyz + Cboe
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxl,
    gap: 10,
  },
  sectionLabel: {
    marginTop: Spacing.lg,
    marginLeft: 6,
    color: 'rgba(235,235,245,0.46)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.35,
  },
  card: { borderRadius: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 66,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 13,
  },
  actionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.065)' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowText: { flex: 1, gap: 3, paddingRight: Spacing.lg },
  sourceRow: { paddingLeft: Spacing.lg },
  alertText: { flex: 1, gap: 2 },
  statusIcon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  emptyIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  emptyText: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.075)',
  },
  footer: { marginTop: Spacing.xl, marginBottom: Spacing.lg, alignItems: 'center', gap: 4 },
});
