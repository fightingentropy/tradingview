import * as Haptics from 'expo-haptics';
import { ActivityIndicator, StyleSheet, Switch, View } from 'react-native';

import { Colors } from '@/constants/theme';

export function GlassToggle({
  value,
  onValueChange,
  disabled = false,
  loading = false,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View style={styles.control}>
      <Switch
        value={value}
        disabled={disabled || loading}
        onValueChange={(next) => {
          void Haptics.selectionAsync();
          onValueChange(next);
        }}
        trackColor={{ false: Colors.surfacePress, true: Colors.accent }}
        thumbColor={Colors.text}
        ios_backgroundColor={Colors.surfacePress}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ checked: value, disabled: disabled || loading, busy: loading }}
        style={loading ? styles.busy : undefined}
      />
      {loading ? <ActivityIndicator style={StyleSheet.absoluteFill} color={Colors.accent} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  control: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  busy: { opacity: 0.2 },
});
