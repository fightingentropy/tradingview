import { useQuery } from '@tanstack/react-query';

import { fetchOrderBook, type HlOrderBook } from '@/lib/hyperliquid/info';
import { useHlConnection } from '@/store/hlConnection';

/** Fresh L2 depth for execution previews. Polling keeps the ticket useful even if WS reconnects. */
export function useOrderBook(coin: string | undefined) {
  const network = useHlConnection((state) => state.network);
  return useQuery<HlOrderBook>({
    queryKey: ['hl', 'l2Book', network, coin ?? ''],
    queryFn: () => fetchOrderBook(coin as string, network),
    enabled: !!coin,
    refetchInterval: 2_000,
    staleTime: 1_000,
    refetchOnWindowFocus: true,
  });
}
