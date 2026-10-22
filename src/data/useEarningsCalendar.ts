import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { loadEarningsCalendar } from '@/providers/earningsCalendar/client';

export function useEarningsCalendar(fromDateKey: string, toDateKey: string, includesToday: boolean) {
  return useQuery({
    queryKey: queryKeys.earningsCalendar(fromDateKey, toDateKey),
    queryFn: () => loadEarningsCalendar(fromDateKey, toDateKey),
    staleTime: includesToday ? 60_000 : 10 * 60_000,
    refetchInterval: includesToday ? 120_000 : false,
    refetchIntervalInBackground: false,
  });
}
