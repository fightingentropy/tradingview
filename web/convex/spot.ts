import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import { updatePortfolioMetrics } from "./lib/portfolio";
import { getServerMarkPriceAtoms } from "./lib/prices";
import { bumpCounter } from "./lib/stats";
import {
  ACCOUNTING_VERSION,
  CASH_PRECISION,
  PRICE_PRECISION,
  QUANTITY_PRECISION,
  ROUNDING_RULE,
  AccountingInputError,
  applySpotFill,
  atomsToDecimal,
  atomsToNumber,
  canonicalSymbol,
  cashAtoms,
  isExecutionWithinSlippage,
  priceAtoms,
  quantityAtoms,
  readStoredAtoms,
  validateSlippageBps,
} from "./lib/accounting";
import {
  readOperationReceipt,
  requestFingerprint,
  writeLedgerEvent,
  writeOperationReceipt,
} from "./lib/idempotency";

const financialError = (error: unknown): never => {
  if (error instanceof AccountingInputError) {
    throw new ConvexError(error.message);
  }
  throw error;
};

const parseFinancial = <T>(operation: () => T): T => {
  try {
    return operation();
  } catch (error) {
    return financialError(error);
  }
};

const getSpotBalance = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  asset: string,
) =>
  ctx.db
    .query("spotBalances")
    .withIndex("by_user_asset", (q) =>
      q.eq("userId", userId).eq("asset", asset),
    )
    .unique();

