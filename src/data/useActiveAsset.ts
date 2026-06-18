import { useQuery } from '@tanstack/react-query';

import { useTradingAddress } from '@/data/useHlAccount';
import { fetchActiveAssetData, type HlActiveAsset } from '@/lib/hyperliquid/info';
import { useHlConnection } from '@/store/hlConnection';

/**
 * Live per-asset trading context (leverage, margin mode, USDC buying power, max order
 * size) for the resolved trading account + a coin. Drives the order ticket's leverage
 * controls, the Margin Required / Available rows, and the size %. Read-only (public
 * address), refreshed a few times a minute. Disabled until an address resolves.
 */
export function useActiveAsset(coin: string | undefined) {
  const network = useHlConnection((s) => s.network);
  const { data: address } = useTradingAddress();

  return useQuery<HlActiveAsset>({
    queryKey: ['hl', 'activeAsset', network, address ?? '', coin ?? ''],
    queryFn: () => fetchActiveAssetData(address as string, coin as string, network),
    enabled: !!address && !!coin,
    refetchInterval: 12_000,
    staleTime: 8_000,
  });
}
