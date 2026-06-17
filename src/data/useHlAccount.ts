import { useQuery } from '@tanstack/react-query';

import { fetchHlAccount, fetchUserRole, type HlAccount, type HlNetwork } from '@/lib/hyperliquid/info';
import { getAgentKey } from '@/lib/hyperliquid/keyStore';
import { addressFromPrivateKey } from '@/lib/hyperliquid/sign';
import { useHlConnection } from '@/store/hlConnection';

/**
 * Resolve the address whose positions/balances we should read.
 *
 * Hyperliquid orders are signed by an API-wallet ("agent") key but the resulting
 * position lives under the agent's **master account**, not the agent address — so
 * reading the agent (or a mistyped) address returns an empty account. We resolve
 * the authoritative account by asking `userRole`: prefer the master behind the
 * key's own agent address, then fall back to the entered address.
 */
async function resolveTradingAddress(entered: string | null, network: HlNetwork): Promise<string | null> {
  const candidates: string[] = [];
  const key = getAgentKey();
  if (key) {
    try {
      candidates.push(addressFromPrivateKey(key));
    } catch {
      /* unreadable key — ignore */
    }
  }
  if (entered) candidates.push(entered);

  for (const addr of candidates) {
    try {
      const role = await fetchUserRole(addr, network);
      if (role.role === 'agent' && role.data?.user) return role.data.user; // swap agent → master
      if (role.role === 'user' || role.role === 'subAccount' || role.role === 'vault') return addr;
      // 'missing' / unknown → try the next candidate
    } catch {
      /* network hiccup — try the next candidate */
    }
  }
  return entered ?? candidates[0] ?? null;
}

/**
 * The master account address we read for the current connection. Stable mapping,
 * so it's cached aggressively and only re-resolved when the inputs change.
 */
export function useTradingAddress() {
  const address = useHlConnection((s) => s.address);
  const network = useHlConnection((s) => s.network);
  const hasKey = useHlConnection((s) => s.hasKey);

  return useQuery<string | null>({
    queryKey: ['hl-trading-address', network, address, hasKey],
    queryFn: () => resolveTradingAddress(address, network),
    enabled: !!address,
    staleTime: Infinity,
  });
}

/**
 * Live Hyperliquid account state for the resolved master account. Read-only (the
 * address is public), refreshed every few seconds so marks + unrealized PnL stay
 * current.
 */
export function useHlAccount() {
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();

  return useQuery<HlAccount>({
    queryKey: ['hl-account', network, account],
    queryFn: () => fetchHlAccount(account!, network),
    enabled: !!account,
    refetchInterval: 5_000,
    staleTime: 4_000,
  });
}
