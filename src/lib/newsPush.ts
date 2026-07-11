import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  ALL_NEWS_NOTIFICATION_SOURCE_IDS,
  normalizeNewsNotificationSourceIds,
} from '@/domain/newsNotificationSources';
import { ensureNotificationPermission } from '@/lib/notifications';
import { newsFeedEndpoint, newsRelayAccessToken } from '@/providers/news/client';

const TOKEN_KEY = 'news.expo-push-token';

function registrationUrl(): URL {
  if (!newsFeedEndpoint) throw new Error('The news feed service is not configured.');
  const url = new URL(newsFeedEndpoint);
  url.pathname = '/push/register';
  url.search = '';
  return url;
}

async function updateBridge(
  method: 'POST' | 'DELETE',
  expoPushToken: string,
  sourceIds?: readonly string[],
): Promise<void> {
  const response = await fetch(registrationUrl(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(newsRelayAccessToken ? { Authorization: `Bearer ${newsRelayAccessToken}` } : {}),
    },
    body: JSON.stringify({
      expoPushToken,
      ...(method === 'POST'
        ? { sourceIds: normalizeNewsNotificationSourceIds(sourceIds) }
        : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`News notification service returned ${response.status}.`);
}

export async function registerNewsPushNotifications(
  sourceIds: readonly string[] = ALL_NEWS_NOTIFICATION_SOURCE_IDS,
): Promise<string> {
  if (Platform.OS === 'web') throw new Error('Push notifications require the native app.');
  if (!(await ensureNotificationPermission())) throw new Error('Notification permission was denied.');

  const normalizedSourceIds = normalizeNewsNotificationSourceIds(sourceIds);
  if (normalizedSourceIds.length === 0) {
    throw new Error('Choose at least one news source first.');
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error('The Expo project ID is not configured yet.');
  }

  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await updateBridge('POST', expoPushToken, normalizedSourceIds);
  await SecureStore.setItemAsync(TOKEN_KEY, expoPushToken);
  return expoPushToken;
}

export async function unregisterNewsPushNotifications(): Promise<void> {
  const expoPushToken = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!expoPushToken) return;
  try {
    await updateBridge('DELETE', expoPushToken);
  } finally {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}
