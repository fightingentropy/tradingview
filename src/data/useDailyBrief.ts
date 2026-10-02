import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import type { DailyBrief } from '@tradingview/shared/brief';

import { loadLatestBrief } from '@/providers/briefs/client';

const latestKey = ['daily-brief', 'latest'] as const;

export function useDailyBrief() {
  const focused = useIsFocused();
  const client = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const edition = useQuery({
    queryKey: latestKey,
    queryFn: ({ signal }) => loadLatestBrief(client.getQueryData<DailyBrief>(latestKey), signal),
    // Reuse the previous cache format on the first launch after this update.
    initialData: () => client.getQueriesData<DailyBrief>({ queryKey: ['daily-brief', 'edition'] })
      .map(([, brief]) => brief).filter((brief): brief is DailyBrief => !!brief)
      .sort((a, b) => b.id.localeCompare(a.id))[0],
    initialDataUpdatedAt: 0,
    enabled: focused,
    staleTime: 60_000,
    refetchInterval: focused ? 5 * 60_000 : false,
  });
  const { refetch } = edition;
  const refresh = useCallback(async () => {
    setNow(new Date());
    await refetch();
  }, [refetch]);
  useFocusEffect(useCallback(() => {
    setNow(new Date());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => { subscription.remove(); clearInterval(clock); };
  }, []));

  return {
    brief: edition.data,
    loading: edition.isPending,
    refreshing: edition.isRefetching,
    error: edition.error,
    refresh,
    now,
  };
}
