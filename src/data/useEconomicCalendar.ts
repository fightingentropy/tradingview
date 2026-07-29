import { useQuery } from '@tanstack/react-query';

import { economicCalendarDateKey } from '@/domain/economicCalendar';
import { queryKeys } from '@/lib/queryKeys';
import { loadEconomicCalendar } from '@/providers/economicCalendar/client';

export function useEconomicCalendar(dateKey: string) {
  const today = economicCalendarDateKey(new Date());
  return useQuery({
    queryKey: queryKeys.economicCalendar(dateKey),
    queryFn: () => loadEconomicCalendar(dateKey),
    staleTime: dateKey === today ? 30_000 : 5 * 60_000,
    refetchInterval: dateKey === today ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
}
