import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { bumpCounter } from "./stats";
import {
  ACCOUNTING_VERSION,
  CASH_PRECISION,
  PRICE_PRECISION,
  QUANTITY_PRECISION,
  atomsToDecimal,
  atomsToNumber,
  decimalToAtoms,
  mulDiv,
  notionalCashAtoms,
  readStoredAtoms,
} from "./accounting";
import { getServerMarkPriceAtoms } from "./prices";

// ============================================================================
// Portfolio Margin Collateral Helpers
// ============================================================================

export const COLLATERAL_WEIGHTS: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  BTC: 0.95,
  ETH: 0.9,
  SOL: 0.85,
  HYPE: 0.65,
  BNB: 0.9,
  XRP: 0.8,
  ADA: 0.8,
  DOGE: 0.7,
  AVAX: 0.8,
  LINK: 0.85,
  DOT: 0.8,
  LTC: 0.85,
  ATOM: 0.8,
};

export const getCollateralWeight = (asset: string) =>
  COLLATERAL_WEIGHTS[asset] ?? 0;

const COLLATERAL_WEIGHT_BPS: Record<string, bigint> = {
  USDC: 10_000n,
  USDT: 10_000n,
  BTC: 9_500n,
  ETH: 9_000n,
  SOL: 8_500n,
  HYPE: 6_500n,
  BNB: 9_000n,
  XRP: 8_000n,
  ADA: 8_000n,
  DOGE: 7_000n,
  AVAX: 8_000n,
  LINK: 8_500n,
  DOT: 8_000n,
  LTC: 8_500n,
  ATOM: 8_000n,
};

export const getCollateralWeightBps = (asset: string) =>
  COLLATERAL_WEIGHT_BPS[asset] ?? 0n;

// ============================================================================
// Demo Prices & Equity Calculations
// ============================================================================

export const DEMO_PRICES: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  BTC: 68435,
  ETH: 3034.5,
  SOL: 122.12,
  HYPE: 24.996,
  BNB: 598.2,
  XRP: 0.5582,
  ADA: 0.458,
  DOGE: 0.158,
  AVAX: 21.45,
  LINK: 17.29,
  DOT: 6.58,
  LTC: 91.29,
  ATOM: 9.58,
};

export const getDemoPrice = (asset: string) => DEMO_PRICES[asset] ?? 0;

export type PositionExposure = {
  symbol: string;
  size: number;
  marginType?: "isolated" | "cross";
};

const normalizeAssetSymbol = (symbol: string) => {
  const trimmed = String(symbol ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("xyz:")) {
    return trimmed.slice(trimmed.indexOf(":") + 1).toUpperCase();
  }
  return trimmed.toUpperCase();
};

const resolveSpotPrice = (
  asset: string,
  spotPrices?: Record<string, number>,
): number => {
  const normalized = normalizeAssetSymbol(asset);
  const live = spotPrices?.[normalized];
  if (typeof live === "number" && Number.isFinite(live) && live > 0) {
    return live;
  }
  return getDemoPrice(normalized);
};

export const getWeightedSpotEquityBreakdown = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  options: {
    positions?: PositionExposure[];
    spotPrices?: Record<string, number>;
  } = {},
) => {
  const balances = await ctx.db
    .query("spotBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const spotPrices = options.spotPrices;

  // Per-asset COLLATERAL_WEIGHTS haircuts are applied UNIFORMLY to every spot
  // asset. There is no symbol-scoped spot/short hedging (per specs.md "No
  // symbol-scoped hedging"): spot contributes to buying power solely through
  // its weighted equity here, while margin is charged on full notional in
  // orders.ts. This keeps the equity side and the margin side consistent.
  const breakdown = [];
  for (const balance of balances) {
    const normalized = normalizeAssetSymbol(balance.asset);
    const isCash = normalized === "USDC" || normalized === "USDT";
    const precision = isCash ? CASH_PRECISION : QUANTITY_PRECISION;
    const balanceAtoms = readStoredAtoms(
      balance.balanceExact,
      balance.balance,
      precision,
      false,
    );
    let priceAtoms = 0n;
    try {
      priceAtoms = spotPrices
        ? decimalToAtoms(
            resolveSpotPrice(normalized, spotPrices),
            PRICE_PRECISION,
            { allowNegative: false, allowZero: false, rounding: "half-even" },
          )
        : await getServerMarkPriceAtoms(ctx, normalized);
    } catch {
      priceAtoms = 0n;
    }
    const valueAtoms =
      priceAtoms === 0n
        ? 0n
        : isCash
          ? balanceAtoms
          : notionalCashAtoms(balanceAtoms, priceAtoms);
    const weightBps = getCollateralWeightBps(normalized);
    const weightedValueAtoms = mulDiv(valueAtoms, weightBps, 10_000n);

    breakdown.push({
      asset: balance.asset,
      balance: atomsToNumber(balanceAtoms, precision),
      price: atomsToNumber(priceAtoms, PRICE_PRECISION),
      weight: Number(weightBps) / 10_000,
      weightedValue: atomsToNumber(weightedValueAtoms, CASH_PRECISION),
    });
  }
  return breakdown;
};

export const calculateWeightedSpotEquity = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  positions?: PositionExposure[],
  spotPrices?: Record<string, number>,
) => {
  if (!spotPrices) {
    return atomsToNumber(
      await calculateWeightedSpotEquityAtoms(ctx, userId),
      CASH_PRECISION,
    );
  }
  const breakdown = await getWeightedSpotEquityBreakdown(ctx, userId, {
    positions,
    spotPrices,
  });
  return breakdown.reduce((sum, item) => sum + item.weightedValue, 0);
};

