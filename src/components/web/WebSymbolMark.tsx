import type { CSSProperties } from 'react';

const MARKET_ICONS: Record<string, string> = {
  AMZN: '/market-icons/amzn.svg',
  BTC: '/market-icons/btc.svg',
  ETH: '/market-icons/eth.svg',
  GOOGL: '/market-icons/googl.svg',
  GOOG: '/market-icons/googl.svg',
  HOOD: '/market-icons/hood.svg',
  HYPE: '/market-icons/hype.svg',
  MU: '/market-icons/mu.svg',
  NVDA: '/market-icons/nvda.svg',
  SNDK: '/market-icons/sndk.svg',
  SOL: '/market-icons/sol.svg',
  TSLA: '/market-icons/tsla.svg',
  XYZ100: '/market-icons/xyz100.svg',
  ZEC: '/market-icons/zec.svg',
};

const ROUND_MARKS = new Set(['BTC', 'ETH', 'HYPE', 'SOL', 'ZEC']);

export function WebSymbolMark({ symbol, large = false }: { symbol: string; large?: boolean }) {
  const normalized = symbol.toUpperCase();
  const icon = MARKET_ICONS[normalized];
  let hash = 0;
  for (let index = 0; index < symbol.length; index += 1) {
    hash = (hash * 31 + symbol.charCodeAt(index)) >>> 0;
  }
  const hues = [155, 210, 255, 30, 335, 275];
  const hue = hues[hash % hues.length];
  return (
    <span
      className={`web-symbol-mark${icon ? ' has-icon' : ''}${ROUND_MARKS.has(normalized) ? ' is-round' : ''}${large ? ' is-large' : ''}`}
      style={{ '--symbol-hue': hue } as CSSProperties}>
      {icon ? <img src={icon} alt="" draggable={false} /> : symbol.slice(0, 2)}
    </span>
  );
}
