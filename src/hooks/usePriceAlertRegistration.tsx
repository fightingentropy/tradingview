import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { unregisterAlertTask } from '@/lib/alertTask';
import { applyRemotePriceNotification, refreshPriceAlertPushToken, syncRemotePriceAlerts } from '@/lib/priceAlertSync';
import { queryClient } from '@/lib/queryClient';
import { useAlerts } from '@/store/alerts';
import { usePreferences } from '@/store/preferences';

export function PriceAlertRegistration() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void unregisterAlertTask();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (AppState.currentState === 'active') void syncRemotePriceAlerts().catch(() => undefined);
      }, 250);
    };
    sync();
    const alerts = useAlerts.subscribe(sync);
    const preferences = usePreferences.subscribe((next, previous) => {
      if (next.alertNotifications !== previous.alertNotifications || next.showOutcomeMarkets !== previous.showOutcomeMarkets ||
          next.priceAlertsDisablePending !== previous.priceAlertsDisablePending) sync();
    });
    const catalog = queryClient.getQueryCache().subscribe(event => {
      if (event.type === 'updated' && event.query.queryKey[0] === 'instruments' && event.action.type === 'success') sync();
    });
    const active = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
    const interval = setInterval(() => {
      if (usePreferences.getState().alertNotifications) sync();
    }, 15_000);
    return () => { clearTimeout(debounce); clearInterval(interval); alerts(); preferences(); catalog(); active.remove(); };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (response: Notifications.NotificationResponse) => {
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = response.notification.request.content.data;
      if (data?.type !== 'price-alert') return;
      const instrumentId = applyRemotePriceNotification(data);
      if (instrumentId) router.push({ pathname: '/symbol/[id]', params: { id: instrumentId } });
      try { Notifications.clearLastNotificationResponse(); } catch { /* Routing already handled. */ }
    };
    try {
      const initial = Notifications.getLastNotificationResponse();
      if (initial) open(initial);
    } catch { /* Custom builds can omit the native notification emitter. */ }
    const received = Notifications.addNotificationReceivedListener(notification => {
      if (notification.request.content.data?.type !== 'price-alert') return;
      applyRemotePriceNotification(notification.request.content.data);
      void syncRemotePriceAlerts().catch(() => undefined);
    });
    const response = Notifications.addNotificationResponseReceivedListener(open);
    const token = Notifications.addPushTokenListener(() => {
      refreshPriceAlertPushToken();
      void syncRemotePriceAlerts().catch(() => undefined);
    });
    return () => { received.remove(); response.remove(); token.remove(); };
  }, []);
  return null;
}
