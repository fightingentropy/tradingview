import { useQuery } from '@tanstack/react-query';

import {
  fetchHlAccount,
  fetchHlPortfolio,
  fetchOpenOrders,
  fetchUserFills,
  type HlAccount,
  type HlFill,
  type HlOpenOrder,
  type HlPortfolio,
} from '@/lib/hyperliquid/info';
import {
  resolveTradingIdentity,
  type TradingIdentity,
} from '@/lib/hyperliquid/tradingIdentity';
import { queryKeys } from '@/lib/queryKeys';
import { useHlConnection } from '@/store/hlConnection';

function useTradingIdentityInputs() {
  const address = useHlConnection((s) => s.address);
  const network = useHlConnection((s) => s.network);
  const hasKey = useHlConnection((s) => s.hasKey);
  const keyRevision = useHlConnection((s) => s.keyRevision);
  const demo = useHlConnection((s) => s.demo);
  return { address, network, hasKey, keyRevision, demo };
}

/**
 * Authoritative account + signing identity. Resolution never falls back to a
 * typed address after an error: callers receive an error and trading stays off.
 */
export function useTradingIdentity() {
  const { address, network, hasKey, keyRevision, demo } = useTradingIdentityInputs();
  return useQuery<TradingIdentity>({
    queryKey: ['hl-trading-identity', network, address, hasKey, keyRevision, demo],
    queryFn: () => resolveTradingIdentity(address as string, network, hasKey && !demo),
    enabled: !!address,
    staleTime: Infinity,
    retry: 1,
  });
}

/**
 * The master account address we read for the current connection. Stable mapping,
 * so it's cached aggressively and only re-resolved when the inputs change. Returns
 * the full query result so callers can read `isError`/`isFetching` and react to a
 * failed/in-flight resolution rather than silently trusting the entered address.
 */
export function useTradingAddress() {
  const { address, network, hasKey, keyRevision, demo } = useTradingIdentityInputs();
  return useQuery<TradingIdentity, Error, string>({
    queryKey: ['hl-trading-identity', network, address, hasKey, keyRevision, demo],
    queryFn: () => resolveTradingIdentity(address as string, network, hasKey && !demo),
    enabled: !!address,
    staleTime: Infinity,
    retry: 1,
    select: (identity) => identity.accountAddress,
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
    queryKey: queryKeys.hlAccount(network, account ?? ''),
    // Guarded value rather than a non-null assertion: the query is enabled-gated on
    // `account`, but resolve the address inside the closure so TS stays sound.
    queryFn: () => fetchHlAccount(account as string, network),
    enabled: !!account,
    refetchInterval: 5_000,
    staleTime: 4_000,
  });
}

/** Resting (pending) orders for the resolved master account. Read-only. */
export function useHlOpenOrders() {
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();

  return useQuery<HlOpenOrder[]>({
    queryKey: queryKeys.hlOpenOrders(network, account ?? ''),
    queryFn: () => fetchOpenOrders(account as string, network),
    enabled: !!account,
    refetchInterval: 8_000,
    staleTime: 6_000,
  });
}

/**
 * Portfolio value + PnL history for the resolved master account. The series updates
 * slowly, so it polls on a lazy 60s cadence. Read-only.
 */
export function useHlPortfolio() {
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();

  return useQuery<HlPortfolio>({
    queryKey: queryKeys.hlPortfolio(network, account ?? ''),
    queryFn: () => fetchHlPortfolio(account as string, network),
    enabled: !!account,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
}

/** Recent fills (trade history) for the resolved master account. Read-only. */
export function useHlFills() {
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();

  return useQuery<HlFill[]>({
    queryKey: queryKeys.hlFills(network, account ?? ''),
    queryFn: () => fetchUserFills(account as string, network),
    enabled: !!account,
    refetchInterval: 20_000,
    staleTime: 15_000,
  });
}
