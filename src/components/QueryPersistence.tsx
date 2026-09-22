import { IsRestoringProvider } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { PERSIST_MAX_AGE, queryClient, queryPersister } from '@/lib/queryClient';
import { createQueryCheckpoint, QUERY_CACHE_BUSTER } from '@/lib/queryPersistence';

export function QueryPersistence({ children }: { children: ReactNode }) {
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    let disposed = false;
    let checkpoint: ReturnType<typeof createQueryCheckpoint> | undefined;
    let appState: ReturnType<typeof AppState.addEventListener> | undefined;
    void persistQueryClientRestore({ queryClient, persister: queryPersister,
      maxAge: PERSIST_MAX_AGE, buster: QUERY_CACHE_BUSTER }).catch(() => undefined).then(() => {
      if (disposed) return;
      checkpoint = createQueryCheckpoint(queryClient, queryPersister);
      appState = AppState.addEventListener('change', state => {
        if (state !== 'active') checkpoint?.flush();
      });
      setRestoring(false);
    });
    return () => { disposed = true; appState?.remove(); checkpoint?.dispose(); };
  }, []);
  return <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>;
}
