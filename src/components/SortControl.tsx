import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
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

// iOS 26 Liquid Glass when available (samples the list behind the pill); else a
// translucent fallback. Resolved once at module load, like the rest of the app.
const LIQUID_GLASS = isLiquidGlassAvailable();

/**
 * A compact glass pill that cycles a list's sort: default → % gainers → % losers.
 * The arrow direction + colour signal the active mode, and the rim picks up the
 * up/down tint while a % sort is on.
 */
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
      <AppText style={[styles.label, { color: m.color }]}>%</AppText>
    </View>
  );

  return (
    <Pressable
      onPress={() => onChange(nextSortMode(value))}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={m.a11y}>
      {LIQUID_GLASS ? (
        <GlassView style={[styles.pill, rim]} glassEffectStyle="regular" colorScheme="dark">
          {inner}
        </GlassView>
      ) : (
        <View style={[styles.pill, styles.fallback, rim]}>{inner}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: Radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    // Faint top-edge highlight reads as the lit rim of glass (matches WatchlistMenu).
    borderColor: 'rgba(255,255,255,0.14)',
  },
  // Used only when Liquid Glass isn't available — a translucent material.
  fallback: { backgroundColor: 'rgba(255,255,255,0.07)' },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  label: { fontSize: 13, fontWeight: '700' },
});
