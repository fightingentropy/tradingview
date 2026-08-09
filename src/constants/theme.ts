/** Dark, low-contrast design tokens. The app is intentionally dark-only. */
import { Platform } from 'react-native';

export const Colors = {
  background: '#05070A',
  surface: '#0D1117',
  surfaceAlt: '#151B24',
  surfacePress: '#1B2430',
  border: 'rgba(255, 255, 255, 0.08)',
  text: '#F4F7FB',
  textMuted: '#9DA7B5',
  textFaint: '#687383',
  up: '#32D7A0',
  down: '#FF6077',
  accent: '#7890FF',
  accentSoft: 'rgba(120, 144, 255, 0.16)',
  warning: '#F4C55B',
} as const;

/**
 * The quieter, warm monochrome hierarchy used by the News experience.
 * It mirrors Wallet's true-black canvas and near-black elevated surfaces while
 * leaving the trading palette above intact for charts and market data.
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
  rsi: '#7E57FF',
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
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const FontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  xxl: 34,
} as const;

/** Monospaced/tabular fonts keep streaming numbers from jittering. */
export const Fonts = Platform.select({
  ios: { mono: 'ui-monospace' },
  default: { mono: 'monospace' },
  web: { mono: 'ui-monospace' },
}) as { mono: string };
