import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUser } from "./lib/auth";
import {
  calculatePerpsEquity,
  calculateSpotEquity,
} from "./lib/portfolio";
import {
  CASH_PRECISION,
  QUANTITY_PRECISION,
  atomsToNumber,
  notionalCashAtoms,
  readStoredAtoms,
} from "./lib/accounting";
import {
  getServerMarkPriceAtoms,
  normalizeAssetSymbol,
} from "./lib/prices";

const OWNER_TYPE_VAULT = "vault" as const;
const OWNER_TYPE_USER = "user" as const;

const calculateOwnerPerpsEquity = async (
  ctx: QueryCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
) => {
  const balances = await ctx.db
    .query("perpsBalances")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId),
    )
    .collect();
  const total = balances.reduce(
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
  return atomsToNumber(total, CASH_PRECISION);
};

const calculateOwnerSpotEquity = async (
  ctx: QueryCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
) => {
  const balances = await ctx.db
    .query("spotBalances")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId),
    )
    .collect();
  let total = 0n;
  for (const balance of balances) {
    const asset = normalizeAssetSymbol(balance.asset);
    const isCash = asset === "USDC" || asset === "USDT";
    const amount = readStoredAtoms(
      balance.balanceExact,
      balance.balance,
      isCash ? CASH_PRECISION : QUANTITY_PRECISION,
      false,
    );
    total += isCash
      ? amount
      : notionalCashAtoms(
          amount,
          await getServerMarkPriceAtoms(ctx, asset),
        );
  }
  return atomsToNumber(total, CASH_PRECISION);
};

export const getMetrics = query({
  args: { vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;
    if (args.vaultId) {
      const vault = await ctx.db.get(args.vaultId);
      if (!vault || vault.operatorUserId !== user._id) return null;
      if (vault.status !== "active") return null;
      const perpsEquity = await calculateOwnerPerpsEquity(
        ctx,
        OWNER_TYPE_VAULT,
        args.vaultId,
      );
      const spotEquity = await calculateOwnerSpotEquity(
        ctx,
        OWNER_TYPE_VAULT,
        args.vaultId,
      );
      const totalEquity = perpsEquity + spotEquity;
      return {
        userId: user._id,
        totalEquity,
        perpsEquity,
        spotEquity,
        pnl: 0,
        volume: 0,
        updatedAt: Date.now(),
      };
    }
    const metrics = await ctx.db
      .query("portfolioMetrics")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (metrics) return metrics;

    const perpsEquity = await calculatePerpsEquity(ctx, user._id);
    const spotEquity = await calculateSpotEquity(ctx, user._id);
    const totalEquity = perpsEquity + spotEquity;
    return {
      userId: user._id,
      totalEquity,
      perpsEquity,
      spotEquity,
      pnl: 0,
      volume: 0,
      updatedAt: Date.now(),
    };
  },
});
