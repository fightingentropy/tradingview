import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import {
  calculateWeightedSpotEquityAtoms,
  isPortfolioMarginEnabled,
  updatePortfolioMetrics,
} from "./lib/portfolio";
import {
  getServerFundingRateAtoms,
  getServerMarkPriceAtoms,
} from "./lib/prices";
import { bumpCounter } from "./lib/stats";
import {
  ACCOUNTING_VERSION,
  CASH_PRECISION,
  PRICE_PRECISION,
  QUANTITY_PRECISION,
  ROUNDING_RULE,
  AccountingInputError,
  atomsToDecimal,
  atomsToNumber,
  canonicalSymbol,
  fundingCashAtoms,
  isExecutionWithinSlippage,
  mulDiv,
  notionalCashAtoms,
  priceAtoms,
  quantityAtoms,
  readStoredAtoms,
  realizedPnlCashAtoms,
  weightedAveragePriceAtoms,
  validateSlippageBps,
} from "./lib/accounting";
import {
  readOperationReceipt,
  requestFingerprint,
  writeLedgerEvent,
  writeOperationReceipt,
} from "./lib/idempotency";

const collateralValidator = v.union(v.literal("USDC"), v.literal("USDT"));
const sideValidator = v.union(v.literal("buy"), v.literal("sell"));
const typeValidator = v.union(v.literal("market"), v.literal("limit"));
const marginTypeValidator = v.union(v.literal("isolated"), v.literal("cross"));
const OWNER_TYPE_USER = "user" as const;
const OWNER_TYPE_VAULT = "vault" as const;

type MarginType = "isolated" | "cross";

const parseFinancial = <T>(operation: () => T): T => {
  try {
    return operation();
  } catch (error) {
    if (error instanceof AccountingInputError) {
      throw new ConvexError(error.message);
    }
    throw error;
  }
};

const validateLeverage = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new ConvexError("Leverage must be a whole number from 1 to 200.");
  }
  return value;
};

type OwnerContext = {
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT;
  ownerId: Id<"users"> | Id<"vaults">;
  userId: Id<"users">;
};

const resolveOwner = async (
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  vaultId?: Id<"vaults">,
): Promise<OwnerContext> => {
  if (!vaultId) {
    return { ownerType: OWNER_TYPE_USER, ownerId: userId, userId };
  }
  const vault = await ctx.db.get(vaultId);
  if (!vault) {
    throw new ConvexError("Vault not found.");
  }
  if (vault.operatorUserId !== userId) {
    throw new ConvexError("Not authorized to trade this vault.");
  }
  if (vault.status !== "active") {
    throw new ConvexError("Vault is not active.");
  }
  return { ownerType: OWNER_TYPE_VAULT, ownerId: vaultId, userId };
};

const resolveOwnerForQuery = async (
  ctx: QueryCtx,
  userId: Id<"users">,
  vaultId?: Id<"vaults">,
) => {
  if (!vaultId) {
    return { ownerType: OWNER_TYPE_USER, ownerId: userId };
  }
  const vault = await ctx.db.get(vaultId);
  if (!vault || vault.operatorUserId !== userId) return null;
  if (vault.status !== "active") return null;
  return { ownerType: OWNER_TYPE_VAULT, ownerId: vaultId };
};

const getPosition = async (
  ctx: MutationCtx | QueryCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
  symbol: string,
) =>
  ctx.db
    .query("positions")
    .withIndex("by_owner_symbol", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId).eq("symbol", symbol),
    )
    .unique();

const getPerpsBalanceAtoms = async (
  ctx: MutationCtx | QueryCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
  asset: "USDC" | "USDT",
) => {
  const balance = await ctx.db
    .query("perpsBalances")
    .withIndex("by_owner_asset", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId).eq("asset", asset),
    )
    .unique();
  return balance
    ? readStoredAtoms(
        balance.balanceExact,
        balance.balance,
        CASH_PRECISION,
        false,
      )
    : 0n;
};

const resolveMarkPriceAtoms = (
  symbol: string,
  markPrices: Record<string, bigint>,
) => {
  const mark = markPrices[symbol];
  if (typeof mark === "bigint" && mark > 0n) return mark;
  throw new ConvexError(`Price unavailable for ${symbol}.`);
};

/**
 * Build a server-derived mark price map keyed by the EXACT position symbol so
 * downstream margin / PnL helpers can look prices up without ever touching a
 * client-supplied value. Any extra symbols (e.g. the order being placed) are
 * included via `extraSymbols`. A missing or stale price fails the risk check.
 */
const buildServerMarkPrices = async (
  ctx: MutationCtx | QueryCtx,
  symbols: string[],
) => {
  const map: Record<string, bigint> = {};
  const seen = new Set<string>();
  for (const symbol of symbols) {
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    map[symbol] = await getServerMarkPriceAtoms(ctx, symbol);
  }
  return map;
};

