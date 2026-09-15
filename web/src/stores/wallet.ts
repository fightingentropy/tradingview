import { createMemo, createRoot, createSignal } from "solid-js";
import { api } from "../../convex/_generated/api";
import { convex, createConvexQuery } from "../lib/convex";
import { isAuthenticated } from "./auth";
import {
  hyperliquidSpotAvailableBalances,
  hyperliquidSpotBalances,
  hyperliquidSpotBorrowedBalances,
  hyperliquidSpotCollateralLtvs,
  isHyperliquidExecution,
  placeHyperliquidOrder,
} from "./hyperliquidExecution";

export type SpotAsset =
  | "USDC"
  | "USDT"
  | "BTC"
  | "ETH"
  | "SOL"
  | "HYPE"
  | "BNB"
  | "XRP"
  | "ADA"
  | "DOGE"
  | "AVAX"
  | "LINK"
  | "DOT"
  | "LTC"
  | "ATOM";

const SPOT_ASSETS: SpotAsset[] = [
  "USDC",
  "USDT",
  "BTC",
  "ETH",
  "SOL",
  "HYPE",
  "BNB",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "LINK",
  "DOT",
  "LTC",
  "ATOM",
];

// Hyperliquid's canonical token names for the wrapped spot markets differ
// from the familiar symbols used by the rest of the app and by the paper
// Convex ledger. Keep that translation at the live-execution boundary so the
// paper types and stored balances remain unchanged.
const HYPERLIQUID_SPOT_SYMBOL_BY_UI: Partial<Record<SpotAsset, string>> = {
  BTC: "UBTC",
  ETH: "UETH",
  SOL: "USOL",
};

const UI_SPOT_SYMBOL_BY_HYPERLIQUID: Record<string, SpotAsset> = {
  UBTC: "BTC",
  UETH: "ETH",
  USOL: "SOL",
};

const getHyperliquidSpotSymbol = (asset: SpotAsset) =>
  HYPERLIQUID_SPOT_SYMBOL_BY_UI[asset] ?? asset;

const getHyperliquidSpotBalance = (
  balances: Record<string, number>,
  asset: SpotAsset,
) => {
  const canonical = getHyperliquidSpotSymbol(asset);
  return balances[canonical] ?? balances[asset] ?? 0;
};

const {
  spotBalances,
  transferModalOpen,
  transferDirection,
  openTransferModal,
  closeTransferModal,
} = createRoot(() => {
  const balancesQuery = createConvexQuery(
    api.spot.listSpotBalances,
    () => {
      return isAuthenticated() ? {} : null;
    },
    [],
  );

  const spotBalances = createMemo<Record<SpotAsset, number>>(() => {
    const next = SPOT_ASSETS.reduce(
      (acc, asset) => ({ ...acc, [asset]: 0 }),
      {} as Record<SpotAsset, number>,
    );
    const balances = balancesQuery() ?? [];
    for (const balance of balances) {
      if (isSpotAsset(balance.asset)) {
        next[balance.asset] = balance.balance;
      }
    }
    return next;
  });

  // Transfer modal state
  const [transferModalOpen, setTransferModalOpen] = createSignal(false);
  const [transferDirection, setTransferDirection] = createSignal<
    "perpsToSpot" | "spotToPerps"
  >("perpsToSpot");

  const openTransferModal = (
    direction: "perpsToSpot" | "spotToPerps" = "perpsToSpot",
  ) => {
    setTransferDirection(direction);
    setTransferModalOpen(true);
  };

  const closeTransferModal = () => setTransferModalOpen(false);

  return {
    spotBalances,
    transferModalOpen,
    transferDirection,
    openTransferModal,
    closeTransferModal,
  };
});

export {
  transferModalOpen,
  transferDirection,
  openTransferModal,
  closeTransferModal,
};

export const getSpotBalance = (asset: SpotAsset) =>
  isHyperliquidExecution()
    ? getHyperliquidSpotBalance(hyperliquidSpotAvailableBalances(), asset)
    : (spotBalances()[asset] ?? 0);
