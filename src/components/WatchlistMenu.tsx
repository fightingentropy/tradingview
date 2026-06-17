import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Colors, Spacing } from '@/constants/theme';

export type SortKey = 'manual' | 'symbol' | 'price' | 'change';
export type SortDir = 'asc' | 'desc';

// iOS 26 Liquid Glass when the OS supports it; otherwise a solid material card.
const LIQUID_GLASS = isLiquidGlassAvailable();

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
};

function MenuRow({ icon, label, onPress, accessory }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button">
      <Ionicons name={icon} size={19} color={Colors.text} style={styles.rowIcon} />
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
 * with Edit / Sort by (its own page) / News, then a "Watchlists" section.
 *
 * Rendered as an in-tree overlay (not a nested Pressable card) so the iOS 26
 * Liquid Glass material samples the watchlist content behind it for a real
 * frosted look. Falls back to a solid material card on older iOS.
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

  const content =
    page === 'main' ? (
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
    );

  const cardStyle = [styles.card, { top: insets.top + 46 }];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityLabel="Dismiss menu"
      />
      {LIQUID_GLASS ? (
        <GlassView style={cardStyle} glassEffectStyle="regular" colorScheme="dark">
          {content}
        </GlassView>
      ) : (
        <View style={[cardStyle, styles.cardSolid]}>{content}</View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  card: {
    position: 'absolute',
    left: Spacing.sm,
    width: 256,
    borderRadius: 18,
    paddingVertical: 6,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    // A faint top-edge highlight reads as the lit rim of glass.
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  // Fallback (no Liquid Glass): a near-opaque dark material.
  cardSolid: { backgroundColor: 'rgba(28,34,43,0.97)' },
  header: {
    fontSize: 13,
    color: Colors.textMuted,
    paddingHorizontal: Spacing.lg,
    paddingTop: 8,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    paddingHorizontal: Spacing.lg,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.10)' },
  rowIcon: { width: 26 },
  rowLabel: { flex: 1, fontSize: 16, color: Colors.text, marginLeft: 6, fontWeight: '500' },
  rowAccessory: { marginLeft: Spacing.sm },
  sortAccessory: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 5,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: Colors.textFaint,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg,
    paddingTop: 8,
    paddingBottom: 4,
  },
});
