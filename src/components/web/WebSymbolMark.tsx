import type { CSSProperties } from 'react';

export function WebSymbolMark({ symbol, large = false }: { symbol: string; large?: boolean }) {
  let hash = 0;
  for (let index = 0; index < symbol.length; index += 1) {
    hash = (hash * 31 + symbol.charCodeAt(index)) >>> 0;
  }
  const hues = [155, 210, 255, 30, 335, 275];
  const hue = hues[hash % hues.length];
  return (
    <span
      className={`web-symbol-mark${large ? ' is-large' : ''}`}
      style={{ '--symbol-hue': hue } as CSSProperties}>
      {symbol.slice(0, 2)}
    </span>
  );
}
