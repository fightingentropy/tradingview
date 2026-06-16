import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { rangeLabel, RANGE_ORDER, type RangeKey } from '@/domain/ranges';

interface Props {
  value: RangeKey;
  onChange: (range: RangeKey) => void;
}

/** TradingView-style date-range selector (1D · 1W · 1M · 3M · YTD · 1Y · 5Y · All). */
export function RangeBar({ value, onChange }: Props) {
  return (
    <View style={styles.bar}>
      {RANGE_ORDER.map((key) => {
        const active = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[styles.item, active && styles.itemActive]}>
            <AppText variant="label" color={active ? Colors.text : Colors.textMuted}>
              {rangeLabel(key)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  itemActive: { backgroundColor: Colors.surfaceAlt },
});
