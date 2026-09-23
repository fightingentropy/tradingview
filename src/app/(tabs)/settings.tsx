import { notificationErrorMessage } from '@/lib/userMessages';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Fragment, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { HlAccountCard } from '@/components/HlAccountCard';
import { AppText } from '@/components/ui/AppText';
import { GlassToggle } from '@/components/ui/GlassToggle';
import { Screen } from '@/components/ui/Screen';
import { Colors, Spacing } from '@/constants/theme';
import { useAllMarkets } from '@/data/useMarkets';
import {
  ALL_NEWS_NOTIFICATION_SOURCE_IDS,
  NEWS_NOTIFICATION_SOURCES,
  normalizeNewsNotificationSourceIds,
} from '@/domain/newsNotificationSources';
import { priceAlertDeliveryLabel, priceMonitorLabel } from '@/domain/priceAlerts';
import { formatPrice, formatProbability } from '@/lib/format';
import {
  registerNewsPushNotifications,
  unregisterNewsPushNotifications,
} from '@/lib/newsPush';
import { buildRemotePriceRules } from '@/lib/priceAlertRegistration';
import { setRemotePriceAlertsEnabled, syncRemotePriceAlerts } from '@/lib/priceAlertSync';
import { useAlerts } from '@/store/alerts';
import { useChartSettings } from '@/store/chartSettings';
import { SMALL_BALANCE_USD, usePreferences } from '@/store/preferences';
import { usePriceMonitor } from '@/store/priceMonitor';
import { useWatchlists } from '@/store/watchlists';

function StatusRow({ label, detail }: { label: string; detail: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={styles.statusIcon}>
          <Ionicons name="server-outline" size={15} color={Colors.textMuted} />
        </View>
        <AppText variant="body">{label}</AppText>
      </View>
      <AppText variant="caption" color={Colors.textFaint}>
        {detail}
      </AppText>
    </View>
  );
}

function formatAlertPrice(instrumentId: string, value: number | null): string {
  return instrumentId.startsWith('hl:outcome:')
    ? formatProbability(value)
    : formatPrice(value);
}

