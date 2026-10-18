import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
  ACTIVE_BRIEF_RUN,
  loadBriefRunStatus,
  startBriefRun,
  type BriefRunState,
} from '@/providers/briefs/client';

const runKey = ['daily-brief', 'run'] as const;

/** Tracks an on-demand brief run, polling while it is active, and refreshes the reader when it completes. */
export function useBriefRun(onComplete: () => void) {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: runKey,
    queryFn: loadBriefRunStatus,
    staleTime: 10_000,
    refetchInterval: (query) => ACTIVE_BRIEF_RUN.has(query.state.data?.status ?? '') ? 15_000 : false,
  });
  const start = useMutation({
    mutationFn: startBriefRun,
    onSuccess: (run: BriefRunState) => client.setQueryData(runKey, run),
  });
  const previous = useRef<string>(undefined);
  const current = status.data?.status;
  useEffect(() => {
    if (ACTIVE_BRIEF_RUN.has(previous.current ?? '') && current === 'complete') onComplete();
    previous.current = current;
  }, [current, onComplete]);

  return {
    run: status.data,
    active: start.isPending || ACTIVE_BRIEF_RUN.has(current ?? ''),
    error: start.error instanceof Error ? start.error.message : undefined,
    start: () => start.mutate(),
  };
}
