import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SymbolRow } from '@/components/SymbolRow';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { AssetClass, Instrument } from '@/domain/types';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useMarkets } from '@/data/useMarkets';
import { useWatchlists } from '@/store/watchlists';

type Filter = 'all' | 'crypto' | 'stocks' | 'spot';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'stocks', label: 'Stocks' },
  { key: 'spot', label: 'Spot' },
];

const STOCK_CLASSES = new Set<AssetClass>(['equity-perp', 'equity', 'commodity', 'index', 'fx']);

function matchesFilter(i: Instrument, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'crypto') return i.assetClass === 'crypto-perp';
  if (f === 'spot') return i.assetClass === 'crypto-spot';
  return STOCK_CLASSES.has(i.assetClass) || i.source === 'stocks';
}

export default function MarketsScreen() {
  const router = useRouter();
  const { data, isLoading } = useMarkets();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const activeId = useWatchlists((s) => s.activeId);
  const activeList = useWatchlists((s) => s.lists.find((l) => l.id === s.activeId));
  const toggle = useWatchlists((s) => s.toggle);
  const watchedSet = useMemo(() => new Set(activeList?.symbolIds ?? []), [activeList?.symbolIds]);

  const results = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const filtered = data.instruments.filter((i) => {
      if (!matchesFilter(i, filter)) return false;
      if (!q) return true;
      return i.symbol.toLowerCase().includes(q) || i.name.toLowerCase().includes(q);
    });
    filtered.sort((a, b) => (data.quotes[b.id]?.dayVolume ?? 0) - (data.quotes[a.id]?.dayVolume ?? 0));
    return filtered.slice(0, 300);
  }, [data, search, filter]);

  useLivePriceFeed(results);

  const onPress = useCallback(
    (i: Instrument) => router.push({ pathname: '/symbol/[id]', params: { id: i.id } }),
    [router],
  );
  const onToggleWatch = useCallback((i: Instrument) => toggle(activeId, i.id), [toggle, activeId]);

  return (
    <Screen>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={Colors.textMuted} />
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
          <Pressable hitSlop={8} onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, active && styles.chipActive]}>
              <AppText variant="caption" color={active ? Colors.text : Colors.textMuted}>
                {f.label}
              </AppText>
            </Pressable>
          );
        })}
        {activeList ? (
          <View style={styles.addingTo}>
            <AppText variant="caption" muted>
              Adding to {activeList.name}
            </AppText>
          </View>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlashList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <SymbolRow
              instrument={item}
              quote={data?.quotes[item.id]}
              onPress={onPress}
              watched={watchedSet.has(item.id)}
              onToggleWatch={onToggleWatch}
            />
          )}
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
    margin: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  input: { flex: 1, color: Colors.text, fontSize: 15 },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border },
  addingTo: { marginLeft: 'auto' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
