import { useIsRestoring } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import ReorderableList, {
  reorderItems,
  useIsActive,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { SymbolRow } from '@/components/SymbolRow';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { WatchlistTabs } from '@/components/WatchlistTabs';
import { Colors, Spacing } from '@/constants/theme';
import type { Instrument, Quote } from '@/domain/types';
import { useInstrumentsByIds, useMarkets } from '@/data/useMarkets';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useWatchlists } from '@/store/watchlists';

/**
 * A watchlist row wired for drag-to-reorder. `useReorderableDrag` must run inside
 * a cell rendered by ReorderableList, so this lives in its own component (the
 * Markets tab reuses SymbolRow without it).
 */
function WatchlistRow({
  instrument,
  quote,
  onPress,
}: {
  instrument: Instrument;
  quote?: Quote;
  onPress: (instrument: Instrument) => void;
}) {
  const drag = useReorderableDrag();
  const dragging = useIsActive();
  return (
    <SymbolRow
      instrument={instrument}
      quote={quote}
      onPress={onPress}
      onDrag={drag}
      dragging={dragging}
    />
  );
}

export default function WatchlistScreen() {
  const router = useRouter();
  const lists = useWatchlists((s) => s.lists);
  const activeId = useWatchlists((s) => s.activeId);
  const reorderList = useWatchlists((s) => s.reorder);
  const active = lists.find((l) => l.id === activeId) ?? lists[0];

  const { data, isLoading, isError, refetch, isRefetching } = useMarkets();
  // True while the persisted cache is rehydrating; queries are paused so isLoading
  // is false. Without this the empty-state branch flashes before the cache lands.
  const isRestoring = useIsRestoring();
  const instruments = useInstrumentsByIds(active?.symbolIds ?? []);
  useLivePriceFeed(instruments);

  const onPress = useCallback(
    (instrument: Instrument) => {
      router.push({ pathname: '/symbol/[id]', params: { id: instrument.id } });
    },
    [router],
  );

  const onReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      if (!active) return;
      // Reorder the visible rows, then re-attach any ids that didn't resolve to
      // an instrument so they're never dropped from the saved order.
      const reordered = reorderItems(instruments, from, to).map((i) => i.id);
      const shown = new Set(reordered);
      const missing = active.symbolIds.filter((id) => !shown.has(id));
      reorderList(active.id, [...reordered, ...missing]);
    },
    [active, instruments, reorderList],
  );

  return (
    <Screen>
      <WatchlistTabs />
      {isLoading || isRestoring ? (
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
        <ReorderableList
          data={instruments}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <WatchlistRow instrument={item} quote={data?.quotes[item.id]} onPress={onPress} />
          )}
          onReorder={onReorder}
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
