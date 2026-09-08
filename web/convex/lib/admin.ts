import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuthUser } from "./auth";

export const requireAdmin = async (ctx: MutationCtx | QueryCtx) => {
  const user = await requireAuthUser(ctx);
  if (!user.isAdmin) {
    throw new ConvexError("Admin access required.");
  }
  return user;
};
