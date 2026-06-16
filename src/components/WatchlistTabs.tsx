import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useWatchlists } from '@/store/watchlists';

export function WatchlistTabs() {
  const lists = useWatchlists((s) => s.lists);
  const activeId = useWatchlists((s) => s.activeId);
  const setActive = useWatchlists((s) => s.setActive);
  const createList = useWatchlists((s) => s.createList);

  const onAdd = () => {
    Alert.prompt?.('New watchlist', 'Name', (name) => {
      if (name?.trim()) createList(name.trim());
    });
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.container}>
      {lists.map((l) => {
        const active = l.id === activeId;
        return (
          <Pressable
            key={l.id}
            onPress={() => setActive(l.id)}
            style={[styles.pill, active && styles.pillActive]}>
            <AppText variant="label" color={active ? Colors.text : Colors.textMuted}>
              {l.name}
            </AppText>
          </Pressable>
        );
      })}
      <Pressable onPress={onAdd} style={[styles.pill, styles.addPill]}>
        <Ionicons name="add" size={16} color={Colors.textMuted} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  container: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
  },
  pillActive: { backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border },
  addPill: { paddingHorizontal: Spacing.sm },
});