// Margin is charged on FULL notional per spec ("No symbol-scoped hedging").
// Margin used = Σ abs(size) * markPrice / leverage. Spot contributes to buying
// power only through weightedSpotEquity in the collateral pool — never as a
// same-asset offset against perps margin.
const calculateMarginUsed = (
  positions: Doc<"positions">[],
  markPrices: Record<string, bigint>,
) => {
  let marginUsed = 0n;
  for (const position of positions) {
    const leverage = validateLeverage(position.leverage);
    const mark = resolveMarkPriceAtoms(position.symbol, markPrices);
    const signedSize = readStoredAtoms(
      position.sizeExact,
      position.size,
      QUANTITY_PRECISION,
    );
    const size = signedSize < 0n ? -signedSize : signedSize;
    if (size <= 0n) continue;
    marginUsed += mulDiv(
      notionalCashAtoms(size, mark),
      1n,
      BigInt(leverage),
    );
  }
  return marginUsed;
};

const calculateNextMarginUsed = (
  positions: Doc<"positions">[],
  {
    symbol,
    signedSize,
    leverage,
    markPrice,
  }: {
    symbol: string;
    signedSize: bigint;
    leverage: number;
    markPrice: bigint;
    marginType?: MarginType;
  },
  markPrices: Record<string, bigint>,
) => {
  let marginUsed = 0n;
  let applied = false;

  for (const position of positions) {
    let nextSize = readStoredAtoms(
      position.sizeExact,
      position.size,
      QUANTITY_PRECISION,
    );
    let nextLeverage = position.leverage;

    if (position.symbol === symbol) {
      applied = true;
      nextSize += signedSize;
      nextLeverage = leverage;
    }

    if (nextSize === 0n) continue;
    nextLeverage = validateLeverage(nextLeverage);
    const mark = resolveMarkPriceAtoms(position.symbol, markPrices);
    const size = nextSize < 0n ? -nextSize : nextSize;
    marginUsed += mulDiv(
      notionalCashAtoms(size, mark),
      1n,
      BigInt(nextLeverage),
    );
  }

  if (!applied && signedSize !== 0n) {
    const size = signedSize < 0n ? -signedSize : signedSize;
    if (size > 0n) {
      marginUsed += mulDiv(
        notionalCashAtoms(size, markPrice),
        1n,
        BigInt(validateLeverage(leverage)),
      );
    }
  }

  return marginUsed;
};

const calculateTotalUnrealizedPnl = (
  positions: Doc<"positions">[],
  markPrices: Record<string, bigint>,
) => {
  let total = 0n;
  for (const position of positions) {
    const mark = resolveMarkPriceAtoms(position.symbol, markPrices);
    const entryAtoms = readStoredAtoms(
      position.entryPriceExact,
      position.entryPrice,
      PRICE_PRECISION,
      false,
    );
    const sizeAtoms = readStoredAtoms(
      position.sizeExact,
      position.size,
      QUANTITY_PRECISION,
    );
    total += notionalCashAtoms(sizeAtoms, mark - entryAtoms);
  }
  return total;
};

const adjustPerpsBalance = async (
  ctx: MutationCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
  userId: Id<"users"> | null,
  asset: "USDC" | "USDT",
  delta: bigint,
) => {
  if (delta === 0n) return;
  const existing = await ctx.db
    .query("perpsBalances")
    .withIndex("by_owner_asset", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId).eq("asset", asset),
    )
    .unique();
  const now = Date.now();
  if (!existing) {
    // Floor at 0: a debit can never mint a negative balance. The shortfall is
    // treated as bankruptcy for this sim — the loss is capped at available
    // collateral (here, zero).
    const next = delta > 0n ? delta : 0n;
    await ctx.db.insert("perpsBalances", {
      ...(userId ? { userId } : {}),
      ownerType,
      ownerId,
      asset,
      balance: atomsToNumber(next, CASH_PRECISION),
      balanceExact: atomsToDecimal(next, CASH_PRECISION),
      balancePrecision: CASH_PRECISION,
      accountingVersion: ACCOUNTING_VERSION,
      updatedAt: now,
    });
    return;
  }
  // Floor the resulting balance at 0 so a realized loss never drives the perps
  // balance negative. Credits (positive delta) are unaffected.
  const current = readStoredAtoms(
    existing.balanceExact,
    existing.balance,
    CASH_PRECISION,
    false,
  );
  const nextBalance = current + delta > 0n ? current + delta : 0n;
  await ctx.db.patch(existing._id, {
    ...(userId ? { userId } : {}),
    ownerType,
    ownerId,
    balance: atomsToNumber(nextBalance, CASH_PRECISION),
    balanceExact: atomsToDecimal(nextBalance, CASH_PRECISION),
    balancePrecision: CASH_PRECISION,
    accountingVersion: ACCOUNTING_VERSION,
    updatedAt: now,
  });
};

