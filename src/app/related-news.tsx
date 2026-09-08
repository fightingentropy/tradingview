import { Ionicons } from '@expo/vector-icons';
import { useIsRestoring } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { InstrumentNews } from '@/components/InstrumentNews';
import { AppText } from '@/components/ui/AppText';
import { Colors, Spacing } from '@/constants/theme';
import { useAllMarkets } from '@/data/useMarkets';
import type { Instrument } from '@/domain/types';
import { useWatchlists } from '@/store/watchlists';

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default function RelatedNewsScreen() {
  const params = useLocalSearchParams<{ watchlistId?: string | string[]; instrumentId?: string | string[] }>();
  const watchlistId = first(params.watchlistId);
  const instrumentId = first(params.instrumentId);
  const router = useRouter();
  const list = useWatchlists((state) => state.lists.find((candidate) => candidate.id === watchlistId));
  const { data, isLoading, isError, refetch } = useAllMarkets();
  const restoring = useIsRestoring();
  const instruments = useMemo(() => {
    const ids = instrumentId ? [instrumentId] : list?.symbolIds ?? [];
    return ids.map((id) => data?.byId[id]).filter((instrument): instrument is Instrument => Boolean(instrument));
  }, [instrumentId, list?.symbolIds, data?.byId]);
  const title = instrumentId ? `${instruments[0]?.symbol ?? 'Market'} news` : `${list?.name ?? 'Watchlist'} news`;
  const missingCount = (instrumentId ? 1 : list?.symbolIds.length ?? 0) - instruments.length;

  return (
    <View style={[styles.screen, Platform.OS === 'web' && styles.webScreen]}>
      {Platform.OS !== 'web' ? <Stack.Screen options={{ headerShown: true, title }} /> : (
        <View style={styles.webHeader}>
          <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/news')} accessibilityRole="button" accessibilityLabel="Back to news"><Ionicons name="arrow-back" size={22} color={Colors.text} /></Pressable>
          <AppText variant="heading">{title}</AppText>
        </View>
      )}
      {(isLoading || restoring) && instruments.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : isError && instruments.length === 0 ? (
        <View style={styles.center}><AppText muted>Couldn’t load these markets.</AppText><Pressable onPress={() => void refetch()} accessibilityRole="button"><AppText color={Colors.accent}>Try again</AppText></Pressable></View>
      ) : !instrumentId && !list ? (
        <View style={styles.center}><AppText variant="heading">Watchlist not found</AppText><AppText muted>This list may have been removed.</AppText></View>
      ) : instruments.length === 0 ? (
        <View style={styles.center}><AppText variant="heading">{missingCount > 0 ? 'Markets unavailable' : 'This watchlist is empty'}</AppText><AppText muted>{missingCount > 0 ? 'Refresh the market catalog to try again.' : 'Add symbols to see relevant posts here.'}</AppText>{missingCount > 0 ? <Pressable onPress={() => void refetch()} accessibilityRole="button"><AppText color={Colors.accent}>Retry</AppText></Pressable> : null}</View>
      ) : (
        <>
          {missingCount > 0 ? <AppText variant="caption" color={Colors.warning} style={styles.partial}>{missingCount} saved {missingCount === 1 ? 'market is' : 'markets are'} unavailable. Showing news for the remaining symbols.</AppText> : null}
          <InstrumentNews instruments={instruments} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  webScreen: { width: '100%', maxWidth: 900, height: '100%', minHeight: 600, alignSelf: 'center' },
  webHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg },
  center: { flex: 1, padding: Spacing.xl, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  partial: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
});
