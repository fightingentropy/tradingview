import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { FRESHNESS_MS, normalizeAssetSymbol } from "./lib/prices";
import {
  ACCOUNTING_VERSION,
  FUNDING_RATE_PRECISION,
  PRICE_PRECISION,
} from "./lib/accounting";
import {
  parseHyperliquidPerpPayload,
  parseHyperliquidSpotPayload,
} from "./lib/oracle";

// ============================================================================
// Server price poller.
//
// pollHyperliquidPrices fetches authoritative perps (and spot) marks + funding
// from Hyperliquid and upserts them into the marketPrices table. The oracle in
// convex/lib/prices.ts reads from that table. The client NEVER supplies prices
// used for settlement.
//
// IMPORTANT (cost): Hyperliquid exposes ~230 perps + ~100 spot pairs. Writing
// every one of them on every tick read+wrote hundreds of rows per poll and blew
// past the Convex free-tier Database I/O limit. marketPrices is only ever read
// on demand, one symbol at a time, at settlement (orders/spot) — nothing
// bulk-reads it and the client never reads it. So the poller writes ONLY the
// symbols that are actually held or have open orders (see getActiveSymbols), and
// ensureSymbolFresh covers the one-off case of trading a brand-new symbol.
// ============================================================================

const priceRowValidator = v.object({
  symbol: v.string(),
  markPx: v.number(),
  markPxExact: v.string(),
  midPx: v.optional(v.number()),
  midPxExact: v.optional(v.string()),
  funding: v.optional(v.number()),
  fundingExact: v.optional(v.string()),
  source: v.optional(v.string()),
  updatedAt: v.number(),
});

/**
 * Upsert price rows into marketPrices, keyed by normalized symbol.
 */
export const upsertMarketPrices = internalMutation({
  args: { rows: v.array(priceRowValidator) },
  handler: async (ctx, { rows }) => {
    for (const row of rows) {
      const symbol = normalizeAssetSymbol(row.symbol);
      if (!symbol) continue;
      if (!Number.isFinite(row.markPx) || row.markPx <= 0) continue;

      const existing = await ctx.db
        .query("marketPrices")
        .withIndex("by_symbol", (q) => q.eq("symbol", symbol))
        .first();

      // Skip redundant writes for prices that haven't moved, but only while the
      // row is still comfortably fresh (refreshed at least every FRESHNESS_MS/2).
      // This guarantees a stable price never drifts past the oracle's freshness
      // window while cutting the write volume for unchanged symbols.
      if (
        existing &&
        existing.markPxExact === row.markPxExact &&
        existing.midPxExact === row.midPxExact &&
        existing.fundingExact === row.fundingExact &&
        row.updatedAt - existing.updatedAt < FRESHNESS_MS / 2
      ) {
        continue;
      }

      const patch = {
        symbol,
        markPx: row.markPx,
        markPxExact: row.markPxExact,
        midPx: row.midPx,
        midPxExact: row.midPxExact,
        funding: row.funding,
        fundingExact: row.fundingExact,
        accountingVersion: ACCOUNTING_VERSION,
        pricePrecision: PRICE_PRECISION,
        fundingPrecision: FUNDING_RATE_PRECISION,
        source: row.source ?? "hyperliquid",
        updatedAt: row.updatedAt,
      };

      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert("marketPrices", patch);
      }
    }
  },
});

// Rows not refreshed within this window are considered abandoned and pruned by
// pruneStalePrices. Generous relative to FRESHNESS_MS so a transient Hyperliquid
// outage never deletes rows the poller is still actively refreshing; any pruned
// symbol is recreated on demand (ensureSymbolFresh) or by the next poll once
// it's held/traded again.
const STALE_PRICE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Delete marketPrices rows that haven't been refreshed within STALE_PRICE_TTL_MS.
 * Once the poller is scoped to held/open symbols, rows for the rest of
 * Hyperliquid's universe stop updating; this keeps the table lean instead of
 * leaving hundreds of stale rows behind. The oracle already ignores stale rows,
 * so this is housekeeping, not correctness. The table is bounded by the number
 * of distinct symbols ever traded, so a full scan here is cheap.
 */
