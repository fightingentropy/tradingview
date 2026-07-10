/**
 * Storage for the Hyperliquid API-wallet ("agent") private key — the secret that
 * signs orders. It can trade but cannot withdraw.
 *
 * Backed by the iOS Keychain via expo-secure-store, using the synchronous
 * getItem/setItem API so the rest of the app can read the key without going async.
 * Stored with WHEN_UNLOCKED_THIS_DEVICE_ONLY: available only while the device is
 * unlocked and never synced to iCloud Keychain. Never logged.
 *
 * The module is loaded through a guarded require: a *static* import would crash
 * the whole JS bundle on a dev client that predates this native dependency
 * (`requireNativeModule('ExpoSecureStore')` throws at module load, before any
 * try/catch around the calls). When the native module is absent (e.g. an older
 * simulator dev client) we degrade to an in-memory fallback instead.
 */
import type * as SecureStoreModule from 'expo-secure-store';

let SecureStore: typeof SecureStoreModule | null = null;
try {
  // Deliberately guarded: older dev clients may not contain the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SecureStore = require('expo-secure-store') as typeof SecureStoreModule;
} catch {
  SecureStore = null;
}

const KEY = 'agentPrivateKey';

function options(): SecureStoreModule.SecureStoreOptions | undefined {
  return SecureStore
    ? { keychainService: 'tv-hl-secure', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    : undefined;
}

let memoryFallback: string | null = null;

/** Normalize to a 0x-prefixed lowercase hex string. */
export function normalizeKey(raw: string): string {
  const k = raw.trim();
  return k.startsWith('0x') || k.startsWith('0X') ? '0x' + k.slice(2).toLowerCase() : '0x' + k.toLowerCase();
}

/** A 32-byte hex private key (with or without 0x prefix). */
export function isValidPrivateKey(raw: string): boolean {
  return /^0x[0-9a-f]{64}$/.test(normalizeKey(raw));
}

export function setAgentKey(privateKey: string) {
  const k = normalizeKey(privateKey);
  if (SecureStore) {
    try {
      SecureStore.setItem(KEY, k, options());
      memoryFallback = null;
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memoryFallback = k;
}

export function getAgentKey(): string | null {
  if (SecureStore) {
    try {
      return SecureStore.getItem(KEY, options()) ?? memoryFallback;
    } catch {
      /* fall through to memory */
    }
  }
  return memoryFallback;
}

export function clearAgentKey() {
  memoryFallback = null;
  if (SecureStore) {
    try {
      // No synchronous delete is exposed; fire-and-forget the async removal.
      SecureStore.deleteItemAsync(KEY, options()).catch(() => {});
    } catch {
      /* native module absent — memory fallback already cleared */
    }
  }
}

export function hasAgentKey(): boolean {
  return !!getAgentKey();
}
