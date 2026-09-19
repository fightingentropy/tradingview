import { create } from 'zustand';
import type { TradeReceipt } from '@/lib/tradeReceipt';

let nextId = 0;
export const useTradeFeedback = create<{
  receipt: (TradeReceipt & { id: number }) | null;
  show: (receipt: TradeReceipt) => void;
  dismiss: (id: number) => void;
}>((set) => ({
  receipt: null,
  show: (receipt) => set({ receipt: { ...receipt, id: ++nextId } }),
  dismiss: (id) => set((state) => state.receipt?.id === id ? { receipt: null } : state),
}));
