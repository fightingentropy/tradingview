/**
 * Dark, TradingView-style design tokens. The app is dark-only for now.
 */
import { Platform } from 'react-native';

export const Colors = {
  background: '#000000',
  surface: '#141A22',
  surfaceAlt: '#1C2530',
  surfacePress: '#222C39',
  border: '#1B212B',
  text: '#EAECEF',
  textMuted: '#8A929E',
  textFaint: '#5A626E',
  up: '#2EBD85',
  down: '#F6465D',
  accent: '#2962FF',
  accentSoft: '#16243F',
  warning: '#F0B90B',
} as const;

export type ColorName = keyof typeof Colors;

/** Indicator/overlay line colors, kept distinct from price up/down. */
export const Indicators: { sma: Record<number, string>; rsi: string } = {
  /** Distinct line color per SMA period. */
  sma: { 20: '#E8A33D', 50: '#4FC3F7', 200: '#EC6F9B' },
  rsi: '#7E57FF',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 22,
  xxl: 30,
} as const;

/** Monospaced/tabular fonts keep streaming numbers from jittering. */
export const Fonts = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', rounded: 'normal', mono: 'monospace' },
  web: { sans: 'system-ui', rounded: 'system-ui', mono: 'ui-monospace' },
}) as { sans: string; rounded: string; mono: string };
