import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useIsRestoring } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { SortControl } from '@/components/SortControl';
import { SymbolRow } from '@/components/SymbolRow';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { instrumentDisplayName } from '@/domain/instrumentDisplay';
import type { AssetClass, Instrument } from '@/domain/types';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useMarkets } from '@/data/useMarkets';
import { usePreferences } from '@/store/preferences';
import { useWatchlists } from '@/store/watchlists';

type Filter = 'all' | 'crypto' | 'stocks' | 'spot';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'stocks', label: 'Stocks' },
  { key: 'spot', label: 'Spot' },
];
const STOCK_CLASSES = new Set<AssetClass>(['equity-perp', 'commodity', 'index', 'fx']);

function matchesFilter(i: Instrument, f: Filter): boolean {
  if (i.assetClass === 'outcome') return false;
  if (f === 'all') return true;
  if (f === 'crypto') return i.assetClass === 'crypto-perp';
  if (f === 'spot') return i.assetClass === 'crypto-spot';
  return STOCK_CLASSES.has(i.assetClass);
}

// Instrument + precomputed lowercased searchable text, so typing doesn't lowercase
// the whole catalog on every keystroke (the field is memoized once per snapshot).
interface Searchable {
  instrument: Instrument;
  haystack: string;
}

export default function MarketsScreen() {
  const router = useRouter();
  const listRef = useRef<FlashListRef<Instrument>>(null);
  const { data, isLoading } = useMarkets();
  const isRestoring = useIsRestoring();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Persisted so the chosen order survives app restarts.
  const sort = usePreferences((s) => s.marketsSort);
  const setSort = usePreferences((s) => s.setMarketsSort);

  // Debounce the raw input so a 300-item filter+sort runs once typing settles,
  // not on every keystroke. The TextInput stays driven by `search` for instant echo.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(id);
  }, [search]);

  // A category/search/sort change is a new result set, not an insertion into the
  // old list. Start at its first result instead of anchoring a recycled old row.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [filter, debouncedSearch, sort]);

  const activeId = useWatchlists((s) => s.activeId);
  const activeList = useWatchlists((s) => s.lists.find((l) => l.id === s.activeId));
  const toggle = useWatchlists((s) => s.toggle);
  const watchedSet = useMemo(() => new Set(activeList?.symbolIds ?? []), [activeList?.symbolIds]);

  // Lowercase symbol+name once per snapshot, not per keystroke.
  const searchable = useMemo<Searchable[]>(
    () =>
      data?.instruments.map((instrument) => ({
        instrument,
        haystack: `${instrument.symbol} ${instrument.name} ${instrumentDisplayName(instrument)}`.toLowerCase(),
      })) ?? [],
    [data],
  );

  const results = useMemo(() => {
    if (!data) return [];
    const q = debouncedSearch.trim().toLowerCase();
    const filtered = searchable
      .filter(({ instrument, haystack }) => {
        if (!matchesFilter(instrument, filter)) return false;
        if (!q) return true;
        return haystack.includes(q);
      })
      .map(({ instrument }) => instrument);
    if (sort === 'default') {
      filtered.sort((a, b) => (data.quotes[b.id]?.dayVolume ?? 0) - (data.quotes[a.id]?.dayVolume ?? 0));
    } else {
      // Gainers: highest 24h % first; losers: lowest first. Instruments without a
      // 24h change (e.g. a stock while its market is closed) sink to the bottom
      // either way, so they never crowd out the actual movers.
      filtered.sort((a, b) => {
        const ca = data.quotes[a.id]?.change24hPct;
        const cb = data.quotes[b.id]?.change24hPct;
        if (ca == null && cb == null) return 0;
        if (ca == null) return 1;
        if (cb == null) return -1;
        return sort === 'gainers' ? cb - ca : ca - cb;
      });
    }
    return filtered.slice(0, 300);
  }, [data, searchable, debouncedSearch, filter, sort]);

  // Subscribe live prices to the full catalog (a stable set) rather than the
  // filtered results, so typing doesn't tear down and re-open the websocket
  // subscription on each keystroke. useLivePriceFeed keys off a sorted
  // source:coinKey signature, so the stable input means no resubscribe.
  useLivePriceFeed(data?.instruments ?? []);

  const onPress = useCallback(
    (i: Instrument) => router.push({ pathname: '/symbol/[id]', params: { id: i.id } }),
    [router],
  );
  const onToggleWatch = useCallback((i: Instrument) => toggle(activeId, i.id), [toggle, activeId]);

  const renderItem = useCallback(
    ({ item }: { item: Instrument }) => (
      <SymbolRow
        instrument={item}
        quote={data?.quotes[item.id]}
        onPress={onPress}
        watched={watchedSet.has(item.id)}
        onToggleWatch={onToggleWatch}
      />
    ),
    [data?.quotes, onPress, watchedSet, onToggleWatch],
  );

  return (
    // No top inset: the Tabs navigator already renders a "Markets" header that
    // consumes the safe area — a second inset here is what left the big gap.
    <Screen edges={[]}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={20} color={Colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search markets"
          placeholderTextColor={Colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
        />
        {search ? (
          <Pressable hitSlop={8} onPress={() => setSearch('')} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.chips}>
        <ScrollView
          horizontal
          style={styles.chipScroller}
          contentContainerStyle={styles.chipGroup}
          showsHorizontalScrollIndicator={false}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}>
                <AppText style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {f.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Cycle row order: default (by volume) → % gainers → % losers. */}
        <SortControl value={sort} onChange={setSort} />
      </View>

      <View style={styles.tableHeader}>
        <AppText style={styles.columnLabel}>
          {debouncedSearch.trim() ? `${results.length} matches` : 'Symbol'}
        </AppText>
        <AppText style={[styles.columnLabel, styles.priceColumn]}>Last / 24h</AppText>
      </View>

      {isLoading || isRestoring ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={results}
          maintainVisibleContentPosition={{ disabled: true }}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <AppText style={styles.emptyTitle}>No matching markets</AppText>
              <AppText variant="caption" muted>Try another symbol or category.</AppText>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: 42,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  input: { flex: 1, color: Colors.text, fontSize: 15, lineHeight: 20, fontWeight: '400' },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  chipScroller: { flex: 1 },
  chipGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingRight: Spacing.sm },
  chip: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    backgroundColor: Colors.background,
  },
  chipActive: {
    backgroundColor: Colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  chipLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: Colors.textMuted },
  chipLabelActive: { color: Colors.accent },
  tableHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  columnLabel: { fontSize: 11, lineHeight: 16, color: Colors.textMuted },
  priceColumn: { marginRight: 32 },
  empty: { padding: Spacing.xxl, gap: Spacing.sm },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
