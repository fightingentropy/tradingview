import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { INTERVALS, INTERVAL_ORDER } from '@/domain/intervals';
import type { CandleInterval } from '@/domain/types';

interface Props {
  value: CandleInterval;
  onChange: (interval: CandleInterval) => void;
}

export function TimeframeBar({ value, onChange }: Props) {
  return (
    <View style={styles.bar}>
      {INTERVAL_ORDER.map((iv) => {
        const active = iv === value;
        return (
          <Pressable
            key={iv}
            onPress={() => onChange(iv)}
            style={[styles.item, active && styles.itemActive]}>
            <AppText variant="label" color={active ? Colors.text : Colors.textMuted}>
              {INTERVALS[iv].label}
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
    paddingHorizontal: Spacing.lg,
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
