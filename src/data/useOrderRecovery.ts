import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { fetchOrderStatus, type HlNetwork } from '@/lib/hyperliquid/info';
import { queryKeys } from '@/lib/queryKeys';
import { recoveryComplete } from '@/lib/orderRecovery';
import { orderRecovery, withOrderRecoveryLock } from '@/store/orderRecovery';

export function useOrderRecovery(network: HlNetwork, address: string | undefined) {
  const snapshot = useSyncExternalStore(orderRecovery.subscribe, orderRecovery.getSnapshot, orderRecovery.getSnapshot);
  const attempts = snapshot.attempts.filter((a) => a.network === network && a.accountAddress.toLowerCase() === address?.toLowerCase());
  const unresolved = attempts.some((a) => !recoveryComplete(a));
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['order-recovery', network, address, attempts.map((a) => a.id).join(',')],
    enabled: !!address && unresolved && !snapshot.storageError,
    queryFn: async () => {
      await withOrderRecoveryLock(() => orderRecovery.reconcile(network, address!, (a, id) => fetchOrderStatus(a.accountAddress, id, a.network)));
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() }),
        qc.invalidateQueries({ queryKey: queryKeys.hlOpenOrdersPrefix() }),
        qc.invalidateQueries({ queryKey: queryKeys.hlFillsPrefix() }),
        qc.invalidateQueries({ queryKey: ['hl-historical-orders'] }),
        qc.invalidateQueries({ queryKey: ['hl', 'activeAsset'] }),
      ]);
      return Date.now();
    },
    retry: false,
    refetchInterval: unresolved ? 5_000 : false,
    refetchOnWindowFocus: true,
  });
  return { attempts, storageError: snapshot.storageError, blocked: !!snapshot.storageError || attempts.length > 0, ...query };
}
