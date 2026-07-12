import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { normalizeNewsNotificationSourceIds } from '@/domain/newsNotificationSources';
import { registerNewsPushNotifications } from '@/lib/newsPush';
import { usePreferences } from '@/store/preferences';

function openNotification(notification: Notifications.Notification): void {
  if (notification.request.content.data?.type === 'news') router.push('/news');
}

/** Keeps the push token current and routes notification taps into the News tab. */
export function NewsPushRegistration() {
  const enabled = usePreferences((state) => state.newsNotifications);

  useEffect(() => {
    const sourceIds = normalizeNewsNotificationSourceIds(
      usePreferences.getState().newsNotificationSources,
    );
    if (Platform.OS !== 'web' && enabled && sourceIds.length > 0) {
      void registerNewsPushNotifications(sourceIds).catch(() => undefined);
    }
  }, [enabled]);

  useEffect(() => {
    // Expo's notification-response APIs are Android/iOS-only in SDK 56. The
    // exported functions still exist on web but throw when their native emitter
    // capability is absent, which used to crash the web app during mount.
    if (Platform.OS === 'web') return;

    let subscription: ReturnType<
      typeof Notifications.addNotificationResponseReceivedListener
    > | null = null;

    if (typeof Notifications.getLastNotificationResponse === 'function') {
      try {
        const initial = Notifications.getLastNotificationResponse();
        if (initial?.notification) openNotification(initial.notification);
      } catch {
        // A custom native build may omit the emitter; live routing can still be attempted below.
      }
    }

    if (typeof Notifications.addNotificationResponseReceivedListener === 'function') {
      try {
        subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          openNotification(response.notification);
        });
      } catch {
        // Keep launch reliable when the optional native capability is unavailable.
      }
    }

    return () => subscription?.remove();
  }, []);

  return null;
}