const applyFillToPosition = async (
  ctx: MutationCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
  userId: Id<"users"> | null,
  symbol: string,
  signedSize: bigint,
  fillPrice: bigint,
  leverage: number,
  collateral: "USDC" | "USDT",
  marginType: MarginType,
) => {
  const existing = await getPosition(ctx, ownerType, ownerId, symbol);
  const now = Date.now();
  let realizedPnl = 0n;
  const ownerFields =
    ownerType === OWNER_TYPE_USER
      ? { ownerType, ownerId, userId: userId ?? undefined }
      : { ownerType, ownerId };

  if (!existing) {
    if (signedSize === 0n) return 0n;
    await ctx.db.insert("positions", {
      ...ownerFields,
      symbol,
      size: atomsToNumber(signedSize, QUANTITY_PRECISION),
      sizeExact: atomsToDecimal(signedSize, QUANTITY_PRECISION),
      entryPrice: atomsToNumber(fillPrice, PRICE_PRECISION),
      entryPriceExact: atomsToDecimal(fillPrice, PRICE_PRECISION),
      leverage,
      collateral,
      marginType,
      realizedPnl: 0,
      realizedPnlExact: "0",
      cumulativeFunding: 0,
      cumulativeFundingExact: "0",
      lastFundingUpdate: now,
      updatedAt: now,
      accountingVersion: ACCOUNTING_VERSION,
      pricePrecision: PRICE_PRECISION,
      sizePrecision: QUANTITY_PRECISION,
      cashPrecision: CASH_PRECISION,
      roundingRule: ROUNDING_RULE,
    });
    return 0n;
  }

  const existingSize = readStoredAtoms(
    existing.sizeExact,
    existing.size,
    QUANTITY_PRECISION,
  );
  const existingEntry = readStoredAtoms(
    existing.entryPriceExact,
    existing.entryPrice,
    PRICE_PRECISION,
    false,
  );
  const existingRealized = readStoredAtoms(
    existing.realizedPnlExact,
    existing.realizedPnl,
    CASH_PRECISION,
  );
  const nextSize = existingSize + signedSize;
  const sameDirection =
    (existingSize > 0n && signedSize > 0n) ||
    (existingSize < 0n && signedSize < 0n) ||
    signedSize === 0n;

  if (sameDirection) {
    const existingAbs = existingSize < 0n ? -existingSize : existingSize;
    const signedAbs = signedSize < 0n ? -signedSize : signedSize;
    const totalAbs = existingAbs + signedAbs;
    const nextEntry =
      totalAbs === 0n
        ? fillPrice
        : weightedAveragePriceAtoms(
            existingAbs,
            existingEntry,
            signedAbs,
            fillPrice,
          );

    await ctx.db.patch(existing._id, {
      ...ownerFields,
      size: atomsToNumber(nextSize, QUANTITY_PRECISION),
      sizeExact: atomsToDecimal(nextSize, QUANTITY_PRECISION),
      entryPrice: atomsToNumber(nextEntry, PRICE_PRECISION),
      entryPriceExact: atomsToDecimal(nextEntry, PRICE_PRECISION),
      leverage,
      collateral,
      marginType,
      updatedAt: now,
      accountingVersion: ACCOUNTING_VERSION,
      pricePrecision: PRICE_PRECISION,
      sizePrecision: QUANTITY_PRECISION,
      cashPrecision: CASH_PRECISION,
      roundingRule: ROUNDING_RULE,
    });
    return 0n;
  }

  const existingAbs = existingSize < 0n ? -existingSize : existingSize;
  const signedAbs = signedSize < 0n ? -signedSize : signedSize;
  const closedSize = existingAbs < signedAbs ? existingAbs : signedAbs;
  realizedPnl = realizedPnlCashAtoms(
    existingEntry,
    fillPrice,
    closedSize,
    existingSize > 0n ? "long" : "short",
  );
  const nextRealized = existingRealized + realizedPnl;

  if (signedAbs < existingAbs) {
    await ctx.db.patch(existing._id, {
      ...ownerFields,
      size: atomsToNumber(nextSize, QUANTITY_PRECISION),
      sizeExact: atomsToDecimal(nextSize, QUANTITY_PRECISION),
      realizedPnl: atomsToNumber(nextRealized, CASH_PRECISION),
      realizedPnlExact: atomsToDecimal(nextRealized, CASH_PRECISION),
      updatedAt: now,
      accountingVersion: ACCOUNTING_VERSION,
      pricePrecision: PRICE_PRECISION,
      sizePrecision: QUANTITY_PRECISION,
      cashPrecision: CASH_PRECISION,
      roundingRule: ROUNDING_RULE,
    });
    return realizedPnl;
  }

  if (signedAbs === existingAbs) {
    await ctx.db.delete(existing._id);
    return realizedPnl;
  }

  await ctx.db.patch(existing._id, {
    ...ownerFields,
    size: atomsToNumber(nextSize, QUANTITY_PRECISION),
    sizeExact: atomsToDecimal(nextSize, QUANTITY_PRECISION),
    entryPrice: atomsToNumber(fillPrice, PRICE_PRECISION),
    entryPriceExact: atomsToDecimal(fillPrice, PRICE_PRECISION),
    leverage,
    collateral,
    marginType,
    takeProfit: null,
    takeProfitExact: null,
    stopLoss: null,
    stopLossExact: null,
    realizedPnl: atomsToNumber(nextRealized, CASH_PRECISION),
    realizedPnlExact: atomsToDecimal(nextRealized, CASH_PRECISION),
    updatedAt: now,
    accountingVersion: ACCOUNTING_VERSION,
    pricePrecision: PRICE_PRECISION,
    sizePrecision: QUANTITY_PRECISION,
    cashPrecision: CASH_PRECISION,
    roundingRule: ROUNDING_RULE,
  });
  return realizedPnl;
};

