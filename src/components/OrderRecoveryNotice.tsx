import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useOrderRecovery } from '@/data/useOrderRecovery';
import type { HlNetwork } from '@/lib/hyperliquid/info';
import { recoveryComplete } from '@/lib/orderRecovery';
import { orderRecovery, withOrderRecoveryLock } from '@/store/orderRecovery';

function statusLabel(status: string | null): string {
  if (status === null) return 'Awaiting exchange confirmation';
  if (status === 'filled') return 'Filled';
  if (status === 'open' || status === 'resting') return 'Open';
  if (status === 'waitingForFill') return 'Waiting for entry fill';
  if (status === 'waitingForTrigger') return 'Waiting for trigger';
  if (status === 'triggered') return 'Triggered';
  if (status === 'error' || /rejected/i.test(status)) return 'Rejected';
  if (/cancel/i.test(status)) return 'Canceled';
  return status;
}

export function OrderRecoveryNotice({ network, address }: { network: HlNetwork; address?: string }) {
  const recovery = useOrderRecovery(network, address);
  if (!recovery.blocked) return null;
  return (
    <View style={styles.container}>
      <AppText variant="label">{recovery.storageError ? 'Order status unavailable' : recovery.attempts.every(recoveryComplete) ? 'Review your orders' : 'Order confirmation pending'}</AppText>
      {recovery.storageError ? <AppText variant="caption" muted>{recovery.storageError}</AppText> : recovery.attempts.map((attempt) => {
        const complete = recoveryComplete(attempt);
        return (
          <View key={attempt.id} style={styles.attempt}>
            <AppText variant="body">{attempt.coin ?? 'Order'} · {new Date(attempt.startedAt).toLocaleString()}</AppText>
            {attempt.legs.map((leg) => (
              <AppText key={leg.clientId} variant="caption" muted>{leg.label}: {statusLabel(leg.status)}</AppText>
            ))}
            <AppText variant="caption" muted>
              {complete ? 'Check your position and stop loss before continuing.' : 'New orders are paused until these are confirmed. They may have gone through.'}
            </AppText>
            {complete ? (
              <Pressable accessibilityRole="button" onPress={async () => {
                try { await withOrderRecoveryLock(() => orderRecovery.acknowledge(attempt.id)); }
                catch (error) { Alert.alert('Order recovery', error instanceof Error ? error.message : 'Could not save review.'); }
              }}>
                <AppText variant="label" color={Colors.accent}>Reviewed — allow new orders</AppText>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Check order status" accessibilityState={{ busy: recovery.isFetching }} disabled={recovery.isFetching} onPress={() => { void recovery.refetch(); }} style={styles.retry}>
                {recovery.isFetching ? <ActivityIndicator size="small" color={Colors.accent} /> : <AppText variant="label" color={Colors.accent}>Check again</AppText>}
              </Pressable>
            )}
          </View>
        );
      })}
      {recovery.isError ? <AppText variant="caption" color={Colors.textMuted}>Can’t reach the exchange. New orders remain paused.</AppText> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { marginHorizontal: Spacing.lg, marginVertical: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, gap: Spacing.sm },
  attempt: { gap: Spacing.sm },
  retry: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
