import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUser } from "./lib/auth";

const OWNER_TYPE_USER = "user" as const;
const OWNER_TYPE_VAULT = "vault" as const;

export const listTrades = query({
  args: { limit: v.optional(v.number()), vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const limit = args.limit ?? 50;

    const owner = args.vaultId ? await ctx.db.get(args.vaultId) : null;
    if (args.vaultId) {
      if (!owner || owner.operatorUserId !== user._id) return [];
      if (owner.status !== "active") return [];
    }
    const ownerType = args.vaultId ? OWNER_TYPE_VAULT : OWNER_TYPE_USER;
    const ownerId = args.vaultId ?? user._id;

    // Use the by_owner_created index and database ordering for efficiency
    const trades = await ctx.db
      .query("trades")
      .withIndex("by_owner_created", (q) =>
        q.eq("ownerType", ownerType).eq("ownerId", ownerId),
      )
      .order("desc")
      .take(limit);
    return trades;
  },
});
