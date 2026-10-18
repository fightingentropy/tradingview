import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { requireAdmin } from "./lib/admin";

const DEFAULT_RUN_URL = "https://trade.erlin.org/api/daily-briefs/run";

export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return true;
  },
});

/**
 * Starts an on-demand daily brief. Only admins may spend a paid research run;
 * the Worker credential stays in Convex and never reaches the browser.
 */
export const runDailyBrief = action({
  args: {},
  handler: async (ctx): Promise<{ status: string; startedAt?: string }> => {
    await ctx.runQuery(internal.brief.assertAdmin, {});
    const token = process.env.BRIEF_RUN_TOKEN;
    if (!token) throw new ConvexError("On-demand briefs are not configured.");
    const response = await fetch(process.env.BRIEF_RUN_URL ?? DEFAULT_RUN_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await response.json().catch(() => ({}))) as { status?: unknown; startedAt?: unknown; error?: unknown };
    // 409 means a run is already in progress; report it rather than fail.
    if (!response.ok && response.status !== 409) {
      throw new ConvexError(`The brief could not start (${typeof body.error === "string" ? body.error : response.status}).`);
    }
    return {
      status: typeof body.status === "string" ? body.status : "queued",
      ...(typeof body.startedAt === "string" ? { startedAt: body.startedAt } : {}),
    };
  },
});
