import type { AssetClass, Instrument } from './types';

const COMMODITIES = new Set([
  'GOLD', 'SILVER', 'OIL', 'WTI', 'CL', 'BRENT', 'BRENTOIL', 'NATGAS', 'GAS',
  'ALUMINIUM', 'COPPER', 'PLATINUM', 'PALLADIUM', 'WHEAT', 'CORN', 'SUGAR',
]);
const INDICES = new Set([
  'SP500', 'XYZ100', 'SPX', 'NDX', 'DJI', 'RUT', 'VIX', 'SPX500', 'US500', 'JP225', 'KR200',
]);
const CURRENCIES = new Set(['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD', 'CNH']);
const ETFS = new Set([
  'URNM', 'EWY', 'EWJ', 'EWZ', 'EWT', 'XLE', 'SMH', 'KORU', 'SOXL', 'MAGS', 'XBI',
]);
const BOND_FUNDS = new Set(['TLT', 'IEF', 'SHY', 'GOVT', 'BND', 'USBOND']);

export function classifyTradfiSymbol(symbol: string): AssetClass {
  const ticker = symbol.toUpperCase();
  if (BOND_FUNDS.has(ticker) || /^(?:US|DE|GB|JP)?(?:2|5|10|20|30)Y$/.test(ticker)) return 'rates';
  if (COMMODITIES.has(ticker)) return 'commodity';
  if (INDICES.has(ticker)) return 'index';
  if (CURRENCIES.has(ticker) || /^(?:EUR|GBP|JPY|CHF|AUD|CAD|NZD|USD)(?:USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD)$/.test(ticker)) return 'fx';
  return 'equity-perp';
}

export const WATCHLIST_THEMES = [
  { id: 'indices', name: 'Indices', icon: 'stats-chart-outline' },
  { id: 'rates', name: 'Rates', icon: 'pulse-outline' },
  { id: 'commodities', name: 'Commodities', icon: 'diamond-outline' },
  { id: 'stocks', name: 'Stocks', icon: 'business-outline' },
  { id: 'etfs', name: 'ETFs', icon: 'layers-outline' },
  { id: 'forex', name: 'Currencies', icon: 'swap-horizontal-outline' },
  { id: 'crypto', name: 'Crypto', icon: 'logo-bitcoin' },
] as const;

export type WatchlistThemeId = typeof WATCHLIST_THEMES[number]['id'];

export function watchlistThemeFor(instrument: Instrument): WatchlistThemeId | null {
  // Reclassify cached XYZ instruments too: older catalogs called SP500, JPY and TLT stocks.
  const assetClass = instrument.coinKey.startsWith('xyz:') || instrument.coinKey.startsWith('para:')
    ? classifyTradfiSymbol(instrument.symbol) : instrument.assetClass;
  switch (assetClass) {
    case 'index': return 'indices';
    case 'rates': return 'rates';
    case 'commodity': return 'commodities';
    case 'fx': return 'forex';
    case 'crypto-perp': return 'crypto';
    case 'equity-perp': return ETFS.has(instrument.symbol.toUpperCase()) ? 'etfs' : 'stocks';
    default: return null;
  }
}

const FIRST_SYMBOLS = [
  'SP500', 'XYZ100', 'JP225', 'KR200', 'VIX', '2Y', '5Y', '10Y', '30Y', 'TLT',
  'GOLD', 'SILVER', 'COPPER', 'CL', 'BRENTOIL', 'NATGAS',
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA',
  'EUR', 'GBP', 'JPY', 'BTC', 'ETH', 'HYPE', 'SOL', 'XRP', 'ZEC',
];
const rank = new Map(FIRST_SYMBOLS.map((symbol, index) => [symbol, index]));

export function themedSymbols(instruments: readonly Instrument[], theme: WatchlistThemeId): string[] {
  return [...new Set(instruments.filter((instrument) => watchlistThemeFor(instrument) === theme)
    .sort((a, b) => (rank.get(a.symbol) ?? Infinity) - (rank.get(b.symbol) ?? Infinity)
      || a.symbol.localeCompare(b.symbol) || a.id.localeCompare(b.id))
    .map((instrument) => instrument.id))];
}
