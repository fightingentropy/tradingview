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
            style={[styles.pill, active && styles.pillActive]}>
            <AppText
              color={active ? Colors.text : Colors.textMuted}
              style={styles.tabText}
              numberOfLines={1}>
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
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  pill: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'transparent',
  },
  pillActive: {
    backgroundColor: Colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(120,144,255,0.26)',
  },
  tabText: { fontSize: 15, lineHeight: 19, fontWeight: '600' },
  addPill: { paddingHorizontal: 10 },
});
