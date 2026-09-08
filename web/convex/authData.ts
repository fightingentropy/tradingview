import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getAccountByEmail = internalQuery({
  args: { emailLower: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authAccounts")
      .withIndex("by_email", (q) => q.eq("emailLower", args.emailLower))
      .unique();
  },
});

export const getAccountById = internalQuery({
  args: { accountId: v.id("authAccounts") },
  handler: async (ctx, args) => await ctx.db.get(args.accountId),
});

export const isAuthSessionActive = internalQuery({
  args: { jti: v.string(), deviceId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_jti", (query) => query.eq("jti", args.jti))
      .unique();
    return !!(
      session &&
      session.deviceId === args.deviceId &&
      session.revokedAt === undefined &&
      session.accessExpiresAt > args.now
    );
  },
});

export const createAccount = internalMutation({
  args: {
    email: v.string(),
    emailLower: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    passwordN: v.optional(v.number()),
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authAccounts")
      .withIndex("by_email", (query) =>
        query.eq("emailLower", args.emailLower),
      )
      .first();
    if (existing) throw new ConvexError("Email already in use.");
    return await ctx.db.insert("authAccounts", args);
  },
});

// --- Rate limiting helpers (per emailLower key) ---

export const getRateLimit = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authRateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
  },
});

// Record a failed attempt. Implements a fixed window with exponential
// backoff/lockout once the attempt threshold is exceeded.
export const recordFailedAttempt = internalMutation({
  args: {
    key: v.string(),
    now: v.number(),
    windowMs: v.number(),
    maxAttempts: v.number(),
    baseLockMs: v.number(),
    maxLockMs: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authRateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    // Start a fresh window if none exists or the previous window has elapsed
    // and the key is not currently locked.
    if (
      !existing ||
      (args.now - existing.windowStart > args.windowMs &&
        (existing.lockedUntil === undefined ||
          existing.lockedUntil <= args.now))
    ) {
      if (existing) {
        await ctx.db.patch(existing._id, {
          windowStart: args.now,
          attempts: 1,
          lockedUntil: undefined,
        });
      } else {
        await ctx.db.insert("authRateLimits", {
          key: args.key,
          windowStart: args.now,
          attempts: 1,
        });
      }
      return { attempts: 1, lockedUntil: null };
    }

    const attempts = existing.attempts + 1;
    let lockedUntil = existing.lockedUntil;
    if (attempts > args.maxAttempts) {
      // Exponential backoff based on how far past the threshold we are.
      const over = attempts - args.maxAttempts - 1;
      const lockMs = Math.min(
        args.baseLockMs * Math.pow(2, over),
        args.maxLockMs,
      );
      lockedUntil = args.now + lockMs;
    }
    await ctx.db.patch(existing._id, { attempts, lockedUntil });
    return { attempts, lockedUntil: lockedUntil ?? null };
  },
});

// Reset the rate limit for a key on a successful auth.
export const clearRateLimit = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authRateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const updateLoginTimestamp = internalMutation({
  args: {
    accountId: v.id("authAccounts"),
    lastLoginAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, { lastLoginAt: args.lastLoginAt });
  },
});

export const acquireAuthWorkLease = internalMutation({
  args: {
    leaseId: v.string(),
    now: v.number(),
    durationMs: v.number(),
    maxConcurrent: v.number(),
  },
  handler: async (ctx, args) => {
    const leases = await ctx.db.query("authWorkLeases").collect();
    let live = 0;
    for (const lease of leases) {
      if (lease.expiresAt <= args.now) {
        await ctx.db.delete(lease._id);
      } else {
        live += 1;
      }
    }
    if (live >= args.maxConcurrent) return false;
    await ctx.db.insert("authWorkLeases", {
      leaseId: args.leaseId,
      expiresAt: args.now + args.durationMs,
    });
    return true;
  },
});

export const releaseAuthWorkLease = internalMutation({
  args: { leaseId: v.string() },
  handler: async (ctx, args) => {
    const lease = await ctx.db
      .query("authWorkLeases")
      .withIndex("by_lease", (query) => query.eq("leaseId", args.leaseId))
      .first();
    if (lease) await ctx.db.delete(lease._id);
  },
});

export const createAuthSession = internalMutation({
  args: {
    accountId: v.id("authAccounts"),
    jti: v.string(),
    deviceId: v.string(),
    refreshTokenHash: v.string(),
    createdAt: v.number(),
    accessExpiresAt: v.number(),
    refreshExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("authSessions", {
      ...args,
      lastSeenAt: args.createdAt,
    });
  },
});

export const rotateAuthSession = internalMutation({
  args: {
    refreshTokenHash: v.string(),
    deviceId: v.string(),
    newJti: v.string(),
    newRefreshTokenHash: v.string(),
    now: v.number(),
    accessExpiresAt: v.number(),
    refreshExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_refresh_hash", (query) =>
        query.eq("refreshTokenHash", args.refreshTokenHash),
      )
      .unique();
    if (
      !session ||
      session.deviceId !== args.deviceId ||
      session.revokedAt !== undefined ||
      session.refreshExpiresAt <= args.now
    ) {
      return null;
    }
    await ctx.db.patch(session._id, {
      jti: args.newJti,
      refreshTokenHash: args.newRefreshTokenHash,
      lastSeenAt: args.now,
      accessExpiresAt: args.accessExpiresAt,
      refreshExpiresAt: args.refreshExpiresAt,
    });
    return session.accountId;
  },
});

export const revokeAuthSession = internalMutation({
  args: { jti: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_jti", (query) => query.eq("jti", args.jti))
      .unique();
    if (session) {
      await ctx.db.patch(session._id, { revokedAt: args.now });
    }
  },
});

export const pruneExpiredAuthState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const receiptCutoff = now - 7 * 24 * 60 * 60 * 1000;
    const expiredSessions = await ctx.db
      .query("authSessions")
      .withIndex("by_refresh_expiry", (query) =>
        query.lt("refreshExpiresAt", now),
      )
      .take(500);
    for (const session of expiredSessions) await ctx.db.delete(session._id);

    const staleReceipts = await ctx.db
      .query("operationReceipts")
      .withIndex("by_created", (query) =>
        query.lt("createdAt", receiptCutoff),
      )
      .take(500);
    for (const receipt of staleReceipts) await ctx.db.delete(receipt._id);

    const expiredLeases = await ctx.db
      .query("authWorkLeases")
      .withIndex("by_expiry", (query) => query.lt("expiresAt", now))
      .take(500);
    for (const lease of expiredLeases) await ctx.db.delete(lease._id);

    const expiredRateLimits = await ctx.db
      .query("authRateLimits")
      .withIndex("by_window_start", (query) =>
        query.lt("windowStart", now - 15 * 60 * 1000),
      )
      .take(500);
    let rateLimits = 0;
    for (const limit of expiredRateLimits) {
      if (limit.lockedUntil === undefined || limit.lockedUntil <= now) {
        await ctx.db.delete(limit._id);
        rateLimits += 1;
      }
    }
    return {
      sessions: expiredSessions.length,
      receipts: staleReceipts.length,
      leases: expiredLeases.length,
      rateLimits,
    };
  },
});
