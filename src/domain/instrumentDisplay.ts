import type { Instrument } from './types';

// Presentation only: provider IDs, contract types and order descriptions stay intact.
const NAMES: Readonly<Record<string, string>> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', HYPE: 'Hyperliquid', ZEC: 'Zcash',
  SOL: 'Solana', XRP: 'XRP', DOGE: 'Dogecoin', LTC: 'Litecoin',
  AVAX: 'Avalanche', BNB: 'BNB', SUI: 'Sui', ADA: 'Cardano',
  LINK: 'Chainlink', DOT: 'Polkadot', ARB: 'Arbitrum', OP: 'Optimism',
  NVDA: 'NVIDIA', GOOGL: 'Alphabet', GOOG: 'Alphabet', AMZN: 'Amazon',
  TSLA: 'Tesla', AAPL: 'Apple', MSFT: 'Microsoft', META: 'Meta',
  SPCX: 'SpaceX', HOOD: 'Robinhood', SNDK: 'SanDisk', MU: 'Micron',
  HIMS: 'Hims & Hers', LLY: 'Eli Lilly', LITE: 'Lumentum',
  AMD: 'AMD', PLTR: 'Palantir', COIN: 'Coinbase', NFLX: 'Netflix',
  AVGO: 'Broadcom', ORCL: 'Oracle', CRM: 'Salesforce', INTC: 'Intel',
  SP500: 'S&P 500', SPX: 'S&P 500', XYZ100: 'US Tech 100',
  VIX: 'Volatility Index', GOLD: 'Gold', SILVER: 'Silver',
  COPPER: 'Copper', NATGAS: 'Natural gas', PLATINUM: 'Platinum',
};

export function instrumentDisplayName(instrument: Instrument): string {
  if (instrument.assetClass === 'outcome') return instrument.name;
  const name = NAMES[instrument.symbol.toUpperCase()];
  if (!name) return instrument.name;
  return instrument.assetClass === 'crypto-spot' ? `${name} · Spot` : name;
}
