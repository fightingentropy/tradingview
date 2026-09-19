import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useTradeFeedback } from '@/store/tradeFeedback';
import { usePreferences } from '@/store/preferences';

/** A short receipt after the ticket closes; never delays or retries an order. */
export function TradeFeedbackHost() {
  const receipt = useTradeFeedback((state) => state.receipt);
  const dismiss = useTradeFeedback((state) => state.dismiss);
  const hidden = usePreferences((state) => state.privacyMode);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!receipt) return;
    const timer = setTimeout(() => dismiss(receipt.id), 4000);
    return () => clearTimeout(timer);
  }, [receipt, dismiss]);
  if (!receipt) return null;
  return <View pointerEvents="box-none" style={[styles.host, { top: insets.top + Spacing.sm }]}>
    <View style={styles.banner} accessibilityLiveRegion="polite" accessible accessibilityLabel={`${receipt.title}${hidden ? '' : `. ${receipt.detail}`}`}>
      <Ionicons name={receipt.tone === 'pending' ? 'time-outline' : 'checkmark-circle'} size={24} color={Colors.accent} />
      <View style={styles.copy}><AppText variant="label">{receipt.title}</AppText><AppText variant="caption" numeric>{hidden ? '••••••' : receipt.detail}</AppText></View>
      <Pressable onPress={() => dismiss(receipt.id)} accessibilityRole="button" accessibilityLabel="Dismiss order receipt" hitSlop={10}><Ionicons name="close" size={18} color={Colors.textMuted} /></Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, paddingHorizontal: Spacing.md, zIndex: 1100, elevation: 1100 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: 14, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  copy: { flex: 1, gap: 3 },
});
