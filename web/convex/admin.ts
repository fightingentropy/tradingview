import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/admin";
import { updatePortfolioMetrics } from "./lib/portfolio";
import { readCounter, setCounter } from "./lib/stats";
import {
  ACCOUNTING_VERSION,
  CASH_PRECISION,
  ROUNDING_RULE,
  AccountingInputError,
  atomsToDecimal,
  atomsToNumber,
  cashAtoms,
  readStoredAtoms,
} from "./lib/accounting";
import {
  readOperationReceipt,
  requestFingerprint,
  writeLedgerEvent,
  writeOperationReceipt,
} from "./lib/idempotency";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const getDashboardStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();

    // All-time aggregates come from incrementally-maintained sharded counters
    // (convex/lib/stats.ts), NOT full-table scans of the unbounded trades/orders
    // history — which would eventually exceed Convex's 32k-docs-scanned limit.
    const [totalUsers, totalTrades, totalFees, totalVolume, totalPnl, totalEquity] =
      await Promise.all([
        readCounter(ctx, "total_users"),
        readCounter(ctx, "total_trades"),
        readCounter(ctx, "total_fees"),
        readCounter(ctx, "total_volume"),
        readCounter(ctx, "total_realized_pnl"),
        readCounter(ctx, "total_equity"),
      ]);

    // Point-in-time counts use bounded, indexed reads. Open orders, open
    // positions, and recently-active users are bounded by concurrent activity,
    // not by total history, so these stay well under the per-query scan limit.
    const [activeUsers, openOrders, partialOrders, positions] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_lastSeen", (q) => q.gte("lastSeenAt", now - ONE_DAY_MS))
        .collect(),
      ctx.db
        .query("orders")
        .withIndex("by_status", (q) => q.eq("status", "open"))
        .collect(),
      ctx.db
        .query("orders")
        .withIndex("by_status", (q) => q.eq("status", "partial"))
        .collect(),
      ctx.db.query("positions").collect(),
    ]);

    return {
      totalUsers,
      activeUsers24h: activeUsers.length,
      totalVolume,
      totalEquity,
      totalPnl,
      totalTrades,
      totalFees,
      openOrders: openOrders.length + partialOrders.length,
      openPositions: positions.length,
      updatedAt: now,
    };
  },
});

/**
 * One-shot reseed of the sharded dashboard counters from current data. Intended
 * to be run once after deploying the counter change (or to reconcile drift)
 * while tables are still modest. Ongoing maintenance is incremental, so this is
 * never on a user-facing path. Internal: invoke from the Convex dashboard or CLI
 * (`convex run admin:recomputeStats`).
 */
export const recomputeStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const [users, metrics, trades] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("portfolioMetrics").collect(),
      ctx.db.query("trades").collect(),
    ]);

    await setCounter(ctx, "total_users", users.length);
    await setCounter(ctx, "total_trades", trades.length);
    await setCounter(
      ctx,
      "total_fees",
      trades.reduce((sum, t) => sum + t.fee, 0),
    );
    await setCounter(
      ctx,
      "total_volume",
      metrics.reduce((sum, m) => sum + m.volume, 0),
    );
    await setCounter(
      ctx,
      "total_realized_pnl",
      metrics.reduce((sum, m) => sum + m.pnl, 0),
    );
    await setCounter(
      ctx,
      "total_equity",
      metrics.reduce((sum, m) => sum + m.totalEquity, 0),
    );

    return {
      totalUsers: users.length,
      totalTrades: trades.length,
    };
  },
});

export const mintPerpsUSDC = mutation({
  args: { amount: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    let amount: bigint;
    try {
      amount = cashAtoms(args.amount);
    } catch (error) {
      if (error instanceof AccountingInputError) {
        throw new ConvexError(error.message);
      }
      throw error;
    }
    const fingerprint = requestFingerprint({
      amount: atomsToDecimal(amount, CASH_PRECISION),
    });
    const receipt = await readOperationReceipt<{ balance: number }>(ctx, {
      ownerType: "user",
      ownerId: admin._id,
      operation: "mintPerpsUSDC",
      idempotencyKey: args.idempotencyKey,
      fingerprint,
    });
    if (receipt.result) return receipt.result;

    const now = Date.now();
    const existing = await ctx.db
      .query("perpsBalances")
      .withIndex("by_owner_asset", (q) =>
        q.eq("ownerType", "user").eq("ownerId", admin._id).eq("asset", "USDC"),
      )
      .unique();

    const currentBalance = existing
      ? readStoredAtoms(
          existing.balanceExact,
          existing.balance,
          CASH_PRECISION,
          false,
        )
      : 0n;
    const nextBalance = currentBalance + amount;
    if (!existing) {
      await ctx.db.insert("perpsBalances", {
        userId: admin._id,
        ownerType: "user",
        ownerId: admin._id,
        asset: "USDC",
        balance: atomsToNumber(nextBalance, CASH_PRECISION),
        balanceExact: atomsToDecimal(nextBalance, CASH_PRECISION),
        balancePrecision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id, {
        balance: atomsToNumber(nextBalance, CASH_PRECISION),
        balanceExact: atomsToDecimal(nextBalance, CASH_PRECISION),
        balancePrecision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        updatedAt: now,
      });
    }

    await updatePortfolioMetrics(ctx, admin._id);

    await writeLedgerEvent(ctx, {
      ownerType: "user",
      ownerId: admin._id,
      operation: "admin:mint",
      asset: "USDC",
      amountExact: atomsToDecimal(amount, CASH_PRECISION),
      precision: CASH_PRECISION,
      accountingVersion: ACCOUNTING_VERSION,
      roundingRule: ROUNDING_RULE,
      idempotencyKey: receipt.key,
    });
    const result = { balance: atomsToNumber(nextBalance, CASH_PRECISION) };
    await writeOperationReceipt(ctx, {
      ownerType: "user",
      ownerId: admin._id,
      operation: "mintPerpsUSDC",
      idempotencyKey: receipt.key,
      fingerprint,
      result,
    });
    return result;
  },
});
