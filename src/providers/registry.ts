import type { Source } from '@/domain/types';

import { cboeProvider } from './cboe/provider';
import { hyperliquidProvider } from './hyperliquid/provider';
import { stocksProvider } from './stocks/provider';
import type { MarketDataProvider } from './types';

/**
 * All active market-data providers. The stocks provider is inert until a
 * TWELVE_DATA_KEY is configured on the proxy (its fetches return empty, which
 * loadMarkets skips), so it is always safe to register. Cboe (VIX) is keyless.
 */
const registry: Record<Source, MarketDataProvider | undefined> = {
  hyperliquid: hyperliquidProvider,
  stocks: stocksProvider,
  cboe: cboeProvider,
};

export function getProvider(source: Source): MarketDataProvider | undefined {
  return registry[source];
}

export function allProviders(): MarketDataProvider[] {
  return Object.values(registry).filter((p): p is MarketDataProvider => p !== undefined);
}
