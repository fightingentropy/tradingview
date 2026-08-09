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
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1.1,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.75,
  },
  heading: {
    color: Colors.text,
    fontSize: FontSize.xl,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  body: { color: Colors.text, fontSize: FontSize.md, lineHeight: 22, fontWeight: '500' },
  label: { color: Colors.text, fontSize: FontSize.sm, lineHeight: 19, fontWeight: '600' },
  caption: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    lineHeight: 16,
    fontWeight: '500',
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
