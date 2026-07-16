import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import type { OutcomeEvent } from '@/lib/outcomeMarkets';

function iconFor(event: OutcomeEvent): keyof typeof Ionicons.glyphMap {
  if (event.category === 'sports') return 'football-outline';
  if (event.category === 'economics') return 'business-outline';
  if (event.category === 'crypto') return 'logo-bitcoin';
  return 'sparkles-outline';
}

export function OutcomeEventIcon({ event, size = 44 }: { event: OutcomeEvent; size?: number }) {
  return (
    <View
      style={[
        styles.icon,
        { width: size, height: size, borderRadius: size / 2 },
        event.category === 'crypto' && styles.crypto,
        event.category === 'sports' && styles.sports,
        event.category === 'economics' && styles.economics,
      ]}>
      <Ionicons name={iconFor(event)} size={Math.round(size * 0.5)} color={Colors.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  crypto: { backgroundColor: 'rgba(240,185,11,0.18)' },
  sports: { backgroundColor: 'rgba(46,189,133,0.17)' },
  economics: { backgroundColor: 'rgba(41,98,255,0.20)' },
});
