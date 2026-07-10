import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { registerNewsPushNotifications } from '@/lib/newsPush';
import { usePreferences } from '@/store/preferences';

function openNotification(notification: Notifications.Notification): void {
  if (notification.request.content.data?.type === 'news') router.push('/news');
}

/** Keeps the push token current and routes notification taps into the News tab. */
export function NewsPushRegistration() {
  const enabled = usePreferences((state) => state.newsNotifications);

  useEffect(() => {
    if (enabled) void registerNewsPushNotifications().catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    const initial = Notifications.getLastNotificationResponse();
    if (initial?.notification) openNotification(initial.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      openNotification(response.notification);
    });
    return () => subscription.remove();
  }, []);

  return null;
}
