import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { PriceStatus } from '@/components/PriceStatus';
import { SymbolLogo } from '@/components/SymbolLogo';
import { useSymbolMenu } from '@/components/SymbolMenu';
import { AppText } from '@/components/ui/AppText';
import { Colors, Spacing } from '@/constants/theme';
import { instrumentDisplayName } from '@/domain/instrumentDisplay';
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
import { useMarketPrice } from '@/store/livePrices';

export const SYMBOL_ROW_HEIGHT = 64;
export const symbolRowHeight = (fontScale: number) => Math.max(SYMBOL_ROW_HEIGHT, Math.ceil(44 * fontScale + 20));
export const SYMBOL_PRICE_WIDTH = 92;
export const SYMBOL_CHANGE_WIDTH = 78;

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
  /** Separate price and percentage columns in the watchlist. */
  columns?: boolean;
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
  columns = false,
}: Props) {
  const { fontScale, width } = useWindowDimensions();
  const largeText = fontScale > 1.15;
  const separateColumns = columns && !largeText;
  const { open } = useSymbolMenu();
  const onOpenMenu = useCallback(() => open(instrument), [open, instrument]);
  const menuTrigger = useContextMenuTrigger(onOpenMenu);

  const priceState = useMarketPrice(instrument, quote);
  const last = priceState.last;
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
      ? formatProbabilityPointChange(absChange)
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
      accessibilityRole={editing ? 'checkbox' : 'button'}
      accessibilityState={editing ? { checked: !!selected } : undefined}
      style={({ pressed }) => [styles.row, { height: symbolRowHeight(fontScale) }, pressed && styles.pressed, dragging && styles.dragging]}>
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

      <SymbolLogo instrument={instrument} size={32} />

      <View style={styles.mid}>
        <AppText style={styles.symbol} numberOfLines={1}>
          {instrument.symbol}
        </AppText>
        <View style={styles.description}>
          <AppText style={styles.name} numberOfLines={1}>
            {instrumentDisplayName(instrument)}
          </AppText>
          <PriceStatus state={priceState} />
        </View>
      </View>

      {editing ? null : (
        <View style={[styles.right, separateColumns && styles.priceColumn, largeText && { width: Math.min(168 * fontScale, width * 0.48) }]}>
          <AppText style={[styles.price, priceState.stale && { color: Colors.textMuted }]} numeric numberOfLines={1} adjustsFontSizeToFit={!largeText} minimumFontScale={0.8}>
            {isOutcome ? formatProbability(last) : formatPrice(last, decimals)}
          </AppText>
          <AppText style={[styles.change, largeText && styles.largeChange, { color: changeColor }]} numeric numberOfLines={1}>
            {separateColumns ? (isOutcome ? '' : formatSignedPrice(absChange, decimals)) : changeText}
          </AppText>
        </View>
      )}

      {!editing && separateColumns ? (
        <View style={[styles.changeBadge, { backgroundColor: changePct === null ? Colors.surfaceAlt : changeColor + '1C' }]}>
          <AppText style={[styles.badgeText, { color: changeColor }]} numeric numberOfLines={1}>
            {changeText}
          </AppText>
        </View>
      ) : null}

      {!editing && onToggleWatch ? (
        <Pressable hitSlop={10} onPress={() => onToggleWatch(instrument)} style={styles.star} accessibilityRole="button" accessibilityLabel={`${watched ? 'Remove' : 'Add'} ${instrument.symbol} ${watched ? 'from' : 'to'} watchlist`}>
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

// Compare visible quote fields and freshness instead of object identity, and compare the rest of the props
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
    a.quote?.ts === b.quote?.ts &&
    a.columns === b.columns &&
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
    height: SYMBOL_ROW_HEIGHT,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  pressed: { backgroundColor: Colors.surface },
  dragging: { backgroundColor: Colors.surfaceAlt },
  checkbox: { marginRight: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, minWidth: 0, marginLeft: 10, paddingRight: Spacing.sm },
  symbol: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: 0.1, color: Colors.text },
  description: { flexDirection: 'row', alignItems: 'center', minHeight: 20 },
  name: { flexShrink: 1, fontSize: 12, lineHeight: 17, color: Colors.textMuted },
  right: { alignItems: 'flex-end', marginLeft: Spacing.sm },
  priceColumn: { width: SYMBOL_PRICE_WIDTH, marginLeft: 0 },
  price: { fontSize: 16, lineHeight: 21, fontWeight: '500', letterSpacing: -0.3, color: Colors.text },
  change: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  largeChange: { fontSize: 14, fontWeight: '600' },
  changeBadge: { width: SYMBOL_CHANGE_WIDTH, minHeight: 30, marginLeft: 12, paddingHorizontal: 4, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { width: '100%', textAlign: 'center', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  star: { paddingLeft: Spacing.md },
  dragHandle: { paddingLeft: Spacing.md, paddingVertical: 4 },
});
