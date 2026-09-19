import { AppText } from '@/components/ui/AppText';
import { Colors, Spacing } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

export function MarketFeedNotice({ empty = false, busy, onRetry }: { empty?: boolean; busy: boolean; onRetry: () => void }) {
  return <View style={[styles.notice, empty && styles.empty]}>
    <Ionicons name="cloud-offline-outline" size={empty ? 28 : 18} color={Colors.textMuted} />
    <AppText variant={empty ? 'body' : 'caption'} muted style={!empty && styles.message}>
      {empty ? 'Markets unavailable' : 'Some prices couldn’t refresh'}
    </AppText>
    <Pressable accessibilityRole="button" accessibilityLabel="Retry loading markets" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onRetry} style={styles.retry}>
      {busy ? <ActivityIndicator size="small" color={Colors.accent} /> : <AppText variant="label" color={Colors.accent}>Retry</AppText>}
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: 4 },
  empty: { flexDirection: 'column', paddingVertical: 64, gap: Spacing.md },
  message: { flex: 1 },
  retry: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
