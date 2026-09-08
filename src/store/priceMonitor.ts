import { create } from 'zustand';
import type { PriceAlertSyncResult } from '@/domain/priceAlerts';

export const usePriceMonitor = create<{
  result: PriceAlertSyncResult | null;
  error: string | null;
  syncing: boolean;
  syncedRules: string | null;
  sources: string[];
  checkedAt: number;
}>(() => ({ result: null, error: null, syncing: false, syncedRules: null, sources: [], checkedAt: 0 }));
