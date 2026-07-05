import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useIsRestoring } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SymbolLogo } from '@/components/SymbolLogo';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { AssetClass, Instrument } from '@/domain/types';
import { useMarkets } from '@/data/useMarkets';
import { useWatchlists } from '@/store/watchlists';

type Filter = 'all' | 'stocks' | 'crypto' | 'forex' | 'index';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'stocks', label: 'Stocks' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'forex', label: 'Forex' },
  { key: 'index', label: 'Index' },
];

const STOCK_CLASSES = new Set<AssetClass>(['equity-perp', 'commodity']);

function matchesFilter(i: Instrument, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'stocks') return STOCK_CLASSES.has(i.assetClass);
  if (f === 'crypto') return i.assetClass === 'crypto-perp' || i.assetClass === 'crypto-spot';
  if (f === 'forex') return i.assetClass === 'fx';
  if (f === 'index') return i.assetClass === 'index';
  return true;
}

const TYPE_LABEL: Record<AssetClass, string> = {
  'crypto-perp': 'perpetual',
  'crypto-spot': 'spot',
  'equity-perp': 'equity perp',
  fx: 'forex',
  commodity: 'commodity',
  index: 'index',
};

// Instrument + precomputed lowercased searchable text, so typing doesn't lowercase
// the whole catalog on every keystroke (the field is memoized once per snapshot).
interface Searchable {
  instrument: Instrument;
  haystack: string;
}

function AddRowImpl({
  instrument,
  added,
  onToggle,
}: {
  instrument: Instrument;
  added: boolean;
  onToggle: (i: Instrument) => void;
}) {
  return (
    <View style={styles.row}>
      <SymbolLogo instrument={instrument} size={36} />
      <View style={styles.mid}>
        <AppText style={styles.symbol} numberOfLines={1}>
          {instrument.symbol}
        </AppText>
        <AppText style={styles.name} numberOfLines={1}>
          {instrument.name}
        </AppText>
      </View>
      <View style={styles.meta}>
        <AppText style={styles.venue} numberOfLines={1}>
          {instrument.venue}
        </AppText>
        <AppText style={styles.type} numberOfLines={1}>
          {TYPE_LABEL[instrument.assetClass]}
        </AppText>
      </View>
      <Pressable
        hitSlop={12}
        onPress={() => onToggle(instrument)}
        style={styles.addBtn}
        accessibilityLabel={`${added ? 'Remove' : 'Add'} ${instrument.symbol}`}>
        <Ionicons
          name={added ? 'checkmark-circle' : 'add'}
          size={added ? 24 : 28}
          color={added ? Colors.up : Colors.textMuted}
        />
      </Pressable>
    </View>
  );
}

// Stable props (instrument from the catalog, `added` bool, memoized `onToggle`), so the
// default shallow compare bails for every row untouched by a keystroke or a watch toggle.
const AddRow = memo(AddRowImpl);

export default function AddSymbolsScreen() {
  const router = useRouter();
  const { data, isLoading } = useMarkets();
  const isRestoring = useIsRestoring();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Debounce the raw input so a 300-item filter+sort runs once typing settles,
  // not on every keystroke. The TextInput stays driven by `search` for instant echo.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(id);
  }, [search]);

  const activeId = useWatchlists((s) => s.activeId);
  const activeList = useWatchlists((s) => s.lists.find((l) => l.id === s.activeId));
  const toggle = useWatchlists((s) => s.toggle);
  const watched = useMemo(() => new Set(activeList?.symbolIds ?? []), [activeList?.symbolIds]);

  // Lowercase symbol+name once per snapshot, not per keystroke.
  const searchable = useMemo<Searchable[]>(
    () =>
      data?.instruments.map((instrument) => ({
        instrument,
        haystack: `${instrument.symbol} ${instrument.name}`.toLowerCase(),
      })) ?? [],
    [data],
  );

  const results = useMemo(() => {
    if (!data) return [];
    const q = debouncedSearch.trim().toLowerCase();
    const out = searchable
      .filter(({ instrument, haystack }) => {
        if (!matchesFilter(instrument, filter)) return false;
        if (!q) return true;
        return haystack.includes(q);
      })
      .map(({ instrument }) => instrument);
    out.sort((a, b) => (data.quotes[b.id]?.dayVolume ?? 0) - (data.quotes[a.id]?.dayVolume ?? 0));
    return out.slice(0, 300);
  }, [data, searchable, debouncedSearch, filter]);

  const onToggle = useCallback((i: Instrument) => toggle(activeId, i.id), [toggle, activeId]);

  const renderItem = useCallback(
    ({ item }: { item: Instrument }) => (
      <AddRow instrument={item} added={watched.has(item.id)} onToggle={onToggle} />
    ),
    [watched, onToggle],
  );

  return (
    <Screen>
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor={Colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            style={styles.input}
          />
          {search ? (
            <Pressable hitSlop={8} onPress={() => setSearch('')} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable hitSlop={10} onPress={() => router.back()}>
          <AppText style={styles.close}>Close</AppText>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.tab, active && styles.tabActive]}>
              <AppText style={[styles.tabLabel, active && styles.tabLabelActive]}>{f.label}</AppText>
            </Pressable>
          );
        })}
      </View>

      {activeList ? (
        <AppText style={styles.addingTo} numberOfLines={1}>
          Adding to {activeList.name}
        </AppText>
      ) : null}

      {isLoading || isRestoring ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlashList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={renderItem}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  input: { flex: 1, color: Colors.text, fontSize: 16 },
  close: { fontSize: 16, color: Colors.text, fontWeight: '500' },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  tab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  tabActive: { backgroundColor: Colors.surfaceAlt },
  tabLabel: { fontSize: 14, color: Colors.textMuted, fontWeight: '600' },
  tabLabelActive: { color: Colors.text },
  addingTo: {
    fontSize: 12,
    color: Colors.textFaint,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  mid: { flex: 1, marginLeft: Spacing.md, paddingRight: Spacing.sm },
  symbol: { fontSize: 16, fontWeight: '700', color: Colors.text },
  name: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  meta: { alignItems: 'flex-end', marginRight: Spacing.lg, maxWidth: 130 },
  venue: { fontSize: 14, fontWeight: '600', color: Colors.text },
  type: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  addBtn: { width: 30, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
