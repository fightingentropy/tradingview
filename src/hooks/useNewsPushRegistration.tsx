import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import {
  normalizeNewsNotificationSourceIds,
  parseNewsNotificationItemId,
} from '@/domain/newsNotificationSources';
import { registerNewsPushNotifications } from '@/lib/newsPush';
import { usePreferences } from '@/store/preferences';

function openNotification(response: Notifications.NotificationResponse): void {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

  const data = response.notification.request.content.data;
  if (data?.type !== 'news') return;

  const target = parseNewsNotificationItemId(data.itemId);
  router.push(
    target
      ? {
          pathname: '/news',
          params: { itemId: target.itemId },
        }
      : '/news',
  );

  // A handled cold-start response otherwise remains available and can send a
  // later ordinary launch back to the same article.
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Routing already succeeded; clearing is best-effort for custom native builds.
  }
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
        if (initial?.notification) openNotification(initial);
      } catch {
        // A custom native build may omit the emitter; live routing can still be attempted below.
      }
    }

    if (typeof Notifications.addNotificationResponseReceivedListener === 'function') {
      try {
        subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          openNotification(response);
        });
      } catch {
        // Keep launch reliable when the optional native capability is unavailable.
      }
    }

    return () => subscription?.remove();
  }, []);

  return null;
}
