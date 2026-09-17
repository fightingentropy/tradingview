import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import type { marketPriceState } from '@/lib/marketFreshness';

type PriceState = ReturnType<typeof marketPriceState>;

const DETAILS: Record<PriceState['status'], string> = {
  live: 'Prices are updating live.',
  snapshot: 'Showing the most recent quote. Live updates have not arrived yet.',
  connecting: 'Connecting to live prices.',
  reconnecting: 'Reconnecting to live prices. Showing the most recent quote.',
  paused: 'Live updates are paused. Showing the most recent quote.',
  delayed: 'This market has delayed prices.',
  stale: 'This price may be out of date.',
  unavailable: 'A price is not available for this market.',
};

/** Keep feed details available without repeating a status sentence on every row. */
export function PriceStatus({ state }: { state: PriceState }) {
  if (state.status === 'live') return null;
  const busy = state.status === 'connecting' || state.status === 'reconnecting';
  const warning = state.stale || state.status === 'unavailable';
  const color = warning ? Colors.warning : Colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={state.label}
      accessibilityHint="Shows price update details"
      accessibilityState={{ busy }}
      hitSlop={6}
      style={styles.status}
      onPress={() => Alert.alert(state.label, DETAILS[state.status] + (state.ts ? ` Last updated ${new Date(state.ts).toLocaleTimeString()}.` : ''))}>
      {busy ? <ActivityIndicator size="small" color={color} style={styles.spinner} /> : (
        <Ionicons name={warning ? 'alert-circle-outline' : state.status === 'paused' ? 'pause-circle-outline' : 'time-outline'} size={13} color={color} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  status: { width: 22, height: 26, alignItems: 'center', justifyContent: 'center' },
  spinner: { transform: [{ scale: 0.65 }] },
});
