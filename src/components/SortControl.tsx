import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius } from '@/constants/theme';

/**
 * Row order for a markets / watchlist list. `default` keeps each screen's natural
 * order (Markets: by 24h volume; a watchlist: its manual / saved order); the other
 * two sort by the 24h % move.
 */
export type SortMode = 'default' | 'gainers' | 'losers';

/** Tap-through order for {@link SortControl}. */
export const nextSortMode = (s: SortMode): SortMode =>
  s === 'default' ? 'gainers' : s === 'gainers' ? 'losers' : 'default';

const META: Record<
  SortMode,
  { icon: 'swap-vertical' | 'arrow-up' | 'arrow-down'; color: string; a11y: string }
> = {
  default: { icon: 'swap-vertical', color: Colors.textMuted, a11y: 'Sort by 24h percent change' },
  gainers: { icon: 'arrow-up', color: Colors.up, a11y: 'Sorted by top gainers — tap to change' },
  losers: { icon: 'arrow-down', color: Colors.down, a11y: 'Sorted by top losers — tap to change' },
};

/** Compact control that cycles manual, gainers and losers without changing saved order. */
export function SortControl({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (next: SortMode) => void;
}) {
  const m = META[value];
  const active = value !== 'default';
  const rim = active ? { borderColor: m.color + '66' } : null;

  const inner = (
    <View style={styles.inner}>
      <Ionicons name={m.icon} size={14} color={m.color} />
      <AppText style={[styles.label, { color: m.color }]}>24h %</AppText>
    </View>
  );

  return (
    <Pressable
      onPress={() => onChange(nextSortMode(value))}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={m.a11y}>
      <View style={[styles.pill, rim]}>{inner}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: Radius.sm,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  label: { fontSize: 11, fontWeight: '500' },
});
