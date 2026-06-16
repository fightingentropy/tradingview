import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { SymbolRow } from '@/components/SymbolRow';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { WatchlistTabs } from '@/components/WatchlistTabs';
import { Colors, Spacing } from '@/constants/theme';
import type { Instrument } from '@/domain/types';
import { useInstrumentsByIds, useMarkets } from '@/data/useMarkets';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useWatchlists } from '@/store/watchlists';

export default function WatchlistScreen() {
  const router = useRouter();
  const lists = useWatchlists((s) => s.lists);
  const activeId = useWatchlists((s) => s.activeId);
  const active = lists.find((l) => l.id === activeId) ?? lists[0];

  const { data, isLoading, isError, refetch, isRefetching } = useMarkets();
  const instruments = useInstrumentsByIds(active?.symbolIds ?? []);
  useLivePriceFeed(instruments);

  const onPress = useCallback(
    (instrument: Instrument) => {
      router.push({ pathname: '/symbol/[id]', params: { id: instrument.id } });
    },
    [router],
  );

  return (
    <Screen>
      <WatchlistTabs />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <AppText muted>Couldn’t load markets.</AppText>
          <Pressable onPress={() => refetch()} style={styles.retry}>
            <AppText color={Colors.accent}>Retry</AppText>
          </Pressable>
        </View>
      ) : instruments.length === 0 ? (
        <View style={styles.center}>
          <AppText variant="label">“{active?.name}” is empty</AppText>
          <AppText muted>Add symbols from the Markets tab.</AppText>
        </View>
      ) : (
        <FlashList
          data={instruments}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SymbolRow instrument={item} quote={data?.quotes[item.id]} onPress={onPress} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={Colors.textMuted}
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  retry: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
});
