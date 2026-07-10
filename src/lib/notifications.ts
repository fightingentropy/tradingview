/**
 * Local (on-device) notifications for price alerts — no push server involved. Used by
 * the in-app {@link AlertWatcher} when a symbol trips while the app is open, and by the
 * background task when it isn't.
 */
import * as Notifications from 'expo-notifications';

let handlerInstalled = false;

/**
 * Install the foreground presentation handler once. We suppress the in-app banner (the
 * app already shows its own AlertHost toast while open) but keep the notification in the
 * list. Notifications delivered while the app is backgrounded or closed are shown by the
 * OS as normal banners regardless of this handler.
 */
export function configureNotifications(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const isRemoteNews = notification.request.content.data?.type === 'news';
      return {
        shouldShowBanner: isRemoteNews,
        shouldShowList: true,
        shouldPlaySound: isRemoteNews,
        shouldSetBadge: false,
      };
    },
  });
}

/** Whether notification permission is currently granted, without prompting. */
export async function hasNotificationPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

/**
 * Request notification permission if it hasn't been decided yet; returns whether it's
 * granted. Safe to call repeatedly — resolves immediately once already granted/denied.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const next = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return next.granted;
}

/** Fire an immediate local notification for a tripped price alert. */
export async function notifyPriceAlert(
  symbol: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: `${symbol} price alert`, body, data, sound: true },
    trigger: null,
  });
}
