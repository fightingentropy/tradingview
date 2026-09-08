import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';
import type { OutcomeEvent } from '@/lib/outcomeMarkets';

function iconFor(event: OutcomeEvent): keyof typeof Ionicons.glyphMap {
  if (event.category === 'sports') return 'football-outline';
  if (event.category === 'economics') return 'business-outline';
  if (event.category === 'crypto') return 'logo-bitcoin';
  return 'stats-chart-outline';
}

export function OutcomeEventIcon({ event, size = 34 }: { event: OutcomeEvent; size?: number }) {
  return (
    <View
      style={[
        styles.icon,
        { width: size, height: size, borderRadius: Radius.sm },
      ]}>
      <Ionicons name={iconFor(event)} size={Math.round(size * 0.5)} color={Colors.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
});
