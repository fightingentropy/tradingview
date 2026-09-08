import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import { getWeightedSpotEquityBreakdown } from "./lib/portfolio";

/**
 * Toggle portfolio margin mode for the authenticated user.
 * When enabled, spot collateral enters the cross-asset pool for perps.
 */
export const togglePortfolioMargin = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    await ctx.db.patch(user._id, {
      portfolioMarginEnabled: args.enabled,
    });
    return { ok: true, enabled: args.enabled };
  },
});

/**
 * Get the current portfolio margin status for the authenticated user.
 * Returns whether portfolio margin is enabled and collateral breakdown data.
 */
export const getPortfolioMarginStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const enabled = user.portfolioMarginEnabled ?? false;
    const spotBreakdown = await getWeightedSpotEquityBreakdown(ctx, user._id);
    const weightedSpotEquity = spotBreakdown.reduce(
      (sum, item) => sum + item.weightedValue,
      0,
    );

    return {
      enabled,
      collateral: {
        spot: spotBreakdown,
        weightedSpotEquity: enabled ? weightedSpotEquity : 0,
      },
    };
  },
});

/**
 * Clear legacy spot collateral data on positions.
 * Call this when toggling portfolio margin to avoid stale hedging fields.
 */
export const recalculateSpotCollateral = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const now = Date.now();
    let updated = 0;

    for (const pos of positions) {
      if ((pos.spotCollateralSize ?? 0) !== 0) {
        await ctx.db.patch(pos._id, {
          spotCollateralSize: 0,
          updatedAt: now,
        });
        updated++;
      }
    }

    return { ok: true, updated };
  },
});
