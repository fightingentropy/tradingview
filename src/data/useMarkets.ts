import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { Instrument, Quote } from '@/domain/types';
import type { OutcomeEvent } from '@/lib/outcomeMarkets';
import { queryKeys } from '@/lib/queryKeys';
import { allProviders } from '@/providers/registry';
import { usePreferences } from '@/store/preferences';

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
}

export async function loadAllMarkets(): Promise<MarketsData> {
  const providers = allProviders();
  const results = await Promise.allSettled(providers.map((provider) => provider.loadMarkets()));

  const instruments: Instrument[] = [];
  const quotes: Record<string, Quote> = {};
  const outcomeEvents: OutcomeEvent[] = [];
  let outcomeMarketsError: string | null = null;
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      instruments.push(...result.value.instruments);
      Object.assign(quotes, result.value.quotes);
      outcomeEvents.push(...(result.value.outcomeEvents ?? []));
      outcomeMarketsError ??= result.value.outcomeMarketsError ?? null;
    } else if (providers[index]?.source === 'hyperliquid') {
      outcomeMarketsError =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
    }
  }
  const byId: Record<string, Instrument> = {};
  const byCoinKey = new Map<string, Instrument>();
  for (const i of instruments) {
    byId[i.id] = i;
    byCoinKey.set(i.coinKey, i);
  }
  return { instruments, byId, byCoinKey, quotes, outcomeEvents, outcomeMarketsError };
}

/**
 * Guarantee `byCoinKey` is a real `Map` at every consumer. The query cache is
 * JSON-persisted (see queryClient), and a `Map` isn't JSON-serializable — it
 * rehydrates as a plain `{}` on a cold start, so calling `.get` on it would throw
 * (an uncaught render error → hard app crash). Rebuild it from the JSON-safe
 * `instruments` array on read. A freshly-fetched value already carries a Map and
 * is returned untouched, so there's no extra allocation or re-render in the steady
 * state.
 */
function withCoinKeyIndex(data: MarketsData): MarketsData {
  if (data.byCoinKey instanceof Map) return data;
  const byCoinKey = new Map<string, Instrument>();
  for (const i of data.instruments) byCoinKey.set(i.coinKey, i);
  return { ...data, byCoinKey };
}

/** Hide outcome contracts from ordinary market/watchlist consumers. */
export function withOutcomeVisibility(
  data: MarketsData,
  showOutcomeMarkets: boolean,
): MarketsData {
  const indexed = withCoinKeyIndex(data);
  if (showOutcomeMarkets) return indexed;
  const instruments = indexed.instruments.filter((instrument) => instrument.assetClass !== 'outcome');
  const byId: Record<string, Instrument> = {};
  const byCoinKey = new Map<string, Instrument>();
  for (const instrument of instruments) {
    byId[instrument.id] = instrument;
    byCoinKey.set(instrument.coinKey, instrument);
  }
  return { ...indexed, instruments, byId, byCoinKey };
}

/** Full instrument catalog + 24h snapshot quotes, refreshed periodically. */
export function useMarkets() {
  const select = useCallback((data: MarketsData) => withOutcomeVisibility(data, false), []);
  return useQuery({
    queryKey: queryKeys.instruments(),
    queryFn: loadAllMarkets,
    staleTime: 20_000,
    // Live last-prices arrive over the websocket; this 24h snapshot only needs an
    // occasional refresh, and not at all while the app is backgrounded.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    // Repair the rehydrated `byCoinKey` Map (see {@link withCoinKeyIndex}).
    select,
  });
}

/** Full shared catalog for legacy outcome deep links and alert evaluation. */
export function useAllMarkets() {
  return useQuery({
    queryKey: queryKeys.instruments(),
    queryFn: loadAllMarkets,
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    select: withCoinKeyIndex,
  });
}

/** Outcome-only contracts and grouped events, backed by the same persisted query. */
export function useOutcomeMarkets() {
  const enabled = usePreferences((state) => state.showOutcomeMarkets);
  return useQuery({
    queryKey: queryKeys.instruments(),
    queryFn: loadAllMarkets,
    enabled,
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    select: (data: MarketsData): MarketsData => {
      const indexed = withCoinKeyIndex(data);
      const instruments = indexed.instruments.filter(
        (instrument) => instrument.assetClass === 'outcome',
      );
      const byId: Record<string, Instrument> = {};
      const byCoinKey = new Map<string, Instrument>();
      for (const instrument of instruments) {
        byId[instrument.id] = instrument;
        byCoinKey.set(instrument.coinKey, instrument);
      }
      return { ...indexed, instruments, byId, byCoinKey };
    },
  });
}

/** Resolve a set of instrument ids to instruments, preserving order. */
export function useInstrumentsByIds(ids: string[]) {
  const { data } = useMarkets();
  return useMemo(() => {
    if (!data) return [];
    return ids.map((id) => data.byId[id]).filter((i): i is Instrument => i !== undefined);
  }, [data, ids]);
}
