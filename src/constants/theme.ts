/** Shared terminal palette. Colour is reserved for market direction and actions. */
import { Platform } from 'react-native';

export const Colors = {
  background: '#0B1114',
  surface: '#111B20',
  surfaceAlt: '#19262C',
  surfacePress: '#21323A',
  border: 'rgba(154, 181, 194, 0.13)',
  text: '#E6EDEF',
  textMuted: '#8A9CA5',
  textFaint: '#6F838D',
  up: '#48C99B',
  down: '#EF798A',
  accent: '#75D9C1',
  accentSoft: 'rgba(117, 217, 193, 0.10)',
  warning: '#DDBB72',
} as const;

/**
 * News uses the same surface and typography hierarchy as the trading screens.
 */
export const NewsColors = {
  background: Colors.background,
  surface: Colors.surface,
  surfaceRaised: Colors.surfaceAlt,
  chip: 'rgba(255, 255, 255, 0.055)',
  selected: Colors.text,
  onSelected: Colors.background,
  text: Colors.text,
  textMuted: Colors.textMuted,
  textFaint: Colors.textFaint,
  border: Colors.border,
  controlBorder: 'rgba(255, 255, 255, 0.18)',
} as const;

/** Indicator/overlay line colors, kept distinct from price up/down. */
export const Indicators: { sma: Record<number, string>; rsi: string } = {
  /** Distinct line color per SMA period. */
  sma: { 20: '#E8A33D', 50: '#4FC3F7', 200: '#EC6F9B' },
  rsi: '#8C9FD6',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const Radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

export const FontSize = {
  xs: 12,
  sm: 14,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 30,
} as const;

/** Monospaced/tabular fonts keep streaming numbers from jittering. */
export const Fonts = Platform.select({
  ios: { mono: 'ui-monospace' },
  default: { mono: 'monospace' },
  web: { mono: 'ui-monospace' },
}) as { mono: string };
