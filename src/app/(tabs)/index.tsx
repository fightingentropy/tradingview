import { Ionicons } from '@expo/vector-icons';
import { useIsRestoring } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import ReorderableList, {
  reorderItems,
  useIsActive,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { SymbolRow } from '@/components/SymbolRow';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { WatchlistMenu, type SortDir, type SortKey } from '@/components/WatchlistMenu';
import { WatchlistTabs } from '@/components/WatchlistTabs';
import { Colors, Spacing } from '@/constants/theme';
import type { Instrument, Quote } from '@/domain/types';
import { useInstrumentsByIds, useMarkets } from '@/data/useMarkets';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useWatchlists } from '@/store/watchlists';

// White TradingView glyph as a local SVG data-URI (expo-image renders SVG), so the
// header mark is the reference's bare white logo with no network dependency.
const TV_MARK =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTE1Ljg2NTQgOC4yNzg5YzAgMS4zNTQxLTEuMDk3OCAyLjQ1MTktMi40NTIgMi40NTE5LTEuMzU0IDAtMi40NTE5LTEuMDk3OC0yLjQ1MTktMi40NTIgMC0xLjM1NCAxLjA5NzgtMi40NTE4IDIuNDUyLTIuNDUxOCAxLjM1NDEgMCAyLjQ1MTkgMS4wOTc3IDIuNDUxOSAyLjQ1MTl6TTkuNzUgNkgwdjQuOTAzOGg0Ljg0NjJ2Ny4yNjkySDkuNzVabTguNTk2MiAwSDI0bC01LjEwNTggMTIuMTczaC01LjY1Mzh6Ii8+PC9zdmc+';

/**
 * Header bar matching the TradingView app: overflow menu, centered mark, add.
 */
function WatchlistHeader({ onMore, onAdd }: { onMore: () => void; onAdd: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable hitSlop={10} style={styles.headerSide} onPress={onMore} accessibilityLabel="Watchlist options">
        <Ionicons name="ellipsis-horizontal" size={22} color={Colors.text} />
      </Pressable>
      <View style={styles.headerCenter}>
        <Image source={TV_MARK} style={styles.headerLogo} contentFit="contain" />
      </View>
      <Pressable hitSlop={10} style={styles.headerSide} onPress={onAdd} accessibilityLabel="Add symbols">
        <Ionicons name="add" size={28} color={Colors.text} />
      </Pressable>
    </View>
  );
}

/**
 * Edit-mode header: Delete (left), centered list name, Done (right). The title is
 * an absolutely-centered overlay so it stays centered regardless of button widths.
 */
function EditHeader({
  name,
  count,
  onDelete,
  onDone,
}: {
  name: string;
  count: number;
  onDelete: () => void;
  onDone: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable hitSlop={10} onPress={onDelete} disabled={count === 0} style={styles.editSide}>
        <AppText style={[styles.editAction, { color: count > 0 ? Colors.down : Colors.textFaint }]}>
          {count > 0 ? `Delete (${count})` : 'Delete'}
        </AppText>
      </Pressable>
      <View pointerEvents="none" style={styles.editTitleWrap}>
        <AppText style={styles.editTitle} numberOfLines={1}>
          {name}
        </AppText>
      </View>
      <Pressable hitSlop={10} onPress={onDone} style={[styles.editSide, styles.editSideRight]}>
        <AppText style={styles.editDone}>Done</AppText>
      </Pressable>
    </View>
  );
}

/**
 * A watchlist row wired for drag-to-reorder. `useReorderableDrag` must run inside
 * a cell rendered by ReorderableList, so this lives in its own component (the
 * Markets tab reuses SymbolRow without it). The drag handle only renders in edit
 * mode (see SymbolRow), so rows don't reorder unless the user is editing.
 */