const recordTrade = async (
  ctx: MutationCtx,
  {
    ownerType,
    ownerId,
    userId,
    orderId,
    symbol,
    side,
    size,
    price,
    pnl,
  }: {
    ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT;
    ownerId: Id<"users"> | Id<"vaults">;
    userId: Id<"users"> | null;
    orderId?: Id<"orders">;
    symbol: string;
    side: "buy" | "sell";
    size: bigint;
    price: bigint;
    pnl: bigint;
  },
) => {
  const notional = notionalCashAtoms(size, price);
  const ownerFields =
    ownerType === OWNER_TYPE_USER
      ? { ownerType, ownerId, userId: userId ?? undefined }
      : { ownerType, ownerId };
  const tradeId = await ctx.db.insert("trades", {
    ...ownerFields,
    symbol,
    side,
    price: atomsToNumber(price, PRICE_PRECISION),
    priceExact: atomsToDecimal(price, PRICE_PRECISION),
    size: atomsToNumber(size, QUANTITY_PRECISION),
    sizeExact: atomsToDecimal(size, QUANTITY_PRECISION),
    notional: atomsToNumber(notional, CASH_PRECISION),
    notionalExact: atomsToDecimal(notional, CASH_PRECISION),
    fee: 0,
    feeExact: "0",
    pnl: atomsToNumber(pnl, CASH_PRECISION),
    pnlExact: atomsToDecimal(pnl, CASH_PRECISION),
    orderId,
    createdAt: Date.now(),
    accountingVersion: ACCOUNTING_VERSION,
    pricePrecision: PRICE_PRECISION,
    sizePrecision: QUANTITY_PRECISION,
    cashPrecision: CASH_PRECISION,
    roundingRule: ROUNDING_RULE,
  });
  // Display counters: count every trade; fee is currently 0 everywhere. Volume
  // is counted via updatePortfolioMetrics below (per-user), matching the
  // dashboard's historical semantics.
  await bumpCounter(ctx, "total_trades", 1);
  await bumpCounter(ctx, "total_fees", 0);
  await writeLedgerEvent(ctx, {
    ownerType,
    ownerId,
    operation: "perps:realized-pnl",
    asset: "USDC",
    amountExact: atomsToDecimal(pnl, CASH_PRECISION),
    precision: CASH_PRECISION,
    accountingVersion: ACCOUNTING_VERSION,
    roundingRule: ROUNDING_RULE,
    referenceType: "trade",
    referenceId: String(tradeId),
  });
  if (ownerType === OWNER_TYPE_USER && userId) {
    await updatePortfolioMetrics(ctx, userId, {
      volumeDeltaAtoms: notional,
      pnlDeltaAtoms: pnl,
    });
  }
};

const executeFill = async (
  ctx: MutationCtx,
  {
    ownerType,
    ownerId,
    userId,
    orderId,
    symbol,
    side,
    size,
    price,
    leverage,
    collateral,
    marginType,
  }: {
    ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT;
    ownerId: Id<"users"> | Id<"vaults">;
    userId: Id<"users"> | null;
    orderId?: Id<"orders">;
    symbol: string;
    side: "buy" | "sell";
    size: bigint;
    price: bigint;
    leverage: number;
    collateral: "USDC" | "USDT";
    marginType: MarginType;
  },
) => {
  const signedSize = side === "buy" ? size : -size;
  const realizedPnl = await applyFillToPosition(
    ctx,
    ownerType,
    ownerId,
    userId,
    symbol,
    signedSize,
    price,
    leverage,
    collateral,
    marginType,
  );
  await adjustPerpsBalance(
    ctx,
    ownerType,
    ownerId,
    userId,
    collateral,
    realizedPnl,
  );
  await recordTrade(ctx, {
    ownerType,
    ownerId,
    userId,
    orderId,
    symbol,
    side,
    size,
    price,
    pnl: realizedPnl,
  });
};

export const listOpenOrders = query({
  args: { vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const owner = await resolveOwnerForQuery(ctx, user._id, args.vaultId);
    if (!owner) return [];
    // Use the by_owner_status_created index with database ordering for efficiency
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_owner_status_created", (q) =>
        q
          .eq("ownerType", owner.ownerType)
          .eq("ownerId", owner.ownerId)
          .eq("status", "open"),
      )
      .order("desc")
      .collect();
    return orders;
  },
});

export const listPositions = query({
  args: { vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const owner = await resolveOwnerForQuery(ctx, user._id, args.vaultId);
    if (!owner) return [];
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
      )
      .collect();
    return positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
  },
});

export const updatePositionTpsl = mutation({
  args: {
    symbol: v.string(),
    takeProfit: v.optional(v.union(v.number(), v.null())),
    stopLoss: v.optional(v.union(v.number(), v.null())),
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const symbol = parseFinancial(() => canonicalSymbol(args.symbol));
    const position = await getPosition(
      ctx,
      owner.ownerType,
      owner.ownerId,
      symbol,
    );
    if (!position) return;

    const updates: Record<string, number | string | null> = {};

    if (args.takeProfit !== undefined) {
      if (
        args.takeProfit !== null &&
        (!Number.isFinite(args.takeProfit) || args.takeProfit <= 0)
      ) {
        throw new ConvexError("Invalid take profit price.");
      }
      if (args.takeProfit === null) {
        updates.takeProfit = null;
        updates.takeProfitExact = null;
      } else {
        const takeProfit = parseFinancial(() =>
          priceAtoms(args.takeProfit as number),
        );
        updates.takeProfit = atomsToNumber(takeProfit, PRICE_PRECISION);
        updates.takeProfitExact = atomsToDecimal(takeProfit, PRICE_PRECISION);
      }
    }

    if (args.stopLoss !== undefined) {
      if (
        args.stopLoss !== null &&
        (!Number.isFinite(args.stopLoss) || args.stopLoss <= 0)
      ) {
        throw new ConvexError("Invalid stop loss price.");
      }
      if (args.stopLoss === null) {
        updates.stopLoss = null;
        updates.stopLossExact = null;
      } else {
        const stopLoss = parseFinancial(() =>
          priceAtoms(args.stopLoss as number),
        );
        updates.stopLoss = atomsToNumber(stopLoss, PRICE_PRECISION);
        updates.stopLossExact = atomsToDecimal(stopLoss, PRICE_PRECISION);
      }
    }

    if (Object.keys(updates).length === 0) return;
    await ctx.db.patch(position._id, updates);
  },
});

