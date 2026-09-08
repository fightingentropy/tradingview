import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Spacing } from '@/constants/theme';
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
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.pill, active && styles.pillActive]}>
            <AppText
              color={active ? Colors.accent : Colors.textMuted}
              style={styles.tabText}
              numberOfLines={1}>
              {l.name}
            </AppText>
          </Pressable>
        );
      })}
      <Pressable onPress={onAdd} accessibilityLabel="Create watchlist" style={[styles.pill, styles.addPill]}>
        <Ionicons name="add" size={16} color={Colors.textMuted} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  container: {
    gap: 18,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  pill: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
  },
  pillActive: {
    borderBottomColor: Colors.accent,
  },
  tabText: { fontSize: 14, lineHeight: 19, fontWeight: '500' },
  addPill: { paddingHorizontal: 10 },
});
