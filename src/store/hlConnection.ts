import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { HlNetwork } from '@/lib/hyperliquid/info';
import { clearAgentKey, hasAgentKey } from '@/lib/hyperliquid/keyStore';
import { mmkvStorage } from '@/lib/mmkv';

/**
 * The connected Hyperliquid account. `address` is the public master account used
 * for read-only views; the order-signing key lives in the encrypted keyStore (the
 * `hasKey` flag just mirrors its presence for the UI). Trading is enabled once
 * both an address and a key are present.
 */
interface HlConnectionState {
  address: string | null;
  network: HlNetwork;
  hasKey: boolean;
  /** True for the read-only demo account (disables anything that would trade). */
  demo: boolean;
  setAddress: (address: string | null) => void;
  setNetwork: (network: HlNetwork) => void;
  /** Reflect the keyStore state after saving/removing a key. */
  refreshKey: () => void;
  connectDemo: (address: string) => void;
  disconnect: () => void;
}

/** Public address with open positions, for previewing the screen before connecting. */
export const DEMO_ADDRESS = '0xf5d81a135f756ca16544e53c20fc20643ec3ad53';

const isHexAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

export const useHlConnection = create<HlConnectionState>()(
  persist(
    (set) => ({
      address: null,
      network: 'mainnet',
      hasKey: false,
      demo: false,
      setAddress: (address) =>
        set({ address: address && isHexAddress(address) ? address.trim() : address, demo: false }),
      setNetwork: (network) => set({ network }),
      refreshKey: () => set({ hasKey: hasAgentKey() }),
      connectDemo: (address) => set({ address, demo: true, hasKey: false }),
      disconnect: () => {
        clearAgentKey();
        set({ address: null, hasKey: false, demo: false });
      },
    }),
    {
      name: 'hl-connection-v1',
      storage: createJSONStorage(() => mmkvStorage),
      // Don't trust a persisted hasKey across reinstalls — re-derive from the keystore.
      partialize: (s) => ({ address: s.address, network: s.network, demo: s.demo }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hasKey = hasAgentKey();
      },
    },
  ),
);

export { isHexAddress };