/**
 * Update funding for positions based on funding rates.
 * This should be called periodically (e.g., every hour) to accumulate funding.
 * Funding rates should be in decimal form (e.g., 0.0001 = 0.01%)
 */
export const updateFundingForPositions = mutation({
  args: {
    fundingRates: v.optional(v.record(v.string(), v.number())), // Map of symbol -> funding rate (decimal)
    markPrices: v.optional(v.record(v.string(), v.number())), // Map of symbol -> mark price
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
      )
      .collect();

    const now = Date.now();
    let updatedCount = 0;

    for (const position of positions) {
      // Funding rate and mark price are sourced from the server oracle ONLY.
      // Client-supplied args.fundingRates / args.markPrices are ignored for money.
      let fundingRate: bigint;
      let markPrice: bigint;
      try {
        fundingRate = await getServerFundingRateAtoms(ctx, position.symbol);
        markPrice = await getServerMarkPriceAtoms(ctx, position.symbol);
      } catch {
        // No fresh server price available for this symbol — skip funding.
        continue;
      }

      // Skip if we don't have a usable funding rate or mark price
      if (markPrice <= 0n) {
        continue;
      }

      // Calculate hours elapsed since last funding update (or position creation)
      const lastUpdate = position.lastFundingUpdate ?? position.updatedAt;
      const totalHoursElapsed = (now - lastUpdate) / (1000 * 60 * 60);

      // Calculate funding for each full hour (round down)
      const fullHoursElapsed = Math.floor(totalHoursElapsed);

      // Only update if at least 1 full hour has passed
      if (fullHoursElapsed < 1) {
        continue;
      }

      // Calculate funding for each hour
      const positionSize = readStoredAtoms(
        position.sizeExact,
        position.size,
        QUANTITY_PRECISION,
      );
      const fundingDelta = fundingCashAtoms({
        size: positionSize < 0n ? -positionSize : positionSize,
        price: markPrice,
        rate: fundingRate,
        hours: BigInt(fullHoursElapsed),
        side: positionSize > 0n ? "long" : "short",
      });

      // Update lastFundingUpdate to the start of the current hour
      // This ensures we don't double-count partial hours
      const hoursInMs = fullHoursElapsed * 60 * 60 * 1000;
      const newLastUpdate = lastUpdate + hoursInMs;

      // Update cumulative funding
      const currentFunding = readStoredAtoms(
        position.cumulativeFundingExact,
        position.cumulativeFunding ?? 0,
        CASH_PRECISION,
      );
      const newFunding = currentFunding + fundingDelta;

      // Update position with new funding and lastFundingUpdate timestamp
      // Use newLastUpdate to avoid double-counting partial hours
      await ctx.db.patch(position._id, {
        cumulativeFunding: atomsToNumber(newFunding, CASH_PRECISION),
        cumulativeFundingExact: atomsToDecimal(newFunding, CASH_PRECISION),
        lastFundingUpdate: newLastUpdate,
        updatedAt: now,
        accountingVersion: ACCOUNTING_VERSION,
        cashPrecision: CASH_PRECISION,
        roundingRule: ROUNDING_RULE,
      });

      // Adjust balance based on funding (funding affects the perps balance)
      await adjustPerpsBalance(
        ctx,
        owner.ownerType,
        owner.ownerId,
        owner.ownerType === OWNER_TYPE_USER ? user._id : null,
        position.collateral,
        fundingDelta,
      );
      await writeLedgerEvent(ctx, {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        operation: "perps:funding",
        asset: position.collateral,
        amountExact: atomsToDecimal(fundingDelta, CASH_PRECISION),
        precision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        roundingRule: ROUNDING_RULE,
        referenceType: "position",
        referenceId: String(position._id),
      });

      updatedCount++;
    }

    return { updated: updatedCount };
  },
});

export const listPerpsBalances = query({
  args: { vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const owner = await resolveOwnerForQuery(ctx, user._id, args.vaultId);
    if (!owner) return [];
    return ctx.db
      .query("perpsBalances")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
      )
      .collect();
  },
});