const upsertSpotBalance = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  asset: string,
  balanceAtoms: bigint,
) => {
  const existing = await getSpotBalance(ctx, userId, asset);
  const now = Date.now();
  const precision = asset === "USDC" || asset === "USDT"
    ? CASH_PRECISION
    : QUANTITY_PRECISION;
  const balance = atomsToNumber(balanceAtoms, precision);
  const exact = atomsToDecimal(balanceAtoms, precision);
  if (!existing) {
    await ctx.db.insert("spotBalances", {
      userId,
      ownerType: "user",
      ownerId: userId,
      asset,
      balance,
      balanceExact: exact,
      balancePrecision: precision,
      accountingVersion: ACCOUNTING_VERSION,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch(existing._id, {
      ownerType: "user",
      ownerId: userId,
      balance,
      balanceExact: exact,
      balancePrecision: precision,
      accountingVersion: ACCOUNTING_VERSION,
      updatedAt: now,
    });
  }
};

export const listSpotBalances = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    return ctx.db
      .query("spotBalances")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const transferUSDC = mutation({
  args: {
    amount: v.number(),
    direction: v.union(v.literal("perpsToSpot"), v.literal("spotToPerps")),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const amount = parseFinancial(() => cashAtoms(args.amount));

    const fingerprint = requestFingerprint({
      amount: atomsToDecimal(amount, CASH_PRECISION),
      direction: args.direction,
    });
    const receipt = await readOperationReceipt<{ ok: true }>(ctx, {
      ownerType: "user",
      ownerId: user._id,
      operation: "transferUSDC",
      idempotencyKey: args.idempotencyKey,
      fingerprint,
    });
    if (receipt.result) return receipt.result;

    const perpsBalance = await ctx.db
      .query("perpsBalances")
      .withIndex("by_user_asset", (q) =>
        q.eq("userId", user._id).eq("asset", "USDC"),
      )
      .unique();
    const spotBalance = await getSpotBalance(ctx, user._id, "USDC");

    const perpsAmount = perpsBalance
      ? readStoredAtoms(
          perpsBalance.balanceExact,
          perpsBalance.balance,
          CASH_PRECISION,
          false,
        )
      : 0n;
    const spotAmount = spotBalance
      ? readStoredAtoms(
          spotBalance.balanceExact,
          spotBalance.balance,
          CASH_PRECISION,
          false,
        )
      : 0n;

    if (args.direction === "perpsToSpot") {
      // Source = perps. The debit must provably succeed before crediting spot:
      // a missing perps row means a 0 balance, which cannot cover a positive
      // amount, so reject instead of crediting the destination unconditionally.
      if (!perpsBalance || amount > perpsAmount) {
        throw new ConvexError("Insufficient Perps USDC balance.");
      }
      // Deduct from perps (source), then credit spot (destination).
      await ctx.db.patch(perpsBalance._id, {
        ownerType: "user",
        ownerId: user._id,
        balance: atomsToNumber(perpsAmount - amount, CASH_PRECISION),
        balanceExact: atomsToDecimal(perpsAmount - amount, CASH_PRECISION),
        balancePrecision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        updatedAt: Date.now(),
      });
      await upsertSpotBalance(ctx, user._id, "USDC", spotAmount + amount);
    } else {
      // Source = spot. The debit must provably succeed before crediting perps:
      // a missing spot row means a 0 balance, which cannot cover a positive
      // amount, so reject instead of crediting the destination unconditionally.
      if (!spotBalance || amount > spotAmount) {
        throw new ConvexError("Insufficient Spot USDC balance.");
      }
      // Deduct from spot (source), then credit perps (destination).
      await upsertSpotBalance(ctx, user._id, "USDC", spotAmount - amount);
      const now = Date.now();
      if (!perpsBalance) {
        await ctx.db.insert("perpsBalances", {
          userId: user._id,
          ownerType: "user",
          ownerId: user._id,
          asset: "USDC",
          balance: atomsToNumber(amount, CASH_PRECISION),
          balanceExact: atomsToDecimal(amount, CASH_PRECISION),
          balancePrecision: CASH_PRECISION,
          accountingVersion: ACCOUNTING_VERSION,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(perpsBalance._id, {
          ownerType: "user",
          ownerId: user._id,
          balance: atomsToNumber(perpsAmount + amount, CASH_PRECISION),
          balanceExact: atomsToDecimal(perpsAmount + amount, CASH_PRECISION),
          balancePrecision: CASH_PRECISION,
          accountingVersion: ACCOUNTING_VERSION,
          updatedAt: now,
        });
      }
    }

    await updatePortfolioMetrics(ctx, user._id, {
      volumeDelta: 0,
      pnlDelta: 0,
    });

    const spotDelta = args.direction === "perpsToSpot" ? amount : -amount;
    await Promise.all([
      writeLedgerEvent(ctx, {
        ownerType: "user",
        ownerId: user._id,
        operation: `transfer:${args.direction}:spot`,
        asset: "USDC",
        amountExact: atomsToDecimal(spotDelta, CASH_PRECISION),
        precision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        roundingRule: ROUNDING_RULE,
        idempotencyKey: receipt.key,
      }),
      writeLedgerEvent(ctx, {
        ownerType: "user",
        ownerId: user._id,
        operation: `transfer:${args.direction}:perps`,
        asset: "USDC",
        amountExact: atomsToDecimal(-spotDelta, CASH_PRECISION),
        precision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        roundingRule: ROUNDING_RULE,
        idempotencyKey: receipt.key,
      }),
    ]);
    const result = { ok: true as const };
    await writeOperationReceipt(ctx, {
      ownerType: "user",
      ownerId: user._id,
      operation: "transferUSDC",
      idempotencyKey: receipt.key,
      fingerprint,
      result,
    });
    return result;
  },
});

export const placeSpotOrder = mutation({
  args: {
    symbol: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    size: v.number(),
    // Client reference price is used only for mandatory slippage protection. It must
    // NEVER influence settled notional or credited balances — the fill price is
    // always derived server-side via getServerMarkPrice.
    price: v.number(),
    maxSlippageBps: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const { symbol, size, referencePrice, maxSlippageBps } = parseFinancial(
      () => ({
        symbol: canonicalSymbol(args.symbol),
        size: quantityAtoms(args.size),
        referencePrice: priceAtoms(args.price),
        maxSlippageBps: validateSlippageBps(args.maxSlippageBps),
      }),
    );
    if (symbol === "USDC" || symbol === "USDT") {
      throw new ConvexError("Stablecoin spot pairs are not supported.");
    }

    const fingerprint = requestFingerprint({
      symbol,
      side: args.side,
      size: atomsToDecimal(size, QUANTITY_PRECISION),
      referencePrice: atomsToDecimal(referencePrice, PRICE_PRECISION),
      maxSlippageBps,
    });
    const receipt = await readOperationReceipt<{ ok: true }>(ctx, {
      ownerType: "user",
      ownerId: user._id,
      operation: "placeSpotOrder",
      idempotencyKey: args.idempotencyKey,
      fingerprint,
    });
    if (receipt.result) return receipt.result;

    // Authoritative fill price from the server oracle — never the client arg.
    const fillPriceAtoms = await getServerMarkPriceAtoms(ctx, symbol);
    if (
      !isExecutionWithinSlippage({
        referencePrice,
        executionPrice: fillPriceAtoms,
        side: args.side,
        maxSlippageBps,
      })
    ) {
      throw new ConvexError("Execution price exceeds the slippage limit.");
    }

    const quote = await getSpotBalance(ctx, user._id, "USDC");
    const base = await getSpotBalance(ctx, user._id, symbol);
    const quoteBalance = quote
      ? readStoredAtoms(quote.balanceExact, quote.balance, CASH_PRECISION, false)
      : 0n;
    const baseBalance = base
      ? readStoredAtoms(
          base.balanceExact,
          base.balance,
          QUANTITY_PRECISION,
          false,
        )
      : 0n;
    const fill = parseFinancial(() =>
      applySpotFill({
        quoteBalance,
        baseBalance,
        size,
        price: fillPriceAtoms,
        side: args.side,
      }),
    );
    await upsertSpotBalance(ctx, user._id, "USDC", fill.quoteBalance);
    await upsertSpotBalance(ctx, user._id, symbol, fill.baseBalance);
    const notional = atomsToNumber(fill.notional, CASH_PRECISION);

    await ctx.db.insert("trades", {
      userId: user._id,
      ownerType: "user",
      ownerId: user._id,
      symbol,
      side: args.side,
      price: atomsToNumber(fillPriceAtoms, PRICE_PRECISION),
      priceExact: atomsToDecimal(fillPriceAtoms, PRICE_PRECISION),
      size: atomsToNumber(size, QUANTITY_PRECISION),
      sizeExact: atomsToDecimal(size, QUANTITY_PRECISION),
      notional,
      notionalExact: atomsToDecimal(fill.notional, CASH_PRECISION),
      fee: 0,
      feeExact: "0",
      pnl: 0,
      pnlExact: "0",
      accountingVersion: ACCOUNTING_VERSION,
      pricePrecision: PRICE_PRECISION,
      sizePrecision: QUANTITY_PRECISION,
      cashPrecision: CASH_PRECISION,
      roundingRule: ROUNDING_RULE,
      createdAt: Date.now(),
    });

    // Display counter: count the spot trade (volume is counted via
    // updatePortfolioMetrics below).
    await bumpCounter(ctx, "total_trades", 1);

    await updatePortfolioMetrics(ctx, user._id, {
      volumeDeltaAtoms: fill.notional,
      pnlDeltaAtoms: 0n,
    });

    await Promise.all([
      writeLedgerEvent(ctx, {
        ownerType: "user",
        ownerId: user._id,
        operation: `spot:${args.side}:quote`,
        asset: "USDC",
        amountExact: atomsToDecimal(
          args.side === "buy" ? -fill.notional : fill.notional,
          CASH_PRECISION,
        ),
        precision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        roundingRule: ROUNDING_RULE,
        idempotencyKey: receipt.key,
      }),
      writeLedgerEvent(ctx, {
        ownerType: "user",
        ownerId: user._id,
        operation: `spot:${args.side}:base`,
        asset: symbol,
        amountExact: atomsToDecimal(
          args.side === "buy" ? size : -size,
          QUANTITY_PRECISION,
        ),
        precision: QUANTITY_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        roundingRule: ROUNDING_RULE,
        idempotencyKey: receipt.key,
      }),
    ]);
    const result = { ok: true as const };
    await writeOperationReceipt(ctx, {
      ownerType: "user",
      ownerId: user._id,
      operation: "placeSpotOrder",
      idempotencyKey: receipt.key,
      fingerprint,
      result,
    });
    return result;
  },
});
