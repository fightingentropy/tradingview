import { dehydrate, type Query, type QueryClient } from '@tanstack/react-query';
import type { Persister } from '@tanstack/react-query-persist-client';

export const QUERY_CACHE_BUSTER = '4';
const LIMITS: Record<string, number> = {
  instruments: 1,
  candles: 8,
  'economic-calendar': 2,
  'economic-calendar-range': 2,
  'daily-brief': 2,
};

export const isPersistableQuery = (query: Query) =>
  Object.hasOwn(LIMITS, String(query.queryKey[0]));

/** Keep recent public data for cold starts; never persist account/auth/news data. */
export function publicCacheSnapshot(client: QueryClient) {
  const counts = new Map<string, number>();
  const selected = new Set(client.getQueryCache().getAll()
    .filter(query => isPersistableQuery(query) && query.state.status === 'success')
    .sort((a, b) => Number(b.isActive()) - Number(a.isActive()) || b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    .filter(query => {
      const group = String(query.queryKey[0]);
      const count = (counts.get(group) ?? 0) + 1;
      counts.set(group, count);
      return count <= LIMITS[group];
    }).map(query => query.queryHash));
  const snapshot = dehydrate(client, {
    shouldDehydrateQuery: query => selected.has(query.queryHash),
    shouldDehydrateMutation: () => false,
  });
  for (const query of snapshot.queries) {
    if (query.queryKey[0] === 'candles' && Array.isArray(query.state.data)) {
      query.state = { ...query.state, data: query.state.data.slice(-2_000) };
    }
  }
  return snapshot;
}

/** Throttle before dehydration/JSON work, rather than only delaying the disk write. */
export function createQueryCheckpoint(client: QueryClient, persister: Persister, intervalMs = 15_000) {
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    try {
      void Promise.resolve(persister.persistClient({ timestamp: Date.now(), buster: QUERY_CACHE_BUSTER,
        clientState: publicCacheSnapshot(client) })).catch(() => { dirty = true; });
    } catch { dirty = true; }
  };
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (!['added', 'removed', 'updated'].includes(event.type) || !isPersistableQuery(event.query)) return;
    dirty = true;
    timer ??= setTimeout(flush, intervalMs);
  });
  return { flush, dispose: () => { unsubscribe(); flush(); clearTimeout(timer); } };
}
