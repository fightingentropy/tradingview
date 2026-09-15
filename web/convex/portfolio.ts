import { query } from "./_generated/server";
import { getAuthUser } from "./lib/auth";
import { calculatePerpsEquity, calculateSpotEquity } from "./lib/portfolio";

export const getMetrics = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;
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
