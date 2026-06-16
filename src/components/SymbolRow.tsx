import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useSymbolMenu } from '@/components/SymbolMenu';
import { AppText } from '@/components/ui/AppText';
import { VenueBadge } from '@/components/VenueBadge';
import { Colors, Spacing } from '@/constants/theme';
import type { Instrument, Quote } from '@/domain/types';
import { useContextMenuTrigger } from '@/hooks/useContextMenuTrigger';
import { formatPercent, formatPrice, priceDecimalsFor } from '@/lib/format';
import { useLivePrice } from '@/store/livePrices';

interface Props {
  instrument: Instrument;
  quote?: Quote;
  onPress: (instrument: Instrument) => void;
  /** When provided, renders a watch toggle star on the right. */
  watched?: boolean;
  onToggleWatch?: (instrument: Instrument) => void;
  /** When provided, renders a drag handle; long-pressing it starts a reorder. */
  onDrag?: () => void;
  /** Highlights the row while it is the one being dragged. */
  dragging?: boolean;
}

function SymbolRowImpl({
  instrument,
  quote,
  onPress,
  watched,
  onToggleWatch,
  onDrag,
  dragging,
}: Props) {
  const { open } = useSymbolMenu();
  const onOpenMenu = useCallback(() => open(instrument), [open, instrument]);
  const menuTrigger = useContextMenuTrigger(onOpenMenu);

  const live = useLivePrice(instrument.coinKey);
  const last = live ?? quote?.last ?? null;
  const prev = quote?.prevClose ?? null;
  const changePct =
    last !== null && prev !== null && prev !== 0
      ? ((last - prev) / prev) * 100
      : (quote?.change24hPct ?? null);

  const up = (changePct ?? 0) >= 0;
  const changeColor = changePct === null ? Colors.textMuted : up ? Colors.up : Colors.down;

  return (
    <Pressable
      onPress={() => onPress(instrument)}
      {...menuTrigger}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, dragging && styles.dragging]}>
      <View style={styles.left}>
        <AppText variant="label" style={styles.symbol}>
          {instrument.symbol}
        </AppText>
        <View style={styles.metaRow}>
          <VenueBadge venue={instrument.venue} />
          <AppText variant="caption" numberOfLines={1} style={styles.name}>
            {instrument.name}
          </AppText>
        </View>
      </View>

      <View style={styles.right}>
        <AppText variant="body" numeric>
          {formatPrice(last, priceDecimalsFor(instrument.priceDecimals, last))}
        </AppText>
        <View style={[styles.changePill, { backgroundColor: changeColor }]}>
          <AppText variant="caption" numeric color="#04121A" style={styles.changeText}>
            {formatPercent(changePct)}
          </AppText>
        </View>
      </View>

      {onToggleWatch ? (
        <Pressable
          hitSlop={10}
          onPress={() => onToggleWatch(instrument)}
          style={styles.star}>
          <Ionicons
            name={watched ? 'star' : 'star-outline'}
            size={20}
            color={watched ? Colors.warning : Colors.textFaint}
          />
        </Pressable>
      ) : null}

      {onDrag ? (
        <Pressable
          onLongPress={onDrag}
          delayLongPress={150}
          hitSlop={12}
          style={styles.dragHandle}
          accessibilityLabel="Drag to reorder">
          <Ionicons name="reorder-three" size={24} color={Colors.textFaint} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export const SymbolRow = memo(SymbolRowImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  pressed: { backgroundColor: Colors.surface },
  dragging: { backgroundColor: Colors.surfaceAlt },
  left: { flex: 1, gap: 4, paddingRight: Spacing.md },
  symbol: { fontSize: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, color: Colors.textFaint },
  right: { alignItems: 'flex-end', gap: 4, minWidth: 96 },
  star: { paddingLeft: Spacing.md },
  dragHandle: { paddingLeft: Spacing.md, paddingVertical: 4 },
  changePill: {
    minWidth: 74,
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  changeText: { fontWeight: '700' },
});
