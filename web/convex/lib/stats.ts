import type { MutationCtx, QueryCtx } from "../_generated/server";

// ============================================================================
// Sharded display counters for the admin dashboard.
//
// These maintain all-time aggregates (user/trade counts, volume, fees, realized
// PnL, total equity) incrementally so getDashboardStats never has to full-table
// scan the unbounded `trades`/`orders` history (which would eventually exceed
// Convex's 32,000-docs-scanned per-query limit — a hard failure).
//
// Writes are spread across NUM_SHARDS documents per counter so the per-trade
// increment does NOT funnel through one hot document (which would reintroduce
// single-document OCC write contention on the money hot path). Reads sum the
// shards. Values are best-effort DISPLAY metrics — never money — so minor float
// drift is acceptable and can be reset via admin.recomputeStats.
// ============================================================================

const NUM_SHARDS = 16;

export type CounterName =
  | "total_users"
  | "total_trades"
  | "total_fees"
  | "total_volume"
  | "total_realized_pnl"
  | "total_equity";

/** Apply a signed delta to a counter, on a randomly chosen shard. */
export const bumpCounter = async (
  ctx: MutationCtx,
  name: CounterName,
  delta: number,
): Promise<void> => {
  if (!Number.isFinite(delta) || delta === 0) return;
  // Math.random() is deterministic-per-execution in Convex and fine for shard
  // selection; spreading writes is what removes the hot-document contention.
  const shard = Math.floor(Math.random() * NUM_SHARDS);
  const existing = await ctx.db
    .query("statsCounters")
    .withIndex("by_name_shard", (q) => q.eq("name", name).eq("shard", shard))
    .unique();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      value: existing.value + delta,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("statsCounters", { name, shard, value: delta, updatedAt: now });
  }
};

/** Sum all shards for a counter. */
export const readCounter = async (
  ctx: QueryCtx | MutationCtx,
  name: CounterName,
): Promise<number> => {
  const shards = await ctx.db
    .query("statsCounters")
    .withIndex("by_name", (q) => q.eq("name", name))
    .collect();
  return shards.reduce((sum, s) => sum + s.value, 0);
};

/** Reset a counter to an exact total (clears existing shards). */
export const setCounter = async (
  ctx: MutationCtx,
  name: CounterName,
  total: number,
): Promise<void> => {
  const shards = await ctx.db
    .query("statsCounters")
    .withIndex("by_name", (q) => q.eq("name", name))
    .collect();
  for (const s of shards) await ctx.db.delete(s._id);
  await ctx.db.insert("statsCounters", {
    name,
    shard: 0,
    value: total,
    updatedAt: Date.now(),
  });
};
