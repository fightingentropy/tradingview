import { create } from 'zustand';

/** A transient in-app banner shown when a price alert fires. Not persisted. */
export interface AlertToast {
  /** Mirrors the alert id so repeated fires de-dupe. */
  id: string;
  instrumentId: string;
  symbol: string;
  message: string;
  changePct: number;
}

interface AlertFeedState {
  toasts: AlertToast[];
  push: (t: AlertToast) => void;
  dismiss: (id: string) => void;
}

export const useAlertFeed = create<AlertFeedState>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== t.id), t] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
