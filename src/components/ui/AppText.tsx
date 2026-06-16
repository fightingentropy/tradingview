import { Text as RNText, StyleSheet, type TextProps } from 'react-native';

import { Colors, Fonts, FontSize } from '@/constants/theme';

type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'mono';

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
  title: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '700' },
  heading: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '700' },
  body: { color: Colors.text, fontSize: FontSize.md, fontWeight: '500' },
  label: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600' },
  caption: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '500' },
  mono: { color: Colors.text, fontSize: FontSize.md, fontFamily: Fonts.mono },
  numeric: { fontVariant: ['tabular-nums'], fontFamily: Fonts.mono },
});
