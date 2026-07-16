import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { LinearTransition } from 'react-native-reanimated';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Spacing } from '@/constants/theme';
import type { Instrument } from '@/domain/types';
import { useMarkets } from '@/data/useMarkets';
import { useWatchlists } from '@/store/watchlists';

/** Comma-free ticker preview for a list; resolves real symbols when markets are
 *  loaded, otherwise derives a clean ticker from the id tail (`hl:xyz:SP500` → SP500). */
function previewFor(
  symbolIds: string[],
  byId?: Record<string, Instrument>,
): string {
  return symbolIds
    .filter((id) => !id.startsWith('hl:outcome:'))
    .map((id) => byId?.[id]?.symbol ?? id.split(':').pop()?.toUpperCase() ?? id)
    .join('   ');
}

export default function ListsScreen() {
  const router = useRouter();
  const lists = useWatchlists((s) => s.lists);
  const activeId = useWatchlists((s) => s.activeId);
  const setActive = useWatchlists((s) => s.setActive);
  const createList = useWatchlists((s) => s.createList);
  const deleteList = useWatchlists((s) => s.deleteList);
  const active = lists.find((l) => l.id === activeId);
  const { data } = useMarkets();

  // The app always needs at least one list, so the final one isn't swipe-deletable.
  const canDelete = lists.length > 1;

  const onSelect = (id: string) => {
    setActive(id);
    router.back();
  };

  const onCreate = () => {
    Alert.prompt?.('New list', 'Name', (name) => {
      if (name?.trim()) createList(name.trim());
    });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={Colors.text} />
          <AppText style={styles.backLabel} numberOfLines={1}>
            {active?.name ?? 'Back'}
          </AppText>
        </Pressable>
        <View pointerEvents="none" style={styles.titleWrap}>
          <AppText style={styles.title}>List</AppText>
        </View>
        <Pressable
          hitSlop={10}
          onPress={onCreate}
          style={styles.add}
          accessibilityRole="button"
          accessibilityLabel="New list">
          <Ionicons name="add" size={28} color={Colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {lists.map((l) => {
          const isActive = l.id === activeId;
          const row = (
            <Pressable
              onPress={() => onSelect(l.id)}
              style={({ pressed }) => [
                styles.row,
                isActive && styles.rowActive,
                pressed && !isActive && styles.rowPressed,
              ]}>
              <AppText style={[styles.name, isActive && styles.nameActive]} numberOfLines={1}>
                {l.name}
              </AppText>
              <AppText style={[styles.preview, isActive && styles.previewActive]} numberOfLines={1}>
                {previewFor(l.symbolIds, data?.byId) || 'Empty list'}
              </AppText>
            </Pressable>
          );
          return (
            <Reanimated.View key={l.id} layout={LinearTransition.duration(220)}>
              {canDelete ? (
                <ReanimatedSwipeable
                  friction={2}
                  rightThreshold={40}
                  overshootRight={false}
                  renderRightActions={() => (
                    <Pressable
                      style={styles.deleteAction}
                      onPress={() => deleteList(l.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${l.name} list`}>
                      <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
                      <AppText style={styles.deleteLabel}>Delete</AppText>
                    </Pressable>
                  )}>
                  {row}
                </ReanimatedSwipeable>
              ) : (
                row
              )}
            </Reanimated.View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    paddingHorizontal: Spacing.md,
  },
  back: { flexDirection: 'row', alignItems: 'center', maxWidth: 160, zIndex: 1 },
  backLabel: { fontSize: 17, color: Colors.text, marginLeft: 2 },
  titleWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '700', color: Colors.text },
  add: { marginLeft: 'auto', width: 36, alignItems: 'flex-end', zIndex: 1 },
  listContent: { paddingTop: Spacing.sm },
  row: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    // Opaque so the row slides cleanly over the red Delete action when swiped.
    backgroundColor: Colors.background,
  },
  rowActive: { backgroundColor: '#E8EAED' },
  deleteAction: {
    width: 88,
    backgroundColor: Colors.down,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  deleteLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  rowPressed: { backgroundColor: Colors.surface },
  name: { fontSize: 20, fontWeight: '700', color: Colors.text },
  nameActive: { color: '#0B0E11' },
  preview: { fontSize: 15, color: Colors.textMuted, marginTop: 4 },
  previewActive: { color: '#4A515C' },
});
