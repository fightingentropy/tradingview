/**
 * Chart canvases take colours as plain strings, so these mirror the design
 * tokens in index.css (--color-brand-*). Keep the two in step.
 */
export const CHART_FONT_FAMILY = "Inter, system-ui, sans-serif";

export const CHART_COLORS = {
  /** --color-brand-screen */
  background: "#0b0e11",
  /** --color-brand-slate-500 */
  text: "#7d8692",
  /** --color-brand-hairline */
  grid: "#191e24",
  /** --color-brand-border */
  scaleBorder: "#20262d",
  /** --color-brand-slate-600 */
  crosshair: "#4a525d",
  crosshairLabel: "#4a525d",
  /** --color-brand-green-400 / --color-brand-red-400 */
  up: "#43c6a1",
  down: "#ef6f7f",
  volumeUp: "rgba(67, 198, 161, 0.4)",
  volumeDown: "rgba(239, 111, 127, 0.4)",
} as const;
