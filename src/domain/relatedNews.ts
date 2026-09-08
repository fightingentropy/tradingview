import type { NewsItem } from './news';
import type { Instrument } from './types';

export interface RelatedNewsItem {
  item: NewsItem;
  instruments: Instrument[];
}

// Known company/project names complement explicit cashtags. Ordinary-word tickers
// (HYPE, ON, GAS, LITE, etc.) never match bare prose.
const NAMES: Readonly<Record<string, readonly string[]>> = {
  BTC: ['Bitcoin'], ETH: ['Ethereum'], HYPE: ['Hyperliquid'], ZEC: ['Zcash'],
  SOL: ['Solana'], XRP: ['XRP'], DOGE: ['Dogecoin'], LTC: ['Litecoin'],
  AVAX: ['Avalanche network'], BNB: ['Binance Coin'], SUI: ['Sui network'],
  NVDA: ['Nvidia'], GOOGL: ['Alphabet Inc', 'Google'], GOOG: ['Alphabet Inc', 'Google'],
  AMZN: ['Amazon.com', 'Amazon Web Services'], TSLA: ['Tesla'],
  AAPL: ['Apple Inc'], MSFT: ['Microsoft'], META: ['Meta Platforms'],
  SPCX: ['SpaceX'], HOOD: ['Robinhood'], SNDK: ['SanDisk'], MU: ['Micron'],
  HIMS: ['Hims & Hers', 'Hims and Hers'], LLY: ['Eli Lilly'], LITE: ['Lumentum'],
  AMD: ['Advanced Micro Devices'], PLTR: ['Palantir'], COIN: ['Coinbase'],
  SP500: ['S&P 500', 'S&P500', 'Standard & Poor’s 500'],
  SPX: ['S&P 500', 'S&P500'], XYZ100: ['Nasdaq 100', 'Nasdaq-100'],
  NDX: ['Nasdaq 100', 'Nasdaq-100'], VIX: ['Cboe Volatility Index'],
};

const BARE_TICKERS = new Set([
  'BTC', 'ETH', 'ZEC', 'XRP', 'DOGE', 'LTC', 'AVAX', 'BNB',
  'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'TSLA', 'AAPL', 'MSFT', 'SNDK',
  'AMD', 'PLTR', 'SP500', 'SPX', 'XYZ100', 'NDX', 'VIX',
]);
const CONTEXT_NAMES: Readonly<Record<string, string>> = {
  AAPL: 'Apple', AMZN: 'Amazon', META: 'Meta', GOLD: 'gold', SILVER: 'silver',
  OIL: 'oil', GAS: 'gas', COPPER: 'copper', CORN: 'corn', GOOGL: 'Alphabet', GOOG: 'Alphabet',
};
const FINANCIAL_CONTEXT = '(?:stock|shares?|earnings|revenue|guidance|market|price|prices|futures|trading|rall(?:y|ies|ied)|falls?|rose|rises?|drops?|surges?)';
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (value: string, flags = 'iu') =>
  new RegExp(`(^|[^\\p{L}\\p{N}_])${escapePattern(value)}(?=$|[^\\p{L}\\p{N}_])`, flags);

function instrumentPatterns(instrument: Instrument): RegExp[] {
  if (instrument.assetClass === 'outcome') return [];
  const rawSymbol = instrument.symbol.split('/')[0].toUpperCase();
  // Unit wrappers explicitly represent these underlying assets.
  const symbol = instrument.assetClass === 'crypto-spot' && /^U(?:BTC|ETH|SOL)$/.test(rawSymbol)
    ? rawSymbol.slice(1)
    : rawSymbol;
  if (!/^[A-Z][A-Z0-9.]{0,14}$/.test(symbol)) return [];
  const patterns = [word(`$${symbol}`)];
  if (rawSymbol !== symbol) patterns.push(word(`$${rawSymbol}`));
  if (BARE_TICKERS.has(symbol)) patterns.push(word(symbol, 'u'));
  for (const name of NAMES[symbol] ?? []) patterns.push(word(name));

  // A short or ambiguous ticker needs nearby market language, e.g. "MU shares".
  patterns.push(new RegExp(`(^|[^\\p{L}\\p{N}_])${escapePattern(symbol)}\\s+(?:stock|shares?|earnings|futures)(?=$|[^\\p{L}\\p{N}_])`, 'u'));
  const contextName = CONTEXT_NAMES[symbol];
  if (contextName) {
    patterns.push(new RegExp(`(^|[^\\p{L}\\p{N}_])${escapePattern(contextName)}\\s+${FINANCIAL_CONTEXT}(?=$|[^\\p{L}\\p{N}_])`, 'iu'));
  }
  // Full multi-word names can be useful for catalog entries without a known alias.
  // Provider labels such as "ON Perpetual" and "GAS/USDC" deliberately don't qualify.
  const fullName = instrument.name.replace(/\s+(?:perp|perpetual)$/i, '').trim();
  if (fullName.split(/\s+/).length >= 2 && fullName.length >= 10 && !fullName.includes('/')) {
    patterns.push(word(fullName));
  }
  return patterns;
}

/** Compile once per instrument set; classify article text, never author names or URLs. */
export function createRelatedNewsMatcher(instruments: readonly Instrument[]) {
  const compiled = instruments.map((instrument) => ({ instrument, patterns: instrumentPatterns(instrument) }));
  return (items: readonly NewsItem[]): RelatedNewsItem[] => {
    const seen = new Set<string>();
    return items.flatMap((item): RelatedNewsItem[] => {
      const key = `${item.source}:${item.id}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const text = item.text.replace(/https?:\/\/\S+/gi, '').replace(/@[\p{L}\p{N}_]+/gu, '');
      const matches = compiled.filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)));
      return matches.length ? [{ item, instruments: matches.map(({ instrument }) => instrument) }] : [];
    }).sort((left, right) => Date.parse(right.item.publishedAt) - Date.parse(left.item.publishedAt));
  };
}
