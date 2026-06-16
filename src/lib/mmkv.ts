import { createMMKV } from 'react-native-mmkv';

/** Single synchronous key-value store. Backs the watchlist + settings stores. */
export const storage = createMMKV({ id: 'tradingview' });

/** Zustand persist adapter backed by MMKV (synchronous, instant cold-start reads). */
export const mmkvStorage = {
  setItem: (name: string, value: string) => {
    storage.set(name, value);
  },
  getItem: (name: string): string | null => {
    return storage.getString(name) ?? null;
  },
  removeItem: (name: string) => {
    storage.remove(name);
  },
};
