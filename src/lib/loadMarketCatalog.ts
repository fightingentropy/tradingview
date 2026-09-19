import type { Instrument, Quote } from '../domain/types';
import type { MarketDataProvider } from '../providers/types';
import { retainUnavailableMarkets } from './marketCatalog';
import type { OutcomeEvent } from './outcomeMarkets';

export interface MarketsData {
  instruments: Instrument[];
  // Plain record (not a Map) so the whole snapshot survives JSON persistence.
  byId: Record<string, Instrument>;
  // O(1) coin → instrument lookup (e.g. resolving a position's "BTC"/"xyz:SNDK").
  // Maps aren't JSON-serializable, so this is rebuilt by the queryFn each load.
  byCoinKey: Map<string, Instrument>;
  quotes: Record<string, Quote>;
  outcomeEvents: OutcomeEvent[];
  outcomeMarketsError: string | null;
  marketErrors?: Record<string, string>;
}

export async function loadMarketCatalog(
  providers: Pick<MarketDataProvider, 'source' | 'loadMarkets'>[],
  previous?: MarketsData,
): Promise<MarketsData> {
  const results = await Promise.allSettled(providers.map((provider) => provider.loadMarkets()));

  const instruments: Instrument[] = [];
  const quotes: Record<string, Quote> = {};
  const outcomeEvents: OutcomeEvent[] = [];
  let outcomeMarketsError: string | null = null;
  const marketErrors: Record<string, string> = {};
  for (const [index, result] of results.entries()) {
    const source = providers[index].source;
    if (result.status === 'fulfilled' && result.value.instruments.length > 0) {
      instruments.push(...result.value.instruments);
      Object.assign(quotes, result.value.quotes);
      outcomeEvents.push(...(result.value.outcomeEvents ?? []));
      outcomeMarketsError ??= result.value.outcomeMarketsError ?? null;
      Object.assign(marketErrors, result.value.marketErrors);
    } else {
      marketErrors[source] = result.status === 'rejected' && result.reason instanceof Error
        ? result.reason.message : `${source} market data unavailable`;
      if (source === 'hyperliquid') outcomeMarketsError = marketErrors[source];
    }
  }
  const retained = retainUnavailableMarkets({ instruments, quotes }, previous, marketErrors);
  if ((marketErrors.hyperliquid || marketErrors['hyperliquid:outcome']) && previous) {
    const eventIds = new Set(outcomeEvents.map((event) => event.id));
    outcomeEvents.push(...(previous.outcomeEvents ?? []).filter((event) => !eventIds.has(event.id)));
  }
  if (retained.instruments.length === 0 && Object.keys(marketErrors).length > 0) {
    throw new Error('Markets are unavailable. Please try again.');
  }
  const byId: Record<string, Instrument> = {};
  const byCoinKey = new Map<string, Instrument>();
  for (const i of retained.instruments) {
    byId[i.id] = i;
    byCoinKey.set(i.coinKey, i);
  }
  return { ...retained, byId, byCoinKey, outcomeEvents, outcomeMarketsError, marketErrors };
}