export const placePerpsOrder = mutation({
  args: {
    symbol: v.string(),
    side: sideValidator,
    type: typeValidator,
    size: v.number(),
    price: v.optional(v.number()),
    leverage: v.number(),
    collateral: collateralValidator,
    // markPrice / markPrices / spotPrices remain accepted for back-compat with
    // the existing client but are IGNORED for all settlement / margin math.
    markPrice: v.number(),
    maxSlippageBps: v.number(),
    markPrices: v.optional(v.record(v.string(), v.number())),
    spotPrices: v.optional(v.record(v.string(), v.number())),
    marginType: v.optional(marginTypeValidator),
    vaultId: v.optional(v.id("vaults")),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const ownerFields =
      owner.ownerType === OWNER_TYPE_USER
        ? {
            userId: user._id,
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
          }
        : { ownerType: owner.ownerType, ownerId: owner.ownerId };
    const symbol = parseFinancial(() => canonicalSymbol(args.symbol));
    if (symbol === "USDC" || symbol === "USDT") {
      throw new ConvexError("Stablecoin perpetual markets are not supported.");
    }
    const size = parseFinancial(() => quantityAtoms(args.size));
    const sizeNumber = atomsToNumber(size, QUANTITY_PRECISION);
    const leverage = validateLeverage(args.leverage);
    const limitPrice = parseFinancial(() => {
      if (args.type !== "limit") return undefined;
      if (args.price === undefined) {
        throw new AccountingInputError("Limit price is required.");
      }
      return priceAtoms(args.price);
    });
    const referencePrice = parseFinancial(() => priceAtoms(args.markPrice));
    const maxSlippageBps = parseFinancial(() =>
      validateSlippageBps(args.maxSlippageBps),
    );

    const fingerprint = requestFingerprint({
      symbol,
      side: args.side,
      type: args.type,
      size: atomsToDecimal(size, QUANTITY_PRECISION),
      limitPrice:
        limitPrice === undefined
          ? undefined
          : atomsToDecimal(limitPrice, PRICE_PRECISION),
      leverage,
      collateral: args.collateral,
      marginType: args.marginType ?? "cross",
      referencePrice: atomsToDecimal(referencePrice, PRICE_PRECISION),
      maxSlippageBps,
    });
    const receipt = await readOperationReceipt<{
      orderId: Id<"orders">;
      status: "filled" | "open";
    }>(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      operation: "placePerpsOrder",
      idempotencyKey: args.idempotencyKey,
      fingerprint,
    });
    if (receipt.result) return receipt.result;

    // Authoritative server mark for the symbol being traded. Throws if the
    // oracle has no fresh price.
    const serverMarkAtoms = await getServerMarkPriceAtoms(ctx, symbol);
    const serverMark = atomsToNumber(serverMarkAtoms, PRICE_PRECISION);
    if (
      !isExecutionWithinSlippage({
        referencePrice,
        executionPrice: serverMarkAtoms,
        side: args.side,
        maxSlippageBps,
      })
    ) {
      throw new ConvexError("Execution price exceeds the slippage limit.");
    }

    const marginType = args.marginType ?? "cross";
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
      )
      .collect();
    const currentPosition = positions.find(
      (position) => position.symbol === symbol,
    );
    if (
      currentPosition &&
      currentPosition.collateral !== args.collateral
    ) {
      throw new ConvexError(
        "Close the existing position before changing its collateral asset.",
      );
    }
    const signedSize = args.side === "buy" ? size : -size;

    const portfolioMarginEnabled =
      owner.ownerType === OWNER_TYPE_USER
        ? await isPortfolioMarginEnabled(ctx, user._id)
        : false;
    // Build a price map purely from server marks (existing positions + the
    // order symbol). Client price args never enter this map.
    const markPrices = await buildServerMarkPrices(ctx, [
      symbol,
      ...positions.map((position) => position.symbol),
    ]);
    markPrices[symbol] = serverMarkAtoms;

    if (portfolioMarginEnabled) {
      const currentMarginUsed = calculateMarginUsed(positions, markPrices);
      const nextMarginUsed = calculateNextMarginUsed(
        positions,
        {
          symbol,
          signedSize,
          leverage,
          markPrice: serverMarkAtoms,
          marginType,
        },
        markPrices,
      );
      const perpsBalances = await ctx.db
        .query("perpsBalances")
        .withIndex("by_owner", (q) =>
          q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
        )
        .collect();
      const totalPerpsBalance = perpsBalances.reduce(
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
      const weightedSpotEquity = await calculateWeightedSpotEquityAtoms(
        ctx,
        user._id,
      );
      const totalUnrealized = calculateTotalUnrealizedPnl(
        positions,
        markPrices,
      );
      const collateralPool =
        totalPerpsBalance + weightedSpotEquity + totalUnrealized;

      if (
        nextMarginUsed > collateralPool &&
        nextMarginUsed >= currentMarginUsed
      ) {
        throw new ConvexError("Insufficient collateral.");
      }
    } else {
      const collateralPositions = positions.filter(
        (position) => position.collateral === args.collateral,
      );
      const currentMarginUsed = calculateMarginUsed(
        collateralPositions,
        markPrices,
      );
      const nextMarginUsed = calculateNextMarginUsed(
        collateralPositions,
        {
          symbol,
          signedSize,
          leverage,
          markPrice: serverMarkAtoms,
          marginType,
        },
        markPrices,
      );
      const availableBalance = await getPerpsBalanceAtoms(
        ctx,
        owner.ownerType,
        owner.ownerId,
        args.collateral,
      );
      if (
        nextMarginUsed > availableBalance &&
        nextMarginUsed >= currentMarginUsed
      ) {
        throw new ConvexError("Insufficient collateral.");
      }
    }

    const now = Date.now();
    // The limit `price` is the client's crossing INTENT only. The crossing test
    // compares it to the server mark; the actual fill ALWAYS settles at the
    // server mark, never at the client value.
    const aggressive =
      args.type === "market" ||
      (limitPrice != null &&
        (args.side === "buy"
          ? limitPrice >= serverMarkAtoms
          : limitPrice <= serverMarkAtoms));

    if (aggressive) {
      const orderId = await ctx.db.insert("orders", {
        ...ownerFields,
        symbol,
        side: args.side,
        type: args.type,
        ...(limitPrice != null
          ? {
              price: atomsToNumber(limitPrice, PRICE_PRECISION),
              priceExact: atomsToDecimal(limitPrice, PRICE_PRECISION),
            }
          : {}),
        size: sizeNumber,
        sizeExact: atomsToDecimal(size, QUANTITY_PRECISION),
        filledSize: sizeNumber,
        filledSizeExact: atomsToDecimal(size, QUANTITY_PRECISION),
        avgFillPrice: serverMark,
        avgFillPriceExact: atomsToDecimal(serverMarkAtoms, PRICE_PRECISION),
        leverage,
        collateral: args.collateral,
        marginType,
        status: "filled",
        createdAt: now,
        updatedAt: now,
        accountingVersion: ACCOUNTING_VERSION,
        pricePrecision: PRICE_PRECISION,
        sizePrecision: QUANTITY_PRECISION,
        roundingRule: ROUNDING_RULE,
        idempotencyKey: receipt.key,
      });

      await executeFill(ctx, {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        userId: owner.ownerType === OWNER_TYPE_USER ? user._id : null,
        orderId,
        symbol,
        side: args.side,
        size,
        price: serverMarkAtoms,
        leverage,
        collateral: args.collateral,
        marginType,
      });
      const result = { orderId, status: "filled" as const };
      await writeOperationReceipt(ctx, {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        operation: "placePerpsOrder",
        idempotencyKey: receipt.key,
        fingerprint,
        result,
      });
      return result;
    }

    const orderId = await ctx.db.insert("orders", {
      ...ownerFields,
      symbol,
      side: args.side,
      type: args.type,
      ...(limitPrice != null
        ? {
            price: atomsToNumber(limitPrice, PRICE_PRECISION),
            priceExact: atomsToDecimal(limitPrice, PRICE_PRECISION),
          }
        : {}),
      size: sizeNumber,
      sizeExact: atomsToDecimal(size, QUANTITY_PRECISION),
      filledSize: 0,
      filledSizeExact: "0",
      leverage,
      collateral: args.collateral,
      marginType,
      status: "open",
      createdAt: now,
      updatedAt: now,
      accountingVersion: ACCOUNTING_VERSION,
      pricePrecision: PRICE_PRECISION,
      sizePrecision: QUANTITY_PRECISION,
      roundingRule: ROUNDING_RULE,
      idempotencyKey: receipt.key,
    });

    const result = { orderId, status: "open" as const };
    await writeOperationReceipt(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      operation: "placePerpsOrder",
      idempotencyKey: receipt.key,
      fingerprint,
      result,
    });
    return result;
  },
});

