import { useQuery } from '@tanstack/react-query';

import { economicCalendarDateKey } from '@/domain/economicCalendar';
import { queryKeys } from '@/lib/queryKeys';
import {
  loadEconomicCalendar,
  loadEconomicCalendarRange,
} from '@/providers/economicCalendar/client';

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

export function useEconomicCalendarRange(fromDateKey: string, toDateKey: string) {
  const today = economicCalendarDateKey(new Date());
  const includesToday = fromDateKey <= today && today <= toDateKey;
  return useQuery({
    queryKey: queryKeys.economicCalendarRange(fromDateKey, toDateKey),
    queryFn: () => loadEconomicCalendarRange(fromDateKey, toDateKey),
    staleTime: includesToday ? 30_000 : 5 * 60_000,
    refetchInterval: includesToday ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
}