/** Authoritative collateral value used by backend risk checks. */
export const calculateWeightedSpotEquityAtoms = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) => {
  const balances = await ctx.db
    .query("spotBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  let total = 0n;
  for (const balance of balances) {
    const asset = normalizeAssetSymbol(balance.asset);
    const weightBps = getCollateralWeightBps(asset);
    if (weightBps === 0n) continue;
    const isCash = asset === "USDC" || asset === "USDT";
    const amount = readStoredAtoms(
      balance.balanceExact,
      balance.balance,
      isCash ? CASH_PRECISION : QUANTITY_PRECISION,
      false,
    );
    const value = isCash
      ? amount
      : notionalCashAtoms(amount, await getServerMarkPriceAtoms(ctx, asset));
    total += mulDiv(value, weightBps, 10_000n);
  }
  return total;
};

export const calculatePerpsEquityAtoms = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) => {
  const balances = await ctx.db
    .query("perpsBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return balances.reduce(
    (sum, balance) =>
      sum +
      readStoredAtoms(
        balance.balanceExact,
        balance.balance,
        CASH_PRECISION,
        false,
      ),
    0n,
  );
};

export const calculatePerpsEquity = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) => {
  return atomsToNumber(
    await calculatePerpsEquityAtoms(ctx, userId),
    CASH_PRECISION,
  );
};

