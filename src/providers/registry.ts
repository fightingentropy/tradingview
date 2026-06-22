import type { Source } from '@/domain/types';

import { cboeProvider } from './cboe/provider';
import { hyperliquidProvider } from './hyperliquid/provider';
import type { MarketDataProvider } from './types';

/**
 * All active market-data providers. Hyperliquid covers crypto perps + spot and
 * the trade.xyz (HIP-3 `xyz` dex) equity/commodity/FX perps; Cboe serves the VIX.
 * All are keyless.
 */
const registry: Record<Source, MarketDataProvider | undefined> = {
  hyperliquid: hyperliquidProvider,
  cboe: cboeProvider,
};

export function getProvider(source: Source): MarketDataProvider | undefined {
  return registry[source];
}

export function allProviders(): MarketDataProvider[] {
  return Object.values(registry).filter((p): p is MarketDataProvider => p !== undefined);
}
