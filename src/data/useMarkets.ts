import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { Instrument, Quote } from '@/domain/types';
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
}

export async function loadAllMarkets(): Promise<MarketsData> {
  const results = await Promise.allSettled(allProviders().map((p) => p.loadMarkets()));

  const instruments: Instrument[] = [];
  const quotes: Record<string, Quote> = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      instruments.push(...r.value.instruments);
      Object.assign(quotes, r.value.quotes);
    }
  }
  const byId: Record<string, Instrument> = {};
  const byCoinKey = new Map<string, Instrument>();
  for (const i of instruments) {
    byId[i.id] = i;
    byCoinKey.set(i.coinKey, i);
  }
  return { instruments, byId, byCoinKey, quotes };
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

/** Hide outcome rows centrally while preserving the full cached catalog and saved ids. */
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
  const showOutcomeMarkets = usePreferences((state) => state.showOutcomeMarkets);
  const select = useCallback(
    (data: MarketsData) => withOutcomeVisibility(data, showOutcomeMarkets),
    [showOutcomeMarkets],
  );
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

/** Resolve a set of instrument ids to instruments, preserving order. */
export function useInstrumentsByIds(ids: string[]) {
  const { data } = useMarkets();
  return useMemo(() => {
    if (!data) return [];
    return ids.map((id) => data.byId[id]).filter((i): i is Instrument => i !== undefined);
  }, [data, ids]);
}
