/** Storage boundary kept independent of native modules for failure and race tests. */
export interface ApiKeyStorage {
  read: () => string | null;
  write: (key: string) => void;
  remove: () => Promise<void>;
}

export function normalizeKey(raw: string): string {
  const key = raw.trim();
  return `0x${key.replace(/^0x/i, '').toLowerCase()}`;
}

export function createApiKeyStore(storage: ApiKeyStorage | null) {
  let memory: string | null = null;
  let removal: Promise<void> | null = null;
  return {
    get(): string | null {
      // A signing request must not acquire a key while it is being removed.
      if (removal) return null;
      try { return storage?.read() ?? memory; } catch { return memory; }
    },
    set(raw: string, requirePersistence = false) {
      if (removal) throw new Error('Your account is disconnecting. Please try again in a moment.');
      const key = normalizeKey(raw);
      if (storage) {
        try { storage.write(key); memory = null; return; }
        catch {
          if (requirePersistence) throw new Error('Could not save your API key securely. Unlock your phone and try again.');
        }
      }
      if (requirePersistence) throw new Error('Secure storage is unavailable. Please update the app and try again.');
      memory = key;
    },
    clear(): Promise<void> {
      if (removal) return removal;
      removal = (async () => {
        try {
          await storage?.remove();
          if (storage) {
            // Some native keychains resolve even if removal did not take effect.
            if (storage.read() !== null) throw new Error('Key still present');
          }
          memory = null;
        } catch {
          throw new Error('Could not remove your saved API key. Unlock your phone and try again.');
        } finally {
          removal = null;
        }
      })();
      return removal;
    },
  };
}