export const pruneStalePrices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_PRICE_TTL_MS;
    const rows = await ctx.db.query("marketPrices").collect();
    for (const row of rows) {
      if (row.updatedAt < cutoff) {
        await ctx.db.delete(row._id);
      }
    }
  },
});

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const HL_MAX_RESPONSE_BYTES = 2_000_000;
const HL_FETCH_TIMEOUT_MS = 8_000;
const isAuthSessionActiveRef = makeFunctionReference<
  "query",
  { jti: string; deviceId: string; now: number },
  boolean
>("authData:isAuthSessionActive");

type PriceRow = {
  symbol: string;
  markPx: number;
  markPxExact: string;
  midPx?: number;
  midPxExact?: string;
  funding?: number;
  fundingExact?: string;
  source?: string;
  updatedAt: number;
};

async function fetchPerpsRows(now: number, dex?: "xyz"): Promise<PriceRow[]> {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs", ...(dex ? { dex } : {}) }),
    signal: AbortSignal.timeout(HL_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const contentLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > HL_MAX_RESPONSE_BYTES) {
    return [];
  }
  const body = await res.text();
  if (body.length > HL_MAX_RESPONSE_BYTES) return [];
  try {
    return parseHyperliquidPerpPayload(JSON.parse(body), now);
  } catch {
    return [];
  }
}

async function fetchSpotRows(now: number): Promise<PriceRow[]> {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
    signal: AbortSignal.timeout(HL_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const contentLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > HL_MAX_RESPONSE_BYTES) {
    return [];
  }
  const body = await res.text();
  if (body.length > HL_MAX_RESPONSE_BYTES) return [];
  try {
    return parseHyperliquidSpotPayload(JSON.parse(body), now);
  } catch {
    return [];
  }
}

/**
 * Poll Hyperliquid for perps + spot marks and funding, then upsert. Defensive:
 * any fetch/parse failure is swallowed so the cron never crashes the scheduler.
 */
export const pollHyperliquidPrices = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows: PriceRow[] = [];

    try {
      rows.push(...(await fetchPerpsRows(now)));
    } catch {
      // ignore perps fetch failure
    }

    try {
      rows.push(...(await fetchPerpsRows(now, "xyz")));
    } catch {
      // ignore xyz dex fetch failure
    }

    // Perps marks take precedence for any symbol; only add spot rows for
    // symbols not already covered by perps.
    const seen = new Set(rows.map((r) => normalizeAssetSymbol(r.symbol)));
    try {
      const spotRows = await fetchSpotRows(now);
      for (const row of spotRows) {
        if (seen.has(normalizeAssetSymbol(row.symbol))) continue;
        rows.push(row);
      }
    } catch {
      // ignore spot fetch failure
    }

    if (rows.length === 0) return;

    // Scope writes to only the symbols that actually need a fresh server price:
    // anything currently held or with an open order. Hyperliquid's full universe
    // is hundreds of symbols; nobody reads the prices for the ones no one holds.
    // When nothing is held/open this writes nothing at all.
    const active = new Set(
      await ctx.runQuery(internal.prices.getActiveSymbols, {}),
    );
    if (active.size === 0) return;
    const scoped = rows.filter((r) =>
      active.has(normalizeAssetSymbol(r.symbol)),
    );
    if (scoped.length === 0) return;

    try {
      await ctx.runMutation(internal.prices.upsertMarketPrices, {
        rows: scoped,
      });
    } catch {
      // ignore upsert failure; next poll will retry
    }
  },
});

/**
 * Distinct base symbols that need a fresh server price right now: every symbol
 * with a non-zero position, an open order, or a non-stablecoin spot balance
 * (personal accounts only). The poller refreshes only these so
 * its Database I/O scales with real activity instead of Hyperliquid's full
 * ~330-symbol universe. Stablecoins are intentionally excluded — the oracle
 * values them at 1 via getDemoPrice without any marketPrices row.
 */
