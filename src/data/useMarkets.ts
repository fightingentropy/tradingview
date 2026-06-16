import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Instrument, Quote } from '@/domain/types';
import { queryKeys } from '@/lib/queryKeys';
import { allProviders } from '@/providers/registry';

export interface MarketsData {
  instruments: Instrument[];
  byId: Map<string, Instrument>;
  quotes: Record<string, Quote>;
}

async function loadAllMarkets(): Promise<MarketsData> {
  const results = await Promise.allSettled(allProviders().map((p) => p.loadMarkets()));

  const instruments: Instrument[] = [];
  const quotes: Record<string, Quote> = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      instruments.push(...r.value.instruments);
      Object.assign(quotes, r.value.quotes);
    }
  }
  const byId = new Map(instruments.map((i) => [i.id, i]));
  return { instruments, byId, quotes };
}

/** Full instrument catalog + 24h snapshot quotes, refreshed periodically. */
export function useMarkets() {
  return useQuery({
    queryKey: queryKeys.instruments(),
    queryFn: loadAllMarkets,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

/** Resolve a set of instrument ids to instruments, preserving order. */
export function useInstrumentsByIds(ids: string[]) {
  const { data } = useMarkets();
  return useMemo(() => {
    if (!data) return [];
    return ids.map((id) => data.byId.get(id)).filter((i): i is Instrument => i !== undefined);
  }, [data, ids]);
}
