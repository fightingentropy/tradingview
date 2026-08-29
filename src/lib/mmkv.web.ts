type WebKeyValueStore = {
  set: (name: string, value: string) => void;
  getString: (name: string) => string | undefined;
  remove: (name: string) => void;
};

const memoryFallback = new Map<string, string>();

function browserStorage(): Storage | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Browser counterpart to the native MMKV store. */
export const storage: WebKeyValueStore = {
  set(name, value) {
    memoryFallback.set(name, value);
    try {
      browserStorage()?.setItem(name, value);
    } catch {
      // Private browsing and strict storage policies can reject writes.
    }
  },
  getString(name) {
    try {
      return browserStorage()?.getItem(name) ?? memoryFallback.get(name);
    } catch {
      return memoryFallback.get(name);
    }
  },
  remove(name) {
    memoryFallback.delete(name);
    try {
      browserStorage()?.removeItem(name);
    } catch {
      // The in-memory copy is still cleared.
    }
  },
};

export const mmkvStorage = {
  setItem: (name: string, value: string) => storage.set(name, value),
  getItem: (name: string): string | null => storage.getString(name) ?? null,
  removeItem: (name: string) => storage.remove(name),
};
