import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AlertHost } from '@/components/AlertHost';
import { SymbolMenuProvider } from '@/components/SymbolMenu';
import { Colors } from '@/constants/theme';
import { AlertWatcher } from '@/hooks/useAlertWatcher';
import { NewsPushRegistration } from '@/hooks/useNewsPushRegistration';
import { PERSIST_MAX_AGE, queryClient, queryPersister } from '@/lib/queryClient';

// Victory Native's candlestick paths emit Skia path deprecation warnings; harmless and noisy.
LogBox.ignoreLogs([/SkPath\..*is deprecated/, '[react-native-skia]']);

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.background,
    card: Colors.background,
    text: Colors.text,
    border: Colors.border,
    primary: Colors.accent,
    notification: Colors.down,
  },
};

/**
 * App-wide last-resort safety net. Expo Router wraps the app in this React error
 * boundary, so an uncaught render error shows a recoverable screen + Reload
 * instead of hard-crashing — which on a real-funds trading app is the difference
 * between a stray glitch and losing the session mid-trade. It renders outside the
 * app providers, so it sticks to plain views + the static theme constants.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackTitle}>Something went wrong</Text>
      <Text style={styles.fallbackMsg} numberOfLines={4}>
        {error.message}
      </Text>
      <Pressable onPress={retry} style={styles.fallbackBtn}>
        <Text style={styles.fallbackBtnText}>Reload</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: PERSIST_MAX_AGE,
            buster: '3',
            // A connected News feed may contain posts from private Telegram
            // channels. Keep that cache in memory only, never in MMKV.
            dehydrateOptions: {
              shouldDehydrateQuery: (query) => query.queryKey[0] !== 'news-feed',
            },
          }}>
          <ThemeProvider value={navTheme}>
            <StatusBar style="light" />
            <SymbolMenuProvider>
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: Colors.background },
                  headerTintColor: Colors.text,
                  headerShadowVisible: false,
                  headerBackButtonDisplayMode: 'minimal',
                  contentStyle: { backgroundColor: Colors.background },
                }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="symbol/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="lists" options={{ headerShown: false }} />
                <Stack.Screen
                  name="add-symbols"
                  options={{ headerShown: false, presentation: 'modal' }}
                />
              </Stack>
            </SymbolMenuProvider>
            <AlertWatcher />
            <NewsPushRegistration />
            <AlertHost />
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  fallbackTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  fallbackMsg: { color: Colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  fallbackBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
  },
  fallbackBtnText: { color: Colors.accent, fontSize: 15, fontWeight: '600' },
});
