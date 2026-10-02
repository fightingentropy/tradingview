import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { queryClient, queryPersister } from '@/lib/queryClient';
import { createQueryCheckpoint } from '@/lib/queryPersistence';

export function QueryPersistence({ children }: { children: ReactNode }) {
  useEffect(() => {
    const checkpoint = createQueryCheckpoint(queryClient, queryPersister);
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') checkpoint.flush();
    });
    return () => { appState.remove(); checkpoint.dispose(); };
  }, []);
  return children;
}
