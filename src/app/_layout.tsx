import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AlertHost } from '@/components/AlertHost';
import { SymbolMenuProvider } from '@/components/SymbolMenu';
import { Colors } from '@/constants/theme';
import { AlertWatcher } from '@/hooks/useAlertWatcher';
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

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: queryPersister, maxAge: PERSIST_MAX_AGE, buster: '1' }}>
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
            <AlertHost />
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
