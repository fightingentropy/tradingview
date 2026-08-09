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
  effectStyle?: 'regular' | 'clear';
}>;

/** Native Liquid Glass with a quiet rim and a layered near-black fallback. */
export function GlassSurface({
  children,
  style,
  tintColor = 'rgba(8,11,16,0.54)',
  interactive = false,
  effectStyle = 'clear',
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
        glassEffectStyle={effectStyle}
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
    borderColor: 'rgba(255,255,255,0.085)',
  },
  fallback: { backgroundColor: 'rgba(14,18,24,0.96)' },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