export const cancelOrder = mutation({
  args: { orderId: v.id("orders"), vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const order = await ctx.db.get(args.orderId);
    if (
      !order ||
      order.ownerType !== owner.ownerType ||
      order.ownerId !== owner.ownerId
    ) {
      return;
    }
    if (order.status !== "open") return;
    await ctx.db.patch(order._id, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
  },
});

export const fillOpenOrder = mutation({
  args: {
    orderId: v.id("orders"),
    // markPrice accepted for back-compat but IGNORED — fill settles at server mark.
    markPrice: v.optional(v.number()),
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const order = await ctx.db.get(args.orderId);
    if (
      !order ||
      order.ownerType !== owner.ownerType ||
      order.ownerId !== owner.ownerId
    ) {
      return;
    }
    if (order.status !== "open") return;

    // The resting order's limit price is only the crossing intent. The actual
    // fill settles at the authoritative server mark price.
    const fillPrice = await getServerMarkPriceAtoms(ctx, order.symbol);
    const orderSize = readStoredAtoms(
      order.sizeExact,
      order.size,
      QUANTITY_PRECISION,
      false,
    );
    if (order.price === undefined) {
      throw new ConvexError("Limit price is missing.");
    }
    const limitPrice = readStoredAtoms(
      order.priceExact,
      order.price,
      PRICE_PRECISION,
      false,
    );
    const crossed =
      order.side === "buy" ? fillPrice <= limitPrice : fillPrice >= limitPrice;
    if (!crossed) {
      throw new ConvexError("Limit order has not crossed the server mark.");
    }

    await ctx.db.patch(order._id, {
      status: "filled",
      filledSize: atomsToNumber(orderSize, QUANTITY_PRECISION),
      filledSizeExact: atomsToDecimal(orderSize, QUANTITY_PRECISION),
      avgFillPrice: atomsToNumber(fillPrice, PRICE_PRECISION),
      avgFillPriceExact: atomsToDecimal(fillPrice, PRICE_PRECISION),
      accountingVersion: ACCOUNTING_VERSION,
      pricePrecision: PRICE_PRECISION,
      sizePrecision: QUANTITY_PRECISION,
      roundingRule: ROUNDING_RULE,
      updatedAt: Date.now(),
    });

    await executeFill(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      userId: owner.ownerType === OWNER_TYPE_USER ? user._id : null,
      orderId: order._id,
      symbol: order.symbol,
      side: order.side,
      size: orderSize,
      price: fillPrice,
      leverage: order.leverage,
      collateral: order.collateral,
      marginType: order.marginType ?? "cross",
    });
  },
});

