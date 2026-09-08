import { useQuery } from '@tanstack/react-query';

import { useTradingAddress } from '@/data/useHlAccount';
import {
  fetchFundingHistory,
  fetchUserBorrowLendInterest,
  fetchUserFundingHistory,
  fetchHlAccountActivity,
  type HlBorrowLendInterest,
  type HlFundingPoint,
  type HlUserFunding,
  type HlAccountActivity,
} from '@/lib/hyperliquid/info';
import { queryKeys } from '@/lib/queryKeys';
import { useHlConnection } from '@/store/hlConnection';

export function useHlAccountActivity(enabled = true) {
  const network = useHlConnection((state) => state.network);
  const { data: account } = useTradingAddress();
  return useQuery<HlAccountActivity>({
    queryKey: queryKeys.hlAccountActivity(network, account ?? ''),
    queryFn: () => fetchHlAccountActivity(account as string, network), enabled: enabled && !!account,
    staleTime: 60_000, refetchOnWindowFocus: true,
  });
}

/** Hourly market funding data changes once per hour, so a five-minute cache is ample. */
export function useHlFundingHistory(coin: string | undefined, enabled = true) {
  const network = useHlConnection((state) => state.network);
  return useQuery<HlFundingPoint[]>({
    queryKey: queryKeys.hlFundingHistory(network, coin ?? ''),
    queryFn: () => fetchFundingHistory(coin as string, network),
    enabled: enabled && !!coin,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}

/** Recent funding payments for the resolved master/sub-account. */
export function useHlUserFunding(enabled = true) {
  const network = useHlConnection((state) => state.network);
  const { data: account } = useTradingAddress();
  return useQuery<HlUserFunding[]>({
    queryKey: queryKeys.hlUserFunding(network, account ?? ''),
    queryFn: () => fetchUserFundingHistory(account as string, network),
    enabled: enabled && !!account,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Hourly paid/earned portfolio-margin interest for the resolved account. */
export function useHlBorrowLendInterest(enabled = true) {
  const network = useHlConnection((state) => state.network);
  const { data: account } = useTradingAddress();
  return useQuery<HlBorrowLendInterest[]>({
    queryKey: queryKeys.hlBorrowLendInterest(network, account ?? ''),
    queryFn: () => fetchUserBorrowLendInterest(account as string, network),
    enabled: enabled && !!account,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