export const calculateSpotEquityAtoms = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) => {
  const balances = await ctx.db
    .query("spotBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  let total = 0n;
  for (const balance of balances) {
    const normalized = normalizeAssetSymbol(balance.asset);
    const isCash = normalized === "USDC" || normalized === "USDT";
    const balanceAtoms = readStoredAtoms(
      balance.balanceExact,
      balance.balance,
      isCash ? CASH_PRECISION : QUANTITY_PRECISION,
      false,
    );
    if (isCash) {
      total += balanceAtoms;
      continue;
    }
    try {
      total += notionalCashAtoms(
        balanceAtoms,
        await getServerMarkPriceAtoms(ctx, normalized),
      );
    } catch {
      // Portfolio metrics are display-only and must never roll back an
      // otherwise-valid money mutation. Unpriced assets receive no equity
      // credit until an authoritative price is fresh again.
    }
  }
  return total;
};

export const calculateSpotEquity = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  spotPrices?: Record<string, number>,
) => {
  if (!spotPrices) {
    return atomsToNumber(
      await calculateSpotEquityAtoms(ctx, userId),
      CASH_PRECISION,
    );
  }
  const balances = await ctx.db
    .query("spotBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  let total = 0n;
  for (const balance of balances) {
    const normalized = normalizeAssetSymbol(balance.asset);
    const isCash = normalized === "USDC" || normalized === "USDT";
    const balanceAtoms = readStoredAtoms(
      balance.balanceExact,
      balance.balance,
      isCash ? CASH_PRECISION : QUANTITY_PRECISION,
      false,
    );
    if (isCash) {
      total += balanceAtoms;
      continue;
    }
    const price = decimalToAtoms(
      resolveSpotPrice(balance.asset, spotPrices),
      PRICE_PRECISION,
      { allowNegative: false, rounding: "half-even" },
    );
    total += notionalCashAtoms(balanceAtoms, price);
  }
  return atomsToNumber(total, CASH_PRECISION);
};

/**
 * Check if a user has portfolio margin enabled.
 */
export const isPortfolioMarginEnabled = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<boolean> => {
  const user = await ctx.db.get(userId);
  return user?.portfolioMarginEnabled ?? false;
};

export const updatePortfolioMetrics = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  deltas: {
    volumeDelta?: number;
    pnlDelta?: number;
    volumeDeltaAtoms?: bigint;
    pnlDeltaAtoms?: bigint;
  } = {},
): Promise<void> => {
  const volumeDelta = deltas.volumeDelta ?? 0;
  const pnlDelta = deltas.pnlDelta ?? 0;
  const existing = await ctx.db
    .query("portfolioMetrics")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  const perpsEquityAtoms = await calculatePerpsEquityAtoms(ctx, userId);
  const spotEquityAtoms = await calculateSpotEquityAtoms(ctx, userId);
  const currentVolume = existing
    ? readStoredAtoms(
        existing.volumeExact,
        existing.volume,
        CASH_PRECISION,
      )
    : 0n;
  const currentPnl = existing
    ? readStoredAtoms(existing.pnlExact, existing.pnl, CASH_PRECISION)
    : 0n;
  const volumeAtoms =
    currentVolume +
    (deltas.volumeDeltaAtoms ??
      decimalToAtoms(volumeDelta, CASH_PRECISION, {
        allowNegative: true,
        rounding: "half-even",
      }));
  const pnlAtoms =
    currentPnl +
    (deltas.pnlDeltaAtoms ??
      decimalToAtoms(pnlDelta, CASH_PRECISION, {
        allowNegative: true,
        rounding: "half-even",
      }));
  const totalEquityAtoms = perpsEquityAtoms + spotEquityAtoms;
  const perpsEquity = atomsToNumber(perpsEquityAtoms, CASH_PRECISION);
  const spotEquity = atomsToNumber(spotEquityAtoms, CASH_PRECISION);
  const volume = atomsToNumber(volumeAtoms, CASH_PRECISION);
  const pnl = atomsToNumber(pnlAtoms, CASH_PRECISION);
  const totalEquity = atomsToNumber(totalEquityAtoms, CASH_PRECISION);
  const previousEquityAtoms = existing
    ? readStoredAtoms(
        existing.totalEquityExact,
        existing.totalEquity,
        CASH_PRECISION,
      )
    : 0n;
  const updatedAt = Date.now();

  if (existing) {
    await ctx.db.patch(existing._id, {
      volume,
      volumeExact: atomsToDecimal(volumeAtoms, CASH_PRECISION),
      pnl,
      pnlExact: atomsToDecimal(pnlAtoms, CASH_PRECISION),
      perpsEquity,
      perpsEquityExact: atomsToDecimal(perpsEquityAtoms, CASH_PRECISION),
      spotEquity,
      spotEquityExact: atomsToDecimal(spotEquityAtoms, CASH_PRECISION),
      totalEquity,
      totalEquityExact: atomsToDecimal(totalEquityAtoms, CASH_PRECISION),
      accountingVersion: ACCOUNTING_VERSION,
      cashPrecision: CASH_PRECISION,
      updatedAt,
    });
  } else {
    await ctx.db.insert("portfolioMetrics", {
      userId,
      volume,
      volumeExact: atomsToDecimal(volumeAtoms, CASH_PRECISION),
      pnl,
      pnlExact: atomsToDecimal(pnlAtoms, CASH_PRECISION),
      perpsEquity,
      perpsEquityExact: atomsToDecimal(perpsEquityAtoms, CASH_PRECISION),
      spotEquity,
      spotEquityExact: atomsToDecimal(spotEquityAtoms, CASH_PRECISION),
      totalEquity,
      totalEquityExact: atomsToDecimal(totalEquityAtoms, CASH_PRECISION),
      accountingVersion: ACCOUNTING_VERSION,
      cashPrecision: CASH_PRECISION,
      updatedAt,
    });
  }

  // Maintain the global admin display counters from this single choke point.
  // Equity is a running sum of per-user deltas (point-in-time aggregate).
  await bumpCounter(
    ctx,
    "total_volume",
    atomsToNumber(
      deltas.volumeDeltaAtoms ??
        decimalToAtoms(volumeDelta, CASH_PRECISION, {
          allowNegative: true,
          rounding: "half-even",
        }),
      CASH_PRECISION,
    ),
  );
  await bumpCounter(
    ctx,
    "total_realized_pnl",
    atomsToNumber(
      deltas.pnlDeltaAtoms ??
        decimalToAtoms(pnlDelta, CASH_PRECISION, {
          allowNegative: true,
          rounding: "half-even",
        }),
      CASH_PRECISION,
    ),
  );
  await bumpCounter(
    ctx,
    "total_equity",
    atomsToNumber(totalEquityAtoms - previousEquityAtoms, CASH_PRECISION),
  );
};