export const getActiveSymbols = internalQuery({
  args: {},
  handler: async (ctx) => {
    const symbols = new Set<string>();

    const positions = await ctx.db.query("positions").collect();
    for (const p of positions) {
      if (p.ownerType !== "user" || p.size === 0) continue;
      const s = normalizeAssetSymbol(p.symbol);
      if (s) symbols.add(s);
    }

    const openOrders = await ctx.db
      .query("orders")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    for (const o of openOrders) {
      if (o.ownerType !== "user") continue;
      const s = normalizeAssetSymbol(o.symbol);
      if (s) symbols.add(s);
    }

    const spotBalances = await ctx.db.query("spotBalances").collect();
    for (const b of spotBalances) {
      if (b.ownerType !== "user" || !(b.balance > 0)) continue;
      const s = normalizeAssetSymbol(b.asset);
      if (!s || s === "USDC" || s === "USDT" || s === "DAI" || s === "USD") {
        continue;
      }
      symbols.add(s);
    }

    return Array.from(symbols);
  },
});

/**
 * Lightweight freshness probe used by ensureSymbolFresh (actions can't read the
 * db directly). Returns just the row's updatedAt, or null if there's no row.
 */
export const peekPriceUpdatedAt = internalQuery({
  args: { symbol: v.string() },
  handler: async (ctx, { symbol }) => {
    const s = normalizeAssetSymbol(symbol);
    if (!s) return null;
    const row = await ctx.db
      .query("marketPrices")
      .withIndex("by_symbol", (q) => q.eq("symbol", s))
      .first();
    return row ? row.updatedAt : null;
  },
});

/**
 * On-demand price warm-up for a single symbol.
 *
 * The cron only refreshes symbols that are already held/open, so the first time
 * a user trades a brand-new symbol there may be no fresh marketPrices row yet.
 * The client calls this right before placing an order so settlement has an
 * authoritative price. Cheap and self-throttling: it skips the Hyperliquid
 * fetch entirely when the row is already fresh, and only ever writes that one
 * row. Best-effort — any failure is swallowed and the order path fails closed
 * until a fresh row exists. Gated to authenticated callers so it can't
 * be used to amplify writes/fetches anonymously.
 */
export const ensureSymbolFresh = action({
  args: { symbol: v.string() },
  handler: async (ctx, { symbol }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;

    const jti = typeof identity.jti === "string" ? identity.jti : null;
    const deviceId =
      typeof identity.device_id === "string" ? identity.device_id : null;
    if (
      !jti ||
      !deviceId ||
      !(await ctx.runQuery(isAuthSessionActiveRef, {
        jti,
        deviceId,
        now: Date.now(),
      }))
    ) {
      return;
    }

    const target = normalizeAssetSymbol(symbol);
    if (!target) return;

    const now = Date.now();
    const updatedAt = await ctx.runQuery(internal.prices.peekPriceUpdatedAt, {
      symbol: target,
    });
    // Already comfortably fresh — no fetch, no write.
    if (updatedAt !== null && now - updatedAt < FRESHNESS_MS / 2) return;

    let row: PriceRow | undefined;
    try {
      const isXyz = target.startsWith("xyz:");
      const perps = await fetchPerpsRows(now, isXyz ? "xyz" : undefined);
      row = perps.find((r) => normalizeAssetSymbol(r.symbol) === target);
      if (!row && !isXyz) {
        const spot = await fetchSpotRows(now);
        row = spot.find((r) => normalizeAssetSymbol(r.symbol) === target);
      }
    } catch {
      return;
    }
    if (!row) return;

    try {
      await ctx.runMutation(internal.prices.upsertMarketPrices, {
        rows: [row],
      });
    } catch {
      // ignore; the order path will fail closed until the next successful refresh
    }
  },
});
