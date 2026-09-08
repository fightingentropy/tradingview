import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

type Props = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  interactive?: boolean;
  effectStyle?: 'regular' | 'clear';
}>;

/** Shared opaque panel, retaining the existing surface API for callers. */
export function GlassSurface({ children, style }: Props) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
});
