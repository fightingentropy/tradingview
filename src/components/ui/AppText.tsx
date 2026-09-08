import { Text as RNText, StyleSheet, type TextProps } from 'react-native';

import { Colors, Fonts, FontSize } from '@/constants/theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'mono';

type Props = TextProps & {
  variant?: Variant;
  color?: string;
  muted?: boolean;
  /** Tabular figures so streaming numbers don't shift width. */
  numeric?: boolean;
};

export function AppText({ variant = 'body', color, muted, numeric, style, ...rest }: Props) {
  return (
    <RNText
      {...rest}
      style={[
        styles[variant],
        muted && { color: Colors.textMuted },
        color ? { color } : null,
        numeric && styles.numeric,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  display: {
    color: Colors.text,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '500',
    letterSpacing: -0.8,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: -0.6,
  },
  heading: {
    color: Colors.text,
    fontSize: FontSize.xl,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.25,
  },
  body: { color: Colors.text, fontSize: FontSize.md, lineHeight: 21, fontWeight: '400' },
  label: { color: Colors.text, fontSize: FontSize.sm, lineHeight: 19, fontWeight: '600' },
  caption: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    lineHeight: 16,
    fontWeight: '400',
  },
  mono: {
    color: Colors.text,
    fontSize: FontSize.md,
    lineHeight: 21,
    fontFamily: Fonts.mono,
  },
  // SF Pro (the system font) with tabular figures — matches the TradingView app;
  // tabular-nums keeps streaming prices from jittering without a monospace face.
  numeric: { fontVariant: ['tabular-nums'] },
});
