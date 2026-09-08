import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { LinearTransition } from 'react-native-reanimated';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
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
            Back
          </AppText>
        </Pressable>
        <View pointerEvents="none" style={styles.titleWrap}>
          <AppText style={styles.title}>Watchlists</AppText>
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
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              style={({ pressed }) => [
                styles.row,
                isActive && styles.rowActive,
                pressed && !isActive && styles.rowPressed,
              ]}>
              <View style={styles.nameRow}>
                <AppText style={[styles.name, isActive && styles.nameActive]} numberOfLines={1}>{l.name}</AppText>
                <AppText style={styles.count}>{l.symbolIds.filter((id) => !id.startsWith('hl:outcome:')).length}</AppText>
                {isActive ? <Ionicons name="checkmark" size={17} color={Colors.accent} /> : null}
              </View>
              <AppText style={[styles.preview, isActive && styles.previewActive]} numberOfLines={1}>
                {previewFor(l.symbolIds, data?.byId) || 'Empty list'}
              </AppText>
            </Pressable>
          );
          return (
            <Reanimated.View
              key={l.id}
              layout={LinearTransition.duration(220)}
              style={styles.rowShell}>
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
    height: 56,
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
  title: { fontSize: 20, lineHeight: 25, fontWeight: '700', color: Colors.text },
  add: { marginLeft: 'auto', width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt, zIndex: 1 },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: 0,
  },
  rowShell: {
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  row: {
    minHeight: 70,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    // Opaque so the row slides cleanly over the red Delete action when swiped.
    backgroundColor: Colors.background,
  },
  rowActive: { backgroundColor: Colors.surfaceAlt },
  deleteAction: {
    width: 88,
    backgroundColor: Colors.down,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  deleteLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  rowPressed: { backgroundColor: Colors.surface },
  name: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '700', color: Colors.text },
  nameActive: { color: Colors.accent },
  preview: { fontSize: 12, lineHeight: 18, color: Colors.textMuted, marginTop: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  count: { fontSize: 12, color: Colors.textFaint, fontVariant: ['tabular-nums'] },
  previewActive: { color: Colors.textMuted },
});
