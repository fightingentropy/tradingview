import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useSymbolMenu } from '@/components/SymbolMenu';
import { SymbolLogo } from '@/components/SymbolLogo';
import { AppText } from '@/components/ui/AppText';
import { Colors, Spacing } from '@/constants/theme';
import type { Instrument, Quote } from '@/domain/types';
import { useContextMenuTrigger } from '@/hooks/useContextMenuTrigger';
import {
  formatPercent,
  formatPrice,
  formatProbability,
  formatProbabilityPointChange,
  formatSignedPrice,
  priceDecimalsFor,
} from '@/lib/format';
import { useLivePrice } from '@/store/livePrices';

interface Props {
  instrument: Instrument;
  quote?: Quote;
  onPress: (instrument: Instrument) => void;
  /** When provided, renders a watch toggle star on the right. */
  watched?: boolean;
  onToggleWatch?: (instrument: Instrument) => void;
  /** When provided, renders a drag handle (in edit mode); long-press starts a reorder. */
  onDrag?: () => void;
  /** Highlights the row while it is the one being dragged. */
  dragging?: boolean;
  /** Edit mode: show a selection checkbox + drag handle, hide price, suppress nav/menu. */
  editing?: boolean;
  selected?: boolean;
  onToggleSelect?: (instrument: Instrument) => void;
}

function SymbolRowImpl({
  instrument,
  quote,
  onPress,
  watched,
  onToggleWatch,
  onDrag,
  dragging,
  editing,
  selected,
  onToggleSelect,
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
  const decimals = priceDecimalsFor(instrument.priceDecimals, last);
  const absChange = last !== null && prev !== null ? last - prev : null;
  const isOutcome = instrument.assetClass === 'outcome';

  const up = (changePct ?? 0) >= 0;
  const changeColor = changePct === null ? Colors.textMuted : up ? Colors.up : Colors.down;
  const changeText =
    isOutcome && absChange !== null
      ? `${formatProbabilityPointChange(absChange)}  24h`
      : absChange !== null
      ? `${formatSignedPrice(absChange, decimals)}  ${formatPercent(changePct)}`
      : formatPercent(changePct);

  const onRowPress = useCallback(() => {
    if (editing) onToggleSelect?.(instrument);
    else onPress(instrument);
  }, [editing, onToggleSelect, onPress, instrument]);

  // In edit mode the row long-press starts a reorder (this must live on the SAME
  // Pressable that owns the touch — a nested handle Pressable steals it from the
  // list's pan gesture and the drag never tracks). Otherwise it opens the menu.
  const longPressProps =
    editing && onDrag ? { onLongPress: onDrag, delayLongPress: 180 } : editing ? {} : menuTrigger;

  return (
    <Pressable
      onPress={onRowPress}
      {...longPressProps}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, dragging && styles.dragging]}>
      {editing ? (
        <Pressable
          hitSlop={10}
          onPress={() => onToggleSelect?.(instrument)}
          style={styles.checkbox}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!selected }}
          accessibilityLabel={`Select ${instrument.symbol}`}>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={selected ? Colors.accent : Colors.textFaint}
          />
        </Pressable>
      ) : null}

      <SymbolLogo instrument={instrument} />

      <View style={styles.mid}>
        <AppText style={styles.symbol} numberOfLines={1}>
          {instrument.symbol}
        </AppText>
        <AppText style={styles.name} numberOfLines={1}>
          {instrument.name}
        </AppText>
      </View>

      {editing ? null : (
        <View style={styles.right}>
          <AppText style={styles.price} numeric numberOfLines={1}>
            {isOutcome ? formatProbability(last) : formatPrice(last, decimals)}
          </AppText>
          <AppText style={[styles.change, { color: changeColor }]} numeric numberOfLines={1}>
            {changeText}
          </AppText>
        </View>
      )}

      {!editing && onToggleWatch ? (
        <Pressable hitSlop={10} onPress={() => onToggleWatch(instrument)} style={styles.star}>
          <Ionicons
            name={watched ? 'star' : 'star-outline'}
            size={20}
            color={watched ? Colors.warning : Colors.textFaint}
          />
        </Pressable>
      ) : null}

      {editing ? (
        <View style={styles.dragHandle} accessibilityLabel="Drag to reorder">
          <Ionicons name="reorder-two" size={24} color={Colors.textMuted} />
        </View>
      ) : null}
    </Pressable>
  );
}

// Compare the quote by the three fields the row actually renders (last / prevClose /
// change24hPct) rather than by object identity, and compare the rest of the props
// explicitly. Live price ticks bypass this entirely (the row subscribes to the price
// store via useLivePrice), so a parent re-render or a background quote refetch only
// re-renders the rows whose displayed data truly changed.
export const SymbolRow = memo(
  SymbolRowImpl,
  (a, b) =>
    a.instrument === b.instrument &&
    a.quote?.last === b.quote?.last &&
    a.quote?.prevClose === b.quote?.prevClose &&
    a.quote?.change24hPct === b.quote?.change24hPct &&
    a.watched === b.watched &&
    a.dragging === b.dragging &&
    a.editing === b.editing &&
    a.selected === b.selected &&
    a.onPress === b.onPress &&
    a.onToggleWatch === b.onToggleWatch &&
    a.onToggleSelect === b.onToggleSelect &&
    a.onDrag === b.onDrag,
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  pressed: { backgroundColor: Colors.surface },
  dragging: { backgroundColor: Colors.surfaceAlt },
  checkbox: { marginRight: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, marginLeft: Spacing.md, paddingRight: Spacing.sm },
  symbol: { fontSize: 16, fontWeight: '700', color: Colors.text },
  name: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  right: { alignItems: 'flex-end', marginLeft: Spacing.sm },
  price: { fontSize: 16, fontWeight: '600', color: Colors.text },
  change: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  star: { paddingLeft: Spacing.md },
  dragHandle: { paddingLeft: Spacing.md, paddingVertical: 4 },
});