export const getSpotTotalBalance = (asset: SpotAsset) =>
  isHyperliquidExecution()
    ? getHyperliquidSpotBalance(hyperliquidSpotBalances(), asset)
    : (spotBalances()[asset] ?? 0);
export const getSpotBorrowedBalance = (asset: SpotAsset) =>
  isHyperliquidExecution()
    ? getHyperliquidSpotBalance(hyperliquidSpotBorrowedBalances(), asset)
    : 0;
export const getSpotCollateralLtv = (asset: SpotAsset) => {
  if (!isHyperliquidExecution()) return undefined;
  const canonical = getHyperliquidSpotSymbol(asset);
  return (
    hyperliquidSpotCollateralLtvs()[canonical] ??
    hyperliquidSpotCollateralLtvs()[asset]
  );
};
export const getSpotBalances = () => {
  if (!isHyperliquidExecution()) return spotBalances();
  return SPOT_ASSETS.reduce(
    (balances, asset) => ({
      ...balances,
      [asset]: getHyperliquidSpotBalance(hyperliquidSpotBalances(), asset),
    }),
    {} as Record<SpotAsset, number>,
  );
};

export const isSpotAsset = (asset: string): asset is SpotAsset =>
  SPOT_ASSETS.includes(asset as SpotAsset);

export const resolveSpotAssetAlias = (asset: string): SpotAsset | null => {
  const normalized = String(asset ?? "")
    .trim()
    .toUpperCase();
  const pairBase =
    normalized === "USDC"
      ? normalized
      : normalized.replace(/[-/]USDC$/, "").replace(/USDC$/, "");
  const uiSymbol = UI_SPOT_SYMBOL_BY_HYPERLIQUID[pairBase] ?? pairBase;
  return isSpotAsset(uiSymbol) ? uiSymbol : null;
};

export const placeSpotOrder = async ({
  symbol,
  side,
  size,
  price,
  type = "market",
}: {
  symbol: SpotAsset;
  side: "buy" | "sell";
  size: number;
  price: number;
  type?: "market" | "limit";
}): Promise<{ ok: boolean; error?: string; message?: string }> => {
  if (isHyperliquidExecution()) {
    const hyperliquidSymbol = getHyperliquidSpotSymbol(symbol);
    return await placeHyperliquidOrder({
      symbol: `${hyperliquidSymbol}/USDC`,
      side,
      type,
      size,
      price: type === "limit" ? price : undefined,
      marketType: "spot",
      reduceOnly: false,
    });
  }
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to place orders." };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "Enter a valid size." };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Enter a valid price." };
  }
  // Warm up the server oracle for this symbol so the fill settles on a fresh
  // server price (the cron only polls already-held symbols). Best-effort and
  // cheap (no-op when already fresh).
  try {
    await convex.action(api.prices.ensureSymbolFresh, { symbol });
  } catch {
    // ignore; placeSpotOrder will fail closed if no fresh server price exists
  }
  try {
    await convex.mutation(api.spot.placeSpotOrder, {
      symbol,
      side,
      size,
      price,
      maxSlippageBps: 100,
      idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
    });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Spot order failed.";
    console.error("Failed to place spot order:", error);
    return { ok: false, error: message };
  }
};

export const transferUSDC = async ({
  amount,
  direction,
}: {
  amount: number;
  direction: "perpsToSpot" | "spotToPerps";
}): Promise<{ ok: boolean; error?: string }> => {
  if (isHyperliquidExecution()) {
    return {
      ok: false,
      error:
        "Transfers are intentionally disabled in API-wallet mode. Use Hyperliquid directly.",
    };
  }
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to transfer." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a valid amount." };
  }
  try {
    await convex.mutation(api.spot.transferUSDC, {
      amount,
      direction,
      idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer failed.";
    console.error("Failed to transfer USDC:", error);
    return { ok: false, error: message };
  }
};
