import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  PRICE_PRECISION,
  FUNDING_RATE_PRECISION,
  atomsToNumber,
  canonicalSymbol,
  priceAtoms,
  readStoredAtoms,
} from "./accounting";
import { isFreshTimestamp } from "./oracle";

// ============================================================================
// Server-side price oracle.
//
// All settlement / fill / PnL / notional / funding / collateral-valuation math
// in the BACKEND must derive prices from here, NEVER from client-supplied args.
// ============================================================================

// A marketPrices row is considered usable if it was updated within this window.
// Kept comfortably larger than the poll interval (convex/crons.ts) so a single
// missed poll doesn't push a held symbol past freshness during normal polling.
export const FRESHNESS_MS = 45000;

type AnyCtx = QueryCtx | MutationCtx;

// Mirror the codebase's normalizeAssetSymbol (see convex/lib/portfolio.ts and
// convex/orders.ts) so oracle lookups key on the same base symbol.
export const normalizeAssetSymbol = (symbol: string): string => {
  try {
    return canonicalSymbol(symbol);
  } catch {
    return "";
  }
};

const STABLECOINS = new Set(["USDC", "USDT", "DAI", "USD"]);

const isFinitePositive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Authoritative server mark price for settlement math.
 *
 * Reads the marketPrices row by symbol and fails closed unless it is fresh.
 * Stablecoins are the sole exception and are valued at exactly 1.
 */
export async function getServerMarkPrice(
  ctx: AnyCtx,
  symbol: string,
): Promise<number> {
  return atomsToNumber(
    await getServerMarkPriceAtoms(ctx, symbol),
    PRICE_PRECISION,
  );
}

export async function getServerMarkPriceAtoms(
  ctx: AnyCtx,
  symbol: string,
): Promise<bigint> {
  const asset = normalizeAssetSymbol(symbol);
  if (STABLECOINS.has(asset)) return priceAtoms("1");
  if (asset) {
    const row = await ctx.db
      .query("marketPrices")
      .withIndex("by_symbol", (q) => q.eq("symbol", asset))
      .first();
    if (
      row &&
      isFreshTimestamp(row.updatedAt, Date.now(), FRESHNESS_MS) &&
      isFinitePositive(row.markPx)
    ) {
      return readStoredAtoms(
        row.markPxExact,
        row.markPx,
        PRICE_PRECISION,
        false,
      );
    }
  }
  throw new ConvexError("Fresh price unavailable for " + symbol);
}

/**
 * Server funding rate for a symbol. Returns the fresh marketPrices.funding when
 * available, otherwise 0. Funding must NEVER come from a client arg.
 */
export async function getServerFundingRate(
  ctx: AnyCtx,
  symbol: string,
): Promise<number> {
  return atomsToNumber(
    await getServerFundingRateAtoms(ctx, symbol),
    FUNDING_RATE_PRECISION,
  );
}

export async function getServerFundingRateAtoms(
  ctx: AnyCtx,
  symbol: string,
): Promise<bigint> {
  const asset = normalizeAssetSymbol(symbol);
  if (!asset) return 0n;
  const row = await ctx.db
    .query("marketPrices")
    .withIndex("by_symbol", (q) => q.eq("symbol", asset))
    .first();
  if (
    row &&
    isFreshTimestamp(row.updatedAt, Date.now(), FRESHNESS_MS) &&
    typeof row.funding === "number" &&
    Number.isFinite(row.funding)
  ) {
    return readStoredAtoms(
      row.fundingExact,
      row.funding,
      FUNDING_RATE_PRECISION,
    );
  }
  return 0n;
}
