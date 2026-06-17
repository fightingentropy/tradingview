import { useQuery } from '@tanstack/react-query';

import { fetchHlMeta, type HlAssetMeta } from '@/lib/hyperliquid/info';
import { queryKeys } from '@/lib/queryKeys';
import { useHlConnection } from '@/store/hlConnection';

/**
 * Perp universe metadata (asset index + size decimals + max leverage), keyed by
 * coin. Needed to build order actions. Changes rarely, so it's cached for an hour.
 */
export function useHlMeta() {
  const network = useHlConnection((s) => s.network);

  return useQuery<Record<string, HlAssetMeta>>({
    queryKey: queryKeys.hlMeta(network),
    queryFn: () => fetchHlMeta(network),
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });
}
