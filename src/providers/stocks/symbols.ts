/**
 * Curated set of liquid US equities. Kept deliberately small: the Twelve Data
 * free tier allows only **8 API credits / minute** and charges **1 credit per
 * symbol** on a /quote call. We fetch every seed's quote in one batch, so the
 * seed count must stay <= 8 — and we keep it at 6 to leave 2 credits/min of
 * headroom for on-demand candle requests when a chart is opened. The provider
 * caches the snapshot for ~10 min, so daily usage stays well under the 800/day
 * cap. Raise this list only if you move to a higher Twelve Data tier.
 */
export interface StockSeed {
  symbol: string;
  name: string;
}

export const STOCK_SEEDS: StockSeed[] = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'COIN', name: 'Coinbase Global Inc.' },
];

/**
 * Map a Twelve Data MIC code to a friendly venue label. Twelve Data reports the
 * specific operating MIC (e.g. XNGS = NASDAQ Global Select), not the generic
 * XNAS, so we cover the common operating MICs and fall back to `exchange`.
 */
export function micToVenue(mic?: string, exchange?: string): string {
  switch (mic) {
    case 'XNAS':
    case 'XNGS': // NASDAQ Global Select
    case 'XNMS': // NASDAQ Global Market
    case 'XNCM': // NASDAQ Capital Market
      return 'NASDAQ';
    case 'XNYS':
      return 'NYSE';
    case 'XASE':
      return 'NYSE American';
    case 'ARCX':
      return 'NYSE Arca';
    case 'BATS':
    case 'BATY':
      return 'CBOE';
    default:
      return exchange ?? 'NASDAQ';
  }
}
