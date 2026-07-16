export interface CrosshairBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Group-thousands price formatter that is safe to run inside a Reanimated worklet. */
export function formatCrosshairPrice(value: number, decimals: number): string {
  'worklet';
  if (!Number.isFinite(value)) return '—';
  const safeDecimals = Number.isFinite(decimals)
    ? Math.max(0, Math.min(20, Math.floor(decimals)))
    : 2;
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(safeDecimals);
  const dot = fixed.indexOf('.');
  const integer = dot === -1 ? fixed : fixed.slice(0, dot);
  const fraction = dot === -1 ? '' : fixed.slice(dot);
  let grouped = '';
  let count = 0;
  for (let index = integer.length - 1; index >= 0; index--) {
    grouped = integer[index] + grouped;
    count++;
    if (count % 3 === 0 && index > 0) grouped = ',' + grouped;
  }
  return (negative ? '-' : '') + grouped + fraction;
}

/**
 * Fabric's native TextInput can reconcile `defaultValue` independently from its
 * internal `text` prop. Keep both animated props identical so a React render
 * during an active gesture cannot reset a valid native price label to blank.
 */
export function crosshairTextInputProps(value: number, decimals: number) {
  'worklet';
  const text = formatCrosshairPrice(value, decimals);
  return { text, defaultValue: text };
}

/** Reject incomplete/transient plot transforms rather than overwriting a valid one. */
export function isUsableCrosshairGeometry(
  xCount: number,
  bounds: CrosshairBounds,
  priceM: number,
  priceB: number,
): boolean {
  return (
    xCount > 0 &&
    Number.isFinite(bounds.top) &&
    Number.isFinite(bounds.bottom) &&
    Number.isFinite(bounds.left) &&
    Number.isFinite(bounds.right) &&
    bounds.bottom > bounds.top &&
    bounds.right > bounds.left &&
    Number.isFinite(priceM) &&
    Math.abs(priceM) > Number.EPSILON &&
    Number.isFinite(priceB)
  );
}
