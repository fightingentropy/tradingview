import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import type { MarketsData } from '@/data/useMarkets';
import type { PriceAlertSyncResult } from '@/domain/priceAlerts';
import { formatPercent, formatPrice, formatProbability } from '@/lib/format';
import { ensureNotificationPermission, hasNotificationPermission } from '@/lib/notifications';
import { buildRemotePriceRules, priceAlertNotificationMatch } from '@/lib/priceAlertRegistration';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { newsFeedEndpoint, newsRelayAccessToken } from '@/providers/news/client';
import { useAlertFeed } from '@/store/alertFeed';
import { useAlerts } from '@/store/alerts';
import { usePreferences } from '@/store/preferences';
import { usePriceMonitor } from '@/store/priceMonitor';

const TOKEN_KEY = 'price-alerts.expo-push-token';
let currentToken: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function refreshPriceAlertPushToken(): void { currentToken = null; }

function endpoint(): string {
  if (!newsFeedEndpoint || !newsRelayAccessToken) throw new Error('The remote price alert service is not configured.');
  const url = new URL(newsFeedEndpoint);
  if (url.protocol !== 'https:') throw new Error('Remote price alerts require the configured secure relay.');
  url.pathname = '/price-alerts/sync'; url.search = ''; url.hash = '';
  return url.toString();
}

async function request(enabled: boolean, expoPushToken: string, rules: unknown[] = []): Promise<PriceAlertSyncResult> {
  // The first token is a stable registration identity, even when APNs/Expo rotates
  // the delivery address. Keeping one relay record preserves unknown completions.
  const registrationToken = await SecureStore.getItemAsync(TOKEN_KEY) ?? expoPushToken;
  const response = await fetch(endpoint(), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newsRelayAccessToken}` },
    body: JSON.stringify({ expoPushToken, registrationToken, enabled, rules }), signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Price alert sync failed (${response.status}). Changes will retry while the app is open.`);
  const result = await response.json() as PriceAlertSyncResult;
  if (!result || !Array.isArray(result.events) || !Number.isSafeInteger(result.revision) || result.enabled !== enabled) throw new Error('The price alert service returned an invalid response.');
  return result;
}

async function token(prompt: boolean): Promise<string> {
  if (Platform.OS === 'web') throw new Error('Mac mini notifications require the iPhone app.');
  const allowed = prompt ? await ensureNotificationPermission() : await hasNotificationPermission();
  if (!allowed) throw new Error('Enable TradingView notifications in iOS Settings to receive price alerts.');
  if (currentToken) return currentToken;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || !projectId) throw new Error('The Expo push project is not configured.');
  const next = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const previous = await SecureStore.getItemAsync(TOKEN_KEY);
  // Save once before registration. Updating the delivery token never changes the
  // relay identity or deletes events that this phone has not ingested yet.
  if (!previous) await SecureStore.setItemAsync(TOKEN_KEY, next);
  currentToken = next;
  return next;
}

export function applyRemotePriceNotification(data: Record<string, unknown>): string | null {
  const match = priceAlertNotificationMatch(data, useAlerts.getState().alerts);
  if (!match) return null;
  const { alert, price, triggeredAt, changePct } = match;
  const applied = useAlerts.getState().markRemoteTriggered(alert.id, alert.createdAt, price, triggeredAt);
  if (applied && AppState.currentState === 'active') {
    const displayed = alert.instrumentId.startsWith('hl:outcome:') ? formatProbability(price) : formatPrice(price);
    useAlertFeed.getState().push({ id: `${alert.id}:${alert.createdAt}`, instrumentId: alert.instrumentId,
      symbol: alert.symbol, changePct, message: `${formatPercent(changePct)} · ${displayed}` });
  }
  return alert.instrumentId;
}

async function sync(force?: boolean): Promise<void> {
  usePriceMonitor.setState({ syncing: true });
  try {
    const preferences = usePreferences.getState();
    const enabled = force ?? (preferences.priceAlertsDisablePending ? false : preferences.alertNotifications);
    if (!enabled) {
      const previous = currentToken ?? await SecureStore.getItemAsync(TOKEN_KEY);
      const result = previous ? await request(false, previous) : null;
      for (const event of result?.events ?? []) applyRemotePriceNotification({ ...event, type: 'price-alert' });
      usePreferences.getState().setAlertNotifications(false);
      usePreferences.getState().setPriceAlertsDisablePending(false);
      usePriceMonitor.setState({ result, error: null, syncedRules: null, sources: [], checkedAt: Date.now() });
      return;
    }
    const expoPushToken = await token(force === true);
    // A foreground alert can fire while permission/token acquisition is pending.
    // Re-read immediately before switching trigger authority to the Mac mini.
    const markets = queryClient.getQueryData<MarketsData>(queryKeys.instruments());
    const rules = buildRemotePriceRules(useAlerts.getState().alerts, markets?.byId ?? {}, usePreferences.getState().showOutcomeMarkets);
    if (force === true) usePreferences.getState().setAlertNotifications(true);
    // If this response is lost, keep remote authority and show pending/error state:
    // the request may already have registered, so local triggering must stay paused.
    const result = await request(true, expoPushToken, rules);
    if (force !== undefined) usePreferences.getState().setAlertNotifications(true);
    usePriceMonitor.setState({ result, error: null, syncedRules: JSON.stringify(rules),
      sources: [...new Set(rules.map(rule => rule.coinKey.startsWith('xyz:') ? 'xyz' : rule.source))], checkedAt: Date.now() });
    for (const event of result.events) applyRemotePriceNotification({ ...event, type: 'price-alert' });
  } catch (error) {
    usePriceMonitor.setState({ error: error instanceof Error ? error.message : 'Price alert sync failed.' });
    throw error;
  } finally { usePriceMonitor.setState({ syncing: false }); }
}

/** Every task reads current state only when it owns the queue; older requests cannot undo a toggle. */
export function syncRemotePriceAlerts(): Promise<void> {
  const operation = queue.then(() => sync());
  queue = operation.catch(() => undefined);
  return operation;
}

export function setRemotePriceAlertsEnabled(enabled: boolean): Promise<void> {
  // Persist intent immediately even when an older network request owns the queue.
  usePreferences.getState().setPriceAlertsDisablePending(!enabled);
  const operation = queue.then(() => sync(enabled));
  queue = operation.catch(() => undefined);
  return operation;
}
