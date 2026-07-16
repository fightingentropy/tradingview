import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius } from '@/constants/theme';

const VENUE_COLOR: Record<string, string> = {
  Hyperliquid: '#2EBD85',
  'Hyperliquid Outcomes': '#C59CFF',
  'trade.xyz': '#B07CFF',
  NASDAQ: '#5AA9FF',
  NYSE: '#5AA9FF',
};

export function VenueBadge({ venue }: { venue: string }) {
  const dot = VENUE_COLOR[venue] ?? Colors.textMuted;
  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <AppText variant="caption">{venue}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
