import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Colors, Indicators, Radius, Spacing } from '@/constants/theme';
import { SMA_OPTIONS, useChartSettings } from '@/store/chartSettings';

interface MenuItem {
  key: string;
  label: string;
  dot: string;
  active: boolean;
  onToggle: () => void;
}

/**
 * Single "studies" dropdown that gathers every chart indicator (SMA 20/50/200,
 * Volume, RSI) behind one toolbar button, so the chart toolbar stays tidy
 * instead of scattering a chip per study.
 */
export function IndicatorMenu() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const smaPeriods = useChartSettings((s) => s.smaPeriods);
  const volume = useChartSettings((s) => s.volume);
  const rsi = useChartSettings((s) => s.rsi);
  const rsiPeriod = useChartSettings((s) => s.rsiPeriod);
  const toggleSma = useChartSettings((s) => s.toggleSma);
  const toggleVolume = useChartSettings((s) => s.toggleVolume);
  const toggleRsi = useChartSettings((s) => s.toggleRsi);

  const items: MenuItem[] = [
    ...SMA_OPTIONS.map((p) => ({
      key: `sma-${p}`,
      label: `SMA ${p}`,
      dot: Indicators.sma[p] ?? Colors.textMuted,
      active: smaPeriods.includes(p),
      onToggle: () => toggleSma(p),
    })),
    { key: 'vol', label: 'Volume', dot: Colors.textMuted, active: volume, onToggle: toggleVolume },
    { key: 'rsi', label: `RSI ${rsiPeriod}`, dot: Indicators.rsi, active: rsi, onToggle: toggleRsi },
  ];

  const activeCount = items.filter((i) => i.active).length;

  return (
    <>
      <Pressable
        style={styles.trigger}
        hitSlop={6}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Indicators">
        <Ionicons name="layers-outline" size={18} color={Colors.textMuted} />
        {activeCount > 0 ? (
          <View style={styles.badge}>
            <AppText variant="caption" color="#04121A" style={styles.badgeText}>
              {activeCount}
            </AppText>
          </View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.card, { bottom: insets.bottom + 56 }]}>
          <AppText variant="caption" muted style={styles.cardLabel}>
            INDICATORS
          </AppText>
          {items.map((item) => (
            <Pressable
              key={item.key}
              style={styles.row}
              onPress={item.onToggle}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.active }}>
              <View style={[styles.dot, { backgroundColor: item.active ? item.dot : Colors.textFaint }]} />
              <AppText
                variant="body"
                color={item.active ? Colors.text : Colors.textMuted}
                style={styles.rowLabel}>
                {item.label}
              </AppText>
              {item.active ? (
                <Ionicons name="checkmark" size={18} color={Colors.accent} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 3,
    right: 1,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700', lineHeight: 14 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  card: {
    position: 'absolute',
    left: Spacing.sm,
    minWidth: 184,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingVertical: Spacing.xs,
    // Float above the chart toolbar like a popover.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  cardLabel: {
    letterSpacing: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    paddingBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { flex: 1 },
});
