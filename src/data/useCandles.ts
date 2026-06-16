import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { Candle, CandleInterval, Instrument } from '@/domain/types';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { getProvider } from '@/providers/registry';

/** Historical candles seeded from REST and kept live via the websocket candle feed. */
export function useCandles(instrument: Instrument | undefined, interval: CandleInterval) {
  const provider = instrument ? getProvider(instrument.source) : undefined;

  const query = useQuery<Candle[]>({
    queryKey: instrument ? queryKeys.candles(instrument.id, interval) : ['candles', 'none'],
    queryFn: () => provider!.getCandles(instrument!, interval),
    enabled: !!instrument && !!provider,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!instrument || !provider?.subscribeCandles) return;
    const key = queryKeys.candles(instrument.id, interval);
    const unsub = provider.subscribeCandles(instrument, interval, (c: Candle) => {
      queryClient.setQueryData<Candle[]>(key, (old) => {
        if (!old || old.length === 0) return old;
        const last = old[old.length - 1];
        if (c.t === last.t) {
          const next = old.slice();
          next[next.length - 1] = c;
          return next;
        }
        if (c.t > last.t) return [...old.slice(-499), c];
        return old;
      });
    });
    return unsub;
  }, [instrument, provider, interval]);

  return query;
}
