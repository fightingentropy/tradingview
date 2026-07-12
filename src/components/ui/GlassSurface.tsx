import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export const LIQUID_GLASS_AVAILABLE =
  isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

type Props = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  interactive?: boolean;
}>;

/** Native dark Liquid Glass with a restrained lit rim and a solid fallback. */
export function GlassSurface({
  children,
  style,
  tintColor = 'rgba(0,0,0,0.58)',
  interactive = false,
}: Props) {
  const content = (
    <>
      <View pointerEvents="none" style={styles.topHighlight} />
      {children}
    </>
  );

  if (LIQUID_GLASS_AVAILABLE) {
    return (
      <GlassView
        style={[styles.surface, style]}
        glassEffectStyle="regular"
        colorScheme="dark"
        tintColor={tintColor}
        isInteractive={interactive}>
        {content}
      </GlassView>
    );
  }

  return <View style={[styles.surface, styles.fallback, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  fallback: { backgroundColor: 'rgba(18,18,20,0.94)' },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
});
