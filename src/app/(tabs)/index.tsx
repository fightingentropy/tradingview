import { Ionicons } from '@expo/vector-icons';
import { useIsRestoring } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import ReorderableList, {
  reorderItems,
  useIsActive,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { SymbolRow, SYMBOL_ROW_HEIGHT, SYMBOL_PRICE_WIDTH, SYMBOL_CHANGE_WIDTH } from '@/components/SymbolRow';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { WatchlistMenu, type SortDir, type SortKey } from '@/components/WatchlistMenu';
import { Colors, Spacing } from '@/constants/theme';
import type { Instrument, Quote } from '@/domain/types';
import { useInstrumentsByIds, useMarkets } from '@/data/useMarkets';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { restoreRemovedSymbols, sortWatchlistView } from '@/lib/watchlistSort';
import { usePreferences } from '@/store/preferences';
import { useWatchlists } from '@/store/watchlists';

// Keep the fixed list estimate aligned with SymbolRow's compact data rows.
const ROW_HEIGHT = SYMBOL_ROW_HEIGHT;

function WatchlistHeader({ name, onLists, onMore, onAdd }: { name: string; onLists: () => void; onMore: () => void; onAdd: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onLists} style={styles.listSelector} accessibilityRole="button" accessibilityLabel={`${name}, choose watchlist`}>
        <AppText style={styles.headerTitle} numberOfLines={1}>{name}</AppText>
        <Ionicons name="chevron-down" size={17} color={Colors.textMuted} />
      </Pressable>
      <View style={styles.headerActions}>
        <Pressable style={styles.headerSide} onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add symbols">
          <Ionicons name="add" size={26} color={Colors.text} />
        </Pressable>
        <Pressable style={styles.headerSide} onPress={onMore} accessibilityRole="button" accessibilityLabel="Watchlist options">
          <Ionicons name="ellipsis-horizontal" size={23} color={Colors.text} />
        </Pressable>
      </View>
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
      columns
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

  const { data, isLoading, isError, refetch, isFetching } = useMarkets();
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
  const [removed, setRemoved] = useState<{ listId: string; name: string; previous: string[]; ids: string[] } | null>(null);
  // Quick percentage sort (persisted). Non-destructive: it reorders the *view* only,
  // leaving the saved manual order intact as 'default'.
  const watchlistSort = usePreferences((s) => s.watchlistSort);
  const setWatchlistSort = usePreferences((s) => s.setWatchlistSort);
  const effectiveSortKey = watchlistSort === 'default' ? sortKey : 'change';
  const effectiveSortDir = watchlistSort === 'default' ? sortDir : watchlistSort === 'gainers' ? 'desc' : 'asc';

  // While editing we always show the raw manual order so drag-to-reorder operates on
  // real positions rather than a sorted snapshot.
  const displayed = useMemo(() => {
    return sortWatchlistView(instruments, data?.quotes ?? {}, editing ? 'manual' : effectiveSortKey, effectiveSortDir);
  }, [instruments, editing, effectiveSortKey, effectiveSortDir, data?.quotes]);

  // Pull-to-refresh is tracked separately from react-query's background fetching so
  // the cold-launch refetch doesn't pop the RefreshControl spinner at the top —
  // which insets the list, shoving rows down and snapping them back. Only a user
  // pull shows the spinner.
  const [pulling, setPulling] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refetch();
    } finally {
      setPulling(false);
    }
  }, [refetch]);

  // Cold launch renders the persisted rows immediately but dimmed (no spinner, no
  // layout shift) until the first markets fetch since launch settles, then fades
  // them in. Flips once per launch; later 60s background refetches stay silent.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    // This one-way latch deliberately records the first completed fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!settled && !isRestoring && data && !isFetching) setSettled(true);
  }, [settled, isRestoring, data, isFetching]);
  const dimmed = !settled && instruments.length > 0;
  const dim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.timing(dim, {
      toValue: dimmed ? 0.4 : 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [dimmed, dim]);

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
      setWatchlistSort('default');
    },
    [active, instruments, reorderList, setWatchlistSort],
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
    setRemoved({ listId: active.id, name: active.name, previous: [...active.symbolIds], ids: [...selected] });
    reorderList(
      active.id,
      active.symbolIds.filter((id) => !selected.has(id)),
    );
    setSelected(new Set());
  }, [active, selected, reorderList]);

  const onUndoRemoval = useCallback(() => {
    if (!removed) return;
    const current = useWatchlists.getState().lists.find((list) => list.id === removed.listId);
    if (current) reorderList(current.id, restoreRemovedSymbols(current.symbolIds, removed.previous, removed.ids));
    setRemoved(null);
  }, [removed, reorderList]);

  const onCreate = useCallback(() => {
    setMenuOpen(false);
    Alert.prompt?.('New watchlist', 'Name', (name) => {
      if (name?.trim()) createList(name.trim());
    });
  }, [createList]);

  const onNews = useCallback(() => {
    setMenuOpen(false);
    if (active) router.push({ pathname: '/related-news', params: { watchlistId: active.id } });
  }, [active, router]);

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
        setWatchlistSort('default');
        return;
      }
      // Toggle direction when re-picking the same column; otherwise pick a sensible
      // default (A→Z for symbol, high→low for the numeric columns).
      const dir: SortDir =
        key === effectiveSortKey ? (effectiveSortDir === 'asc' ? 'desc' : 'asc') : key === 'symbol' ? 'asc' : 'desc';
      setSortKey(key);
      setSortDir(dir);
      setWatchlistSort(key === 'change' ? (dir === 'desc' ? 'gainers' : 'losers') : 'default');
    },
    [active, effectiveSortKey, effectiveSortDir, setWatchlistSort],
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

  // Rows are fixed-height, so skip per-row measurement on layout.
  const getItemLayout = useCallback(
    (_data: ArrayLike<Instrument> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
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
        <WatchlistHeader name={headerName} onLists={onAllWatchlists} onMore={() => setMenuOpen(true)} onAdd={onAdd} />
      )}

      {!editing ? (
        <View style={styles.columns}>
          {(['symbol', 'price', 'change'] as const).map((key) => (
            <Pressable
              key={key}
              onPress={() => onSort(key)}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${key === 'symbol' ? 'symbol' : key === 'price' ? 'last price' : '24 hour change'}${effectiveSortKey === key ? `, ${effectiveSortDir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
              style={[styles.column, key === 'symbol' ? styles.symbolColumn : key === 'price' ? styles.priceColumn : styles.changeColumn]}>
              <AppText style={[styles.columnLabel, effectiveSortKey === key && styles.sortedColumn]}>{key === 'symbol' ? 'Symbol' : key === 'price' ? 'Last' : '24h %'}</AppText>
              {effectiveSortKey === key ? <Ionicons name={effectiveSortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={11} color={Colors.text} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {removed ? (
        <View style={styles.undoBar}>
          <AppText variant="caption" style={styles.undoText}>{removed.ids.length} removed from {removed.name}</AppText>
          <Pressable onPress={onUndoRemoval} accessibilityRole="button" style={styles.undoAction}><AppText variant="label" color={Colors.accent}>Undo</AppText></Pressable>
          <Pressable onPress={() => setRemoved(null)} accessibilityLabel="Dismiss removal notice" style={styles.undoAction}><Ionicons name="close" size={16} color={Colors.textMuted} /></Pressable>
        </View>
      ) : null}

      {isLoading || isRestoring ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} accessibilityLabel="Loading watchlist" />
        </View>
      ) : isError && instruments.length === 0 ? (
        <View style={styles.center}>
          <AppText muted>Couldn’t load markets.</AppText>
          <Pressable onPress={() => refetch()} style={styles.retry}>
            <AppText color={Colors.accent}>Retry</AppText>
          </Pressable>
        </View>
      ) : instruments.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="add-circle-outline" size={32} color={Colors.textMuted} />
          <Pressable onPress={onAdd} style={styles.retry} accessibilityRole="button">
            <AppText color={Colors.accent}>Add symbols</AppText>
          </Pressable>
        </View>
      ) : (
        <Animated.View style={[styles.listWrap, { opacity: dim }]}>
          <ReorderableList
            data={displayed}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            onReorder={onReorder}
            dragEnabled={editing}
            shouldUpdateActiveItem
            refreshControl={
              <RefreshControl
                refreshing={pulling}
                onRefresh={onPullRefresh}
                tintColor={Colors.textMuted}
              />
            }
          />
        </Animated.View>
      )}

      <WatchlistMenu
        visible={menuOpen}
        listName={headerName}
        sortKey={effectiveSortKey}
        sortDir={effectiveSortDir}
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
    height: 60,
    paddingHorizontal: Spacing.lg,
  },
  listSelector: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 },
  headerTitle: { flexShrink: 1, fontSize: 25, lineHeight: 32, fontWeight: '600', letterSpacing: -0.6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  editSide: { height: 48, justifyContent: 'center', paddingHorizontal: Spacing.sm, zIndex: 1 },
  editSideRight: { marginLeft: 'auto' },
  editAction: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  editDone: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: Colors.text },
  editTitleWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editTitle: { fontSize: 18, lineHeight: 23, fontWeight: '700', color: Colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  listWrap: { flex: 1 },
  retry: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
  columns: { flexDirection: 'row', paddingHorizontal: Spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  column: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, minHeight: 36 },
  symbolColumn: { flex: 1, justifyContent: 'flex-start' },
  priceColumn: { width: SYMBOL_PRICE_WIDTH },
  changeColumn: { width: SYMBOL_CHANGE_WIDTH, marginLeft: 12, justifyContent: 'center' },
  columnLabel: { fontSize: 11, lineHeight: 16, color: Colors.textMuted },
  sortedColumn: { color: Colors.text },
  undoBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingLeft: Spacing.lg, paddingRight: Spacing.sm, backgroundColor: Colors.surfaceAlt },
  undoText: { flex: 1 },
  undoAction: { minHeight: 44, minWidth: 36, justifyContent: 'center', alignItems: 'center' },
});