export const closePosition = mutation({
  args: {
    symbol: v.string(),
    // markPrice accepted for back-compat but IGNORED — close settles at server mark.
    markPrice: v.optional(v.number()),
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const symbol = parseFinancial(() => canonicalSymbol(args.symbol));
    const position = await getPosition(
      ctx,
      owner.ownerType,
      owner.ownerId,
      symbol,
    );
    if (!position) return;

    // Settlement price is the authoritative server mark, never the client value.
    const markPrice = await getServerMarkPriceAtoms(ctx, position.symbol);

    const marginType = position.marginType ?? "cross";
    const signedSize = readStoredAtoms(
      position.sizeExact,
      position.size,
      QUANTITY_PRECISION,
    );
    const side = signedSize > 0n ? "sell" : "buy";
    const size = signedSize < 0n ? -signedSize : signedSize;
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      ...(owner.ownerType === OWNER_TYPE_USER ? { userId: user._id } : {}),
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      symbol: position.symbol,
      side,
      type: "market",
      size: atomsToNumber(size, QUANTITY_PRECISION),
      sizeExact: atomsToDecimal(size, QUANTITY_PRECISION),
      filledSize: atomsToNumber(size, QUANTITY_PRECISION),
      filledSizeExact: atomsToDecimal(size, QUANTITY_PRECISION),
      avgFillPrice: atomsToNumber(markPrice, PRICE_PRECISION),
      avgFillPriceExact: atomsToDecimal(markPrice, PRICE_PRECISION),
      leverage: position.leverage,
      collateral: position.collateral,
      marginType,
      status: "filled",
      createdAt: now,
      updatedAt: now,
      accountingVersion: ACCOUNTING_VERSION,
      pricePrecision: PRICE_PRECISION,
      sizePrecision: QUANTITY_PRECISION,
      roundingRule: ROUNDING_RULE,
    });

    await executeFill(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      userId: owner.ownerType === OWNER_TYPE_USER ? user._id : null,
      orderId,
      symbol: position.symbol,
      side,
      size,
      price: markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType,
    });
  },
});

export const autoDeleveragePosition = mutation({
  args: {
    symbol: v.string(),
    // markPrice accepted for back-compat but IGNORED — ADL settles at server mark.
    markPrice: v.optional(v.number()),
    reduceSize: v.number(),
    vaultId: v.optional(v.id("vaults")),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const symbol = parseFinancial(() => canonicalSymbol(args.symbol));
    const requestedSize = parseFinancial(() => quantityAtoms(args.reduceSize));
    const fingerprint = requestFingerprint({
      symbol,
      reduceSize: atomsToDecimal(requestedSize, QUANTITY_PRECISION),
    });
    const receipt = await readOperationReceipt<{
      orderId: Id<"orders">;
      reducedSize: number;
    }>(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      operation: "autoDeleveragePosition",
      idempotencyKey: args.idempotencyKey,
      fingerprint,
    });
    if (receipt.result) return receipt.result;
    const position = await getPosition(
      ctx,
      owner.ownerType,
      owner.ownerId,
      symbol,
    );
    if (!position) return;

    // Settlement price is the authoritative server mark, never the client value.
    const markPrice = await getServerMarkPriceAtoms(ctx, position.symbol);

    const positionSize = readStoredAtoms(
      position.sizeExact,
      position.size,
      QUANTITY_PRECISION,
    );
    const absSize = positionSize < 0n ? -positionSize : positionSize;
    if (absSize <= 0n) return;
    const size = absSize < requestedSize ? absSize : requestedSize;

    const marginType = position.marginType ?? "cross";
    const side = positionSize > 0n ? "sell" : "buy";
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      ...(owner.ownerType === OWNER_TYPE_USER ? { userId: user._id } : {}),
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      symbol: position.symbol,
      side,
      type: "market",
      size: atomsToNumber(size, QUANTITY_PRECISION),
      sizeExact: atomsToDecimal(size, QUANTITY_PRECISION),
      filledSize: atomsToNumber(size, QUANTITY_PRECISION),
      filledSizeExact: atomsToDecimal(size, QUANTITY_PRECISION),
      avgFillPrice: atomsToNumber(markPrice, PRICE_PRECISION),
      avgFillPriceExact: atomsToDecimal(markPrice, PRICE_PRECISION),
      leverage: position.leverage,
      collateral: position.collateral,
      marginType,
      status: "filled",
      createdAt: now,
      updatedAt: now,
      accountingVersion: ACCOUNTING_VERSION,
      pricePrecision: PRICE_PRECISION,
      sizePrecision: QUANTITY_PRECISION,
      roundingRule: ROUNDING_RULE,
    });

    await executeFill(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      userId: owner.ownerType === OWNER_TYPE_USER ? user._id : null,
      orderId,
      symbol: position.symbol,
      side,
      size,
      price: markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType,
    });
    const result = {
      orderId,
      reducedSize: atomsToNumber(size, QUANTITY_PRECISION),
    };
    await writeOperationReceipt(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      operation: "autoDeleveragePosition",
      idempotencyKey: receipt.key,
      fingerprint,
      result,
    });
    return result;
  },
});
