import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';

export type SortKey = 'manual' | 'symbol' | 'price' | 'change';
export type SortDir = 'asc' | 'desc';

interface Props {
  visible: boolean;
  listName: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onClose: () => void;
  onEdit: () => void;
  onSort: (key: SortKey) => void;
  onNews: () => void;
  onAllWatchlists: () => void;
  onCreate: () => void;
}

type RowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  accessory?: React.ReactNode;
  danger?: boolean;
};

function MenuRow({ icon, label, onPress, accessory }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button">
      <Ionicons name={icon} size={20} color={Colors.text} style={styles.rowIcon} />
      <AppText style={styles.rowLabel} numberOfLines={1}>
        {label}
      </AppText>
      <View style={styles.rowAccessory}>{accessory}</View>
    </Pressable>
  );
}

const SORT_OPTIONS: { key: SortKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'manual', label: 'Manual', icon: 'reorder-three-outline' },
  { key: 'symbol', label: 'Symbol', icon: 'text-outline' },
  { key: 'price', label: 'Last price', icon: 'pricetag-outline' },
  { key: 'change', label: 'Change %', icon: 'trending-up-outline' },
];

/**
 * The `•••` overflow menu from the TradingView watchlist: a top-left dropdown
 * with Edit / Sort by (its own page) / News, then a "Watchlists" section. Built
 * as a fade Modal anchored under the header so it reads as a popover.
 */
export function WatchlistMenu({
  visible,
  listName,
  sortKey,
  sortDir,
  onClose,
  onEdit,
  onSort,
  onNews,
  onAllWatchlists,
  onCreate,
}: Props) {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<'main' | 'sort'>('main');

  // Always reopen on the main page.
  useEffect(() => {
    if (visible) setPage('main');
  }, [visible]);

  const dirIcon = sortDir === 'asc' ? 'arrow-up' : 'arrow-down';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop propagation so taps inside the card don't dismiss it. */}
        <Pressable
          style={[styles.card, { top: insets.top + 46 }]}
          onPress={(e) => e.stopPropagation()}>
          {page === 'main' ? (
            <>
              <AppText style={styles.header} numberOfLines={1}>
                {listName}
              </AppText>
              <MenuRow icon="create-outline" label="Edit" onPress={onEdit} />
              <MenuRow
                icon="swap-vertical-outline"
                label="Sort by"
                onPress={() => setPage('sort')}
                accessory={
                  <View style={styles.sortAccessory}>
                    {sortKey !== 'manual' ? (
                      <Ionicons name={dirIcon} size={15} color={Colors.textMuted} />
                    ) : null}
                    <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                  </View>
                }
              />
              <MenuRow icon="newspaper-outline" label="News by watchlist" onPress={onNews} />

              <View style={styles.divider} />
              <AppText style={styles.sectionLabel}>Watchlists</AppText>
              <MenuRow icon="list-outline" label="All watchlists" onPress={onAllWatchlists} />
              <MenuRow icon="add" label="Create new list" onPress={onCreate} />
            </>
          ) : (
            <>
              <Pressable
                onPress={() => setPage('main')}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                <Ionicons name="chevron-back" size={18} color={Colors.text} style={styles.rowIcon} />
                <AppText style={styles.rowLabel}>Sort by</AppText>
              </Pressable>
              <View style={styles.divider} />
              {SORT_OPTIONS.map((opt) => {
                const active = sortKey === opt.key;
                return (
                  <MenuRow
                    key={opt.key}
                    icon={opt.icon}
                    label={opt.label}
                    onPress={() => onSort(opt.key)}
                    accessory={
                      active && opt.key !== 'manual' ? (
                        <Ionicons name={dirIcon} size={16} color={Colors.accent} />
                      ) : active ? (
                        <Ionicons name="checkmark" size={16} color={Colors.accent} />
                      ) : null
                    }
                  />
                );
              })}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  card: {
    position: 'absolute',
    left: Spacing.sm,
    width: 256,
    backgroundColor: '#262A33',
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  header: {
    fontSize: 13,
    color: Colors.textMuted,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    paddingHorizontal: Spacing.lg,
  },
  rowPressed: { backgroundColor: Colors.surfacePress },
  rowIcon: { width: 24 },
  rowLabel: { flex: 1, fontSize: 16, color: Colors.text, marginLeft: Spacing.sm },
  rowAccessory: { marginLeft: Spacing.sm },
  sortAccessory: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xs,
  },
  sectionLabel: {
    fontSize: 12,
    color: Colors.textFaint,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: 2,
  },
});
