import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUser } from "./lib/auth";

const OWNER_TYPE_USER = "user" as const;

export const listTrades = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const limit = args.limit ?? 50;

    // Use the by_owner_created index and database ordering for efficiency
    const trades = await ctx.db
      .query("trades")
      .withIndex("by_owner_created", (q) =>
        q.eq("ownerType", OWNER_TYPE_USER).eq("ownerId", user._id),
      )
      .order("desc")
      .take(limit);
    return trades;
  },
});
