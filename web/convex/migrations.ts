import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  ACCOUNTING_VERSION,
  CASH_PRECISION,
  PRICE_PRECISION,
  QUANTITY_PRECISION,
  ROUNDING_RULE,
  atomsToDecimal,
  decimalToAtoms,
} from "./lib/accounting";

export const removeDemoSeedVersion = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let updated = 0;

    for (const user of users) {
      if ("demoSeedVersion" in user) {
        await ctx.db.patch(user._id, { demoSeedVersion: undefined });
        updated += 1;
      }
    }

    return { updated };
  },
});

const legacyExact = (value: number, precision: number, allowNegative = true) =>
  atomsToDecimal(
    decimalToAtoms(value, precision, {
      allowNegative,
      rounding: "half-even",
    }),
    precision,
  );

/**
 * Paginated, resumable backfill for fixed-point-v1 shadow fields. Run each
 * table until isDone is true, passing continueCursor into the next invocation.
 * New writes already populate these fields; this only upgrades legacy rows.
 */
export const backfillAccountingV1 = internalMutation({
  args: {
    table: v.union(
      v.literal("perpsBalances"),
      v.literal("spotBalances"),
      v.literal("orders"),
      v.literal("positions"),
      v.literal("trades"),
      v.literal("portfolioMetrics"),
      v.literal("marketPrices"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    let updated = 0;
    if (args.table === "perpsBalances") {
      const result = await ctx.db
        .query("perpsBalances")
        .paginate(args.paginationOpts);
      for (const row of result.page) {
        if (row.balanceExact !== undefined) continue;
        await ctx.db.patch(row._id, {
          balanceExact: legacyExact(row.balance, CASH_PRECISION, false),
          balancePrecision: CASH_PRECISION,
          accountingVersion: ACCOUNTING_VERSION,
        });
        updated += 1;
      }
      return {
        updated,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    if (args.table === "spotBalances") {
      const result = await ctx.db
        .query("spotBalances")
        .paginate(args.paginationOpts);
      for (const row of result.page) {
        if (row.balanceExact !== undefined) continue;
        const precision =
          row.asset === "USDC" || row.asset === "USDT"
            ? CASH_PRECISION
            : QUANTITY_PRECISION;
        await ctx.db.patch(row._id, {
          balanceExact: legacyExact(row.balance, precision, false),
          balancePrecision: precision,
          accountingVersion: ACCOUNTING_VERSION,
        });
        updated += 1;
      }
      return {
        updated,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    if (args.table === "orders") {
      const result = await ctx.db.query("orders").paginate(args.paginationOpts);
      for (const row of result.page) {
        if (row.sizeExact !== undefined) continue;
        await ctx.db.patch(row._id, {
          sizeExact: legacyExact(row.size, QUANTITY_PRECISION, false),
          filledSizeExact: legacyExact(
            row.filledSize,
            QUANTITY_PRECISION,
            false,
          ),
          priceExact:
            row.price === undefined
              ? undefined
              : legacyExact(row.price, PRICE_PRECISION, false),
          avgFillPriceExact:
            row.avgFillPrice === undefined
              ? undefined
              : legacyExact(row.avgFillPrice, PRICE_PRECISION, false),
          accountingVersion: ACCOUNTING_VERSION,
          pricePrecision: PRICE_PRECISION,
          sizePrecision: QUANTITY_PRECISION,
          roundingRule: ROUNDING_RULE,
        });
        updated += 1;
      }
      return {
        updated,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    if (args.table === "positions") {
      const result = await ctx.db
        .query("positions")
        .paginate(args.paginationOpts);
      for (const row of result.page) {
        if (row.sizeExact !== undefined) continue;
        await ctx.db.patch(row._id, {
          sizeExact: legacyExact(row.size, QUANTITY_PRECISION),
          entryPriceExact: legacyExact(row.entryPrice, PRICE_PRECISION, false),
          takeProfitExact:
            row.takeProfit === undefined || row.takeProfit === null
              ? row.takeProfit
              : legacyExact(row.takeProfit, PRICE_PRECISION, false),
          stopLossExact:
            row.stopLoss === undefined || row.stopLoss === null
              ? row.stopLoss
              : legacyExact(row.stopLoss, PRICE_PRECISION, false),
          realizedPnlExact: legacyExact(row.realizedPnl, CASH_PRECISION),
          cumulativeFundingExact: legacyExact(
            row.cumulativeFunding ?? 0,
            CASH_PRECISION,
          ),
          accountingVersion: ACCOUNTING_VERSION,
          pricePrecision: PRICE_PRECISION,
          sizePrecision: QUANTITY_PRECISION,
          cashPrecision: CASH_PRECISION,
          roundingRule: ROUNDING_RULE,
        });
        updated += 1;
      }
      return {
        updated,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    if (args.table === "trades") {
      const result = await ctx.db.query("trades").paginate(args.paginationOpts);
      for (const row of result.page) {
        if (row.sizeExact !== undefined) continue;
        await ctx.db.patch(row._id, {
          priceExact: legacyExact(row.price, PRICE_PRECISION, false),
          sizeExact: legacyExact(row.size, QUANTITY_PRECISION, false),
          notionalExact: legacyExact(row.notional, CASH_PRECISION, false),
          feeExact: legacyExact(row.fee, CASH_PRECISION, false),
          pnlExact: legacyExact(row.pnl, CASH_PRECISION),
          accountingVersion: ACCOUNTING_VERSION,
          pricePrecision: PRICE_PRECISION,
          sizePrecision: QUANTITY_PRECISION,
          cashPrecision: CASH_PRECISION,
          roundingRule: ROUNDING_RULE,
        });
        updated += 1;
      }
      return {
        updated,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    if (args.table === "portfolioMetrics") {
      const result = await ctx.db
        .query("portfolioMetrics")
        .paginate(args.paginationOpts);
      for (const row of result.page) {
        if (row.totalEquityExact !== undefined) continue;
        await ctx.db.patch(row._id, {
          totalEquityExact: legacyExact(row.totalEquity, CASH_PRECISION),
          perpsEquityExact: legacyExact(row.perpsEquity, CASH_PRECISION),
          spotEquityExact: legacyExact(row.spotEquity, CASH_PRECISION),
          pnlExact: legacyExact(row.pnl, CASH_PRECISION),
          volumeExact: legacyExact(row.volume, CASH_PRECISION),
          accountingVersion: ACCOUNTING_VERSION,
          cashPrecision: CASH_PRECISION,
        });
        updated += 1;
      }
      return {
        updated,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    const result = await ctx.db
      .query("marketPrices")
      .paginate(args.paginationOpts);
    for (const row of result.page) {
      if (row.markPxExact !== undefined) continue;
      await ctx.db.patch(row._id, {
        markPxExact: legacyExact(row.markPx, PRICE_PRECISION, false),
        midPxExact:
          row.midPx === undefined
            ? undefined
            : legacyExact(row.midPx, PRICE_PRECISION, false),
        fundingExact:
          row.funding === undefined ? undefined : legacyExact(row.funding, 12),
        accountingVersion: ACCOUNTING_VERSION,
        pricePrecision: PRICE_PRECISION,
        fundingPrecision: 12,
      });
      updated += 1;
    }
    return {
      updated,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
