import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';

import { loadBriefEdition, loadBriefIndex } from '@/providers/briefs/client';

export function useDailyBrief() {
  const focused = useIsFocused();
  const [now, setNow] = useState(() => new Date());
  const index = useQuery({
    queryKey: ['daily-brief', 'index'],
    queryFn: ({ signal }) => loadBriefIndex(signal),
    enabled: focused,
    staleTime: 60_000,
    refetchInterval: focused ? 5 * 60_000 : false,
  });
  const entry = index.data?.editions[0];
  const edition = useQuery({
    queryKey: ['daily-brief', 'edition', entry?.id, entry?.title, entry?.generated],
    queryFn: ({ signal }) => {
      if (!entry) throw new Error('No published edition is available.');
      return loadBriefEdition(entry, signal);
    },
    enabled: focused && Boolean(entry),
    staleTime: Infinity,
  });

  const { refetch: refreshIndex } = index;
  const { refetch: refreshEdition } = edition;
  const refresh = useCallback(async () => {
    setNow(new Date());
    await Promise.all([refreshIndex(), ...(entry ? [refreshEdition()] : [])]);
  }, [entry, refreshEdition, refreshIndex]);
  useFocusEffect(useCallback(() => {
    setNow(new Date());
    void refreshIndex();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') { setNow(new Date()); void refreshIndex(); }
    });
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => { subscription.remove(); clearInterval(clock); };
  }, [refreshIndex]));

  return {
    brief: edition.data,
    loading: index.isPending || (Boolean(entry) && edition.isPending),
    refreshing: index.isRefetching || edition.isRefetching,
    error: index.error ?? edition.error,
    refresh,
    now,
  };
}