export default function SettingsScreen() {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const resetDefaults = useWatchlists((s) => s.resetDefaults);
  const alerts = useAlerts((s) => s.alerts);
  const removeAlert = useAlerts((s) => s.remove);
  const clearAlerts = useAlerts((s) => s.clearAll);
  const hideSmallBalances = usePreferences((s) => s.hideSmallBalances);
  const setHideSmallBalances = usePreferences((s) => s.setHideSmallBalances);
  const showOutcomeMarkets = usePreferences((s) => s.showOutcomeMarkets);
  const setShowOutcomeMarkets = usePreferences((s) => s.setShowOutcomeMarkets);
  const showPosition = useChartSettings((s) => s.showPosition);
  const setShowPosition = useChartSettings((s) => s.setShowPosition);
  const alertNotifications = usePreferences((s) => s.alertNotifications);
  const disablePriceAlertsPending = usePreferences((s) => s.priceAlertsDisablePending);
  const monitor = usePriceMonitor();
  const { data: markets } = useAllMarkets();
  let alertChangesPending = false;
  try {
    alertChangesPending = monitor.syncedRules !== JSON.stringify(buildRemotePriceRules(alerts, markets?.byId ?? {}, showOutcomeMarkets));
  } catch { alertChangesPending = true; }
  const newsNotifications = usePreferences((s) => s.newsNotifications);
  const setNewsNotifications = usePreferences((s) => s.setNewsNotifications);
  const storedNewsNotificationSources = usePreferences((s) => s.newsNotificationSources);
  const setNewsNotificationSources = usePreferences((s) => s.setNewsNotificationSources);
  const newsNotificationSources = normalizeNewsNotificationSourceIds(
    storedNewsNotificationSources,
  );

  const onReset = () =>
    Alert.alert('Reset watchlists?', 'Restores your default watchlist and theme lists.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetDefaults },
    ]);

  const onToggleNotifications = async (value: boolean) => {
    if (pendingAction) return;
    setPendingAction('price-alerts');
    try {
      await setRemotePriceAlertsEnabled(value);
    } catch (error) {
      Alert.alert(
        'Price alerts unavailable',
        notificationErrorMessage(error),
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
        notificationErrorMessage(error),
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
        notificationErrorMessage(error),
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={styles.container}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <AppText variant="caption" muted style={styles.sectionLabel}>
          ACCOUNT
        </AppText>
        <HlAccountCard />

        <AppText variant="caption" muted style={styles.sectionLabel}>
          DISPLAY
        </AppText>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <AppText variant="body">Outcome markets</AppText>
              <AppText variant="caption" muted>
                Browse predictions. View only.
              </AppText>
            </View>
            <GlassToggle
              value={showOutcomeMarkets}
              onValueChange={setShowOutcomeMarkets}
              accessibilityLabel="Show Hyperliquid Outcomes tab"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <AppText variant="body">Hide small balances</AppText>
              <AppText variant="caption" muted>
                Under ${SMALL_BALANCE_USD}
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
              <AppText variant="body">Positions on charts</AppText>
            </View>
            <GlassToggle
              value={showPosition}
              onValueChange={setShowPosition}
              accessibilityLabel="Position and PnL on charts"
            />
          </View>
        </View>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          PRICE ALERTS
        </AppText>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <AppText variant="body">Price notifications</AppText>
              <AppText variant="caption" muted>
                Runs on your Mac mini, even when this app is closed.
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
          {alertNotifications || monitor.error ? (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <AppText variant="caption" muted>
                    {disablePriceAlertsPending ? 'Alerts may stay active until your Mac mini confirms.' : monitor.error ?? (alertChangesPending
                      ? 'Previous alerts stay active until changes are saved.'
                      : priceMonitorLabel(monitor.result, monitor.sources))}
                  </AppText>
                </View>
                <Pressable disabled={monitor.syncing} accessibilityRole="button" accessibilityLabel="Retry price alert sync"
                  onPress={() => void syncRemotePriceAlerts().catch(() => undefined)}>
                  {monitor.syncing ? <ActivityIndicator size="small" color={Colors.textMuted} /> : <Ionicons name="refresh-outline" size={18} color={Colors.textMuted} />}
                </Pressable>
              </View>
            </>
          ) : null}
        </View>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          SAVED PRICE ALERTS
        </AppText>
        <View style={styles.card}>
          {alerts.length === 0 ? (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="notifications-outline" size={16} color={Colors.textMuted} />
                </View>
                <AppText variant="caption" muted style={styles.emptyText}>
                  Hold a symbol to add an alert.
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
                    {a.remoteTriggered ? (
                      <AppText variant="caption" muted>
                        {(() => {
                          const event = monitor.result?.events.find(event => event.alertId === a.id && event.createdAt === a.createdAt);
                          return event ? priceAlertDeliveryLabel(event.delivery) : 'Previously triggered on Mac mini';
                        })()}
                      </AppText>
                    ) : null}
                    <AppText variant="caption" muted>
                      {a.triggeredAt
                        ? `Triggered @ ${formatAlertPrice(a.instrumentId, a.triggeredPrice)}`
                        : `From ${formatAlertPrice(a.instrumentId, a.anchorPrice)}`}
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
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
              onPress={clearAlerts}>
              <View style={styles.rowLeft}>
                <Ionicons name="trash-outline" size={18} color={Colors.text} />
                <AppText variant="body">Clear all alerts</AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textFaint} />
            </Pressable>
          </View>
        ) : null}

        <AppText variant="caption" muted style={styles.sectionLabel}>
          NEWS ALERTS
        </AppText>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <AppText variant="body">Push notifications</AppText>
              <AppText variant="caption" muted>
                From the sources below
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
        </View>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          DATA SOURCES
        </AppText>
        <View style={styles.card}>
          <StatusRow label="Hyperliquid" detail="Live" />
          <View style={styles.divider} />
          <StatusRow label="trade.xyz" detail="Live" />
          <View style={styles.divider} />
          <StatusRow label="VIX · Cboe" detail="Delayed" />
        </View>

        <AppText variant="caption" muted style={styles.sectionLabel}>
          WATCHLISTS
        </AppText>
        <View style={styles.card}>
          <Pressable style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]} onPress={onReset}>
            <View style={styles.rowLeft}>
              <Ionicons name="refresh" size={18} color={Colors.text} />
              <AppText variant="body">Reset to defaults</AppText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textFaint} />
          </Pressable>
        </View>

        <View style={styles.footer}>
          <AppText variant="caption" muted>
            Version {Constants.expoConfig?.version ?? '1.0.0'}
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxxl,
    gap: 0,
  },
  sectionLabel: {
    marginTop: Spacing.xl,
    marginBottom: 8,
    color: Colors.textFaint,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
  card: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 68,
    paddingHorizontal: 0,
    paddingVertical: 14,
  },
  actionRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
  },
  rowPressed: { backgroundColor: Colors.surfaceAlt },
  rowLeft: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowText: { flex: 1, gap: 3, paddingRight: Spacing.lg },
  sourceRow: { paddingLeft: Spacing.md },
  alertText: { flex: 1, gap: 2 },
  statusIcon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',

  },
  emptyIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',

  },
  emptyText: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  footer: { marginTop: Spacing.xl, marginBottom: Spacing.lg, gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.lg },
});