function WatchlistRow({
  instrument,
  quote,
  onPress,
  editing,
  selected,
  onToggleSelect,
}: {
  instrument: Instrument;
  quote?: Quote;
  onPress: (instrument: Instrument) => void;
  editing: boolean;
  selected: boolean;
  onToggleSelect: (instrument: Instrument) => void;
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
      editing={editing}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
}

export default function WatchlistScreen() {
  const router = useRouter();
  const lists = useWatchlists((s) => s.lists);
  const activeId = useWatchlists((s) => s.activeId);
  const reorderList = useWatchlists((s) => s.reorder);
  const createList = useWatchlists((s) => s.createList);
  const active = lists.find((l) => l.id === activeId) ?? lists[0];

  const { data, isLoading, isError, refetch, isRefetching } = useMarkets();
  // True while the persisted cache is rehydrating; queries are paused so isLoading
  // is false. Without this the empty-state branch flashes before the cache lands.
  const isRestoring = useIsRestoring();
  const instruments = useInstrumentsByIds(active?.symbolIds ?? []);
  useLivePriceFeed(instruments);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [sortKey, setSortKey] = useState<SortKey>('manual');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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
      setSortKey('manual');
    },
    [active, instruments, reorderList],
  );

  const onAdd = useCallback(() => router.push('/add-symbols'), [router]);

  const onToggleSelect = useCallback((instrument: Instrument) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(instrument.id)) next.delete(instrument.id);
      else next.add(instrument.id);
      return next;
    });
  }, []);

  const enterEdit = useCallback(() => {
    setSelected(new Set());
    setEditing(true);
    setMenuOpen(false);
  }, []);

  const exitEdit = useCallback(() => {
    setEditing(false);
    setSelected(new Set());
  }, []);

  const onDeleteSelected = useCallback(() => {
    if (!active || selected.size === 0) return;
    reorderList(
      active.id,
      active.symbolIds.filter((id) => !selected.has(id)),
    );
    setSelected(new Set());
  }, [active, selected, reorderList]);

  const onCreate = useCallback(() => {
    setMenuOpen(false);
    Alert.prompt?.('New watchlist', 'Name', (name) => {
      if (name?.trim()) createList(name.trim());
    });
  }, [createList]);

  const onNews = useCallback(() => {
    setMenuOpen(false);
    Alert.alert('News', `No recent news for “${active?.name ?? 'this list'}”.`);
  }, [active?.name]);

  const onAllWatchlists = useCallback(() => {
    setMenuOpen(false);
    router.push('/lists');
  }, [router]);

  const onSort = useCallback(
    (key: SortKey) => {
      setMenuOpen(false);
      if (!active) return;
      if (key === 'manual') {
        setSortKey('manual');
        return;
      }
      // Toggle direction when re-picking the same column; otherwise pick a sensible
      // default (A→Z for symbol, high→low for the numeric columns).
      const dir: SortDir =
        key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : key === 'symbol' ? 'asc' : 'desc';
      setSortKey(key);
      setSortDir(dir);

      const valueOf = (i: Instrument): number | string => {
        const q = data?.quotes[i.id];
        if (key === 'symbol') return i.symbol.toUpperCase();
        if (key === 'price') return q?.last ?? 0;
        return q?.change24hPct ?? 0;
      };
      const sorted = [...instruments]
        .sort((a, b) => {
          const va = valueOf(a);
          const vb = valueOf(b);
          const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
          return dir === 'asc' ? cmp : -cmp;
        })
        .map((i) => i.id);
      const shown = new Set(sorted);
      const missing = active.symbolIds.filter((id) => !shown.has(id));
      reorderList(active.id, [...sorted, ...missing]);
    },
    [active, instruments, data, sortKey, sortDir, reorderList],
  );

  const renderItem = useCallback(
    ({ item }: { item: Instrument }) => (
      <WatchlistRow
        instrument={item}
        quote={data?.quotes[item.id]}
        onPress={onPress}
        editing={editing}
        selected={selected.has(item.id)}
        onToggleSelect={onToggleSelect}
      />
    ),
    [data?.quotes, onPress, editing, selected, onToggleSelect],
  );

  const headerName = useMemo(() => active?.name ?? 'Watchlist', [active?.name]);

  return (
    <Screen>
      {editing ? (
        <EditHeader
          name={headerName}
          count={selected.size}
          onDelete={onDeleteSelected}
          onDone={exitEdit}
        />
      ) : (
        <WatchlistHeader onMore={() => setMenuOpen(true)} onAdd={onAdd} />
      )}

      {!editing ? <WatchlistTabs /> : null}

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
          renderItem={renderItem}
          onReorder={onReorder}
          dragEnabled={editing}
          shouldUpdateActiveItem
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={Colors.textMuted}
            />
          }
        />
      )}

      <WatchlistMenu
        visible={menuOpen}
        listName={headerName}
        sortKey={sortKey}
        sortDir={sortDir}
        onClose={() => setMenuOpen(false)}
        onEdit={enterEdit}
        onSort={onSort}
        onNews={onNews}
        onAllWatchlists={onAllWatchlists}
        onCreate={onCreate}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: Spacing.md,
  },
  headerSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerLogo: { width: 30, height: 30 },
  editSide: { height: 44, justifyContent: 'center', paddingHorizontal: Spacing.xs, zIndex: 1 },
  editSideRight: { marginLeft: 'auto' },
  editAction: { fontSize: 16, fontWeight: '500' },
  editDone: { fontSize: 16, fontWeight: '700', color: Colors.text },
  editTitleWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  retry: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
});
