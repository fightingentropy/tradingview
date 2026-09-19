import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import {
  fetchHistoricalOrders,
  fetchHlAccount,
  fetchHlAccountOverview,
  fetchHlAccountFees,
  fetchHlEarnBalance,
  fetchHlPortfolio,
  fetchLegalCheck,
  fetchOpenOrders,
  fetchUserFills,
  type HlAccount,
  type HlAccountFees,
  type HlEarnBalance,
  type HlFill,
  type HlHistoricalOrder,
  type HlLegalCheck,
  type HlOpenOrder,
  type HlPortfolio,
} from '@/lib/hyperliquid/info';
import {
  resolveTradingIdentity,
  type TradingIdentity,
} from '@/lib/hyperliquid/tradingIdentity';
import { queryKeys } from '@/lib/queryKeys';
import { useHlConnection } from '@/store/hlConnection';
import type { HlAccountMode } from '@/lib/accountRisk';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

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
 * Hyperliquid's current terms/user/region decision. With no connected account,
 * the zero address still returns the IP-level restriction used by the official
 * frontend. Signed callers must fetch it again during their final preflight.
 */
export function useHlLegalCheck() {
  const address = useHlConnection((s) => s.address);
  const network = useHlConnection((s) => s.network);
  const { data: accountAddress } = useTradingAddress();
  const user = accountAddress ?? address?.trim().toLowerCase() ?? ZERO_ADDRESS;

  return useQuery<HlLegalCheck>({
    queryKey: queryKeys.hlLegalCheck(network, user),
    queryFn: () => fetchLegalCheck(user, network),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

/**
 * Live Hyperliquid account state for the resolved master account. Read-only (the
 * address is public), refreshed every few seconds so marks + unrealized PnL stay
 * current.
 */
export function useHlAccount(enabled = true) {
  const focused = useIsFocused();
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();

  return useQuery<HlAccount>({
    queryKey: queryKeys.hlAccount(network, account ?? ''),
    // Guarded value rather than a non-null assertion: the query is enabled-gated on
    // `account`, but resolve the address inside the closure so TS stays sound.
    queryFn: () => fetchHlAccount(account as string, network),
    enabled: enabled && focused && !!account,
    refetchInterval: 5_000,
    staleTime: 4_000,
  });
}

/** Includes all perp DEXs, independently of the markets offered by the app. */
export function useHlAccountOverview(mode: HlAccountMode, enabled = true) {
  const focused = useIsFocused();
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();
  return useQuery({
    queryKey: queryKeys.hlAccountOverview(network, account ?? '', mode),
    queryFn: () => fetchHlAccountOverview(account as string, mode, network),
    enabled: enabled && focused && !!account,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

/** Resting (pending) orders for the resolved master account. Read-only. */
export function useHlOpenOrders(enabled = true) {
  const focused = useIsFocused();
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();

  return useQuery<HlOpenOrder[]>({
    queryKey: queryKeys.hlOpenOrders(network, account ?? ''),
    queryFn: () => fetchOpenOrders(account as string, network),
    enabled: enabled && focused && !!account,
    refetchInterval: 8_000,
    staleTime: 6_000,
  });
}

/** Recent final order states for the resolved master account. Read-only. */
export function useHlHistoricalOrders(enabled = true) {
  const focused = useIsFocused();
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();

  return useQuery<HlHistoricalOrder[]>({
    queryKey: queryKeys.hlHistoricalOrders(network, account ?? ''),
    queryFn: () => fetchHistoricalOrders(account as string, network),
    enabled: focused && enabled && !!account,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

/**
 * Portfolio value + PnL history for the resolved master account. The series updates
 * slowly, so it polls on a lazy 60s cadence. Read-only.
 */
export function useHlPortfolio(enabled = true) {
  const focused = useIsFocused();
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();

  return useQuery<HlPortfolio>({
    queryKey: queryKeys.hlPortfolio(network, account ?? ''),
    queryFn: () => fetchHlPortfolio(account as string, network),
    enabled: enabled && focused && !!account,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
}

export function useHlAccountFees(enabled = true) {
  const focused = useIsFocused();
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();
  return useQuery<HlAccountFees>({
    queryKey: queryKeys.hlAccountFees(network, account ?? ''),
    queryFn: () => fetchHlAccountFees(account as string, network), enabled: enabled && focused && !!account,
    staleTime: 5 * 60_000, refetchOnWindowFocus: true,
  });
}

export function useHlEarnBalance(enabled = true) {
  const focused = useIsFocused();
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();
  return useQuery<HlEarnBalance>({
    queryKey: queryKeys.hlEarnBalance(network, account ?? ''),
    queryFn: () => fetchHlEarnBalance(account as string, network), enabled: enabled && focused && !!account,
    staleTime: 30_000, refetchInterval: 60_000,
  });
}

/** Recent fills (trade history) for the resolved master account. Read-only. */
export function useHlFills(enabled = true) {
  const focused = useIsFocused();
  const network = useHlConnection((s) => s.network);
  const { data: account } = useTradingAddress();

  return useQuery<HlFill[]>({
    queryKey: queryKeys.hlFills(network, account ?? ''),
    queryFn: () => fetchUserFills(account as string, network),
    enabled: enabled && focused && !!account,
    refetchInterval: 20_000,
    staleTime: 15_000,
  });
}
