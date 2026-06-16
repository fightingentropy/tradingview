import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';

type Props = PropsWithChildren<{
  edges?: Edge[];
  style?: ViewStyle;
}>;

export function Screen({ children, edges = ['top'], style }: Props) {
  return (
    <SafeAreaView style={styles.root} edges={edges}>
      <View style={[styles.body, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1 },
});
