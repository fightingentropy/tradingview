import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const getIdentity = async (ctx: MutationCtx | QueryCtx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return identity;
};

type IdentityClaims = { [key: string]: unknown };

const stringClaim = (identity: IdentityClaims, key: string) => {
  const value = identity[key];
  return typeof value === "string" && value ? value : undefined;
};

const isSessionActive = async (
  ctx: MutationCtx | QueryCtx,
  identity: IdentityClaims,
) => {
  const jti = stringClaim(identity, "jti");
  const deviceId = stringClaim(identity, "device_id");
  if (!jti || !deviceId) return false;
  const session = await ctx.db
    .query("authSessions")
    .withIndex("by_jti", (query) => query.eq("jti", jti))
    .unique();
  return !!(
    session &&
    session.deviceId === deviceId &&
    session.revokedAt === undefined &&
    session.accessExpiresAt > Date.now()
  );
};

export const requireActiveIdentity = async (
  ctx: MutationCtx | QueryCtx,
) => {
  const identity = await getIdentity(ctx);
  if (!identity) {
    throw new ConvexError("Not authenticated.");
  }
  if (!(await isSessionActive(ctx, identity as unknown as IdentityClaims))) {
    throw new ConvexError("Session has been revoked.");
  }
  return identity;
};

export const getAuthUser = async (ctx: MutationCtx | QueryCtx) => {
  const identity = await getIdentity(ctx);
  if (!identity) return null;
  if (!(await isSessionActive(ctx, identity as unknown as IdentityClaims))) {
    return null;
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  return user;
};

// The JWT "iat" (issued-at) claim is surfaced as a custom claim on the
// identity. It is expressed in SECONDS since the epoch.
const getTokenIssuedAtMs = (identity: {
  [key: string]: unknown;
}): number | undefined => {
  const raw = identity.iat;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw * 1000;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed * 1000;
  }
  return undefined;
};

export const requireAuthUser = async (ctx: MutationCtx | QueryCtx) => {
  const identity = await requireActiveIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) {
    throw new ConvexError("User not found.");
  }
  // Token revocation: reject tokens issued before tokenValidAfter (ms).
  if (typeof user.tokenValidAfter === "number") {
    const issuedAtMs = getTokenIssuedAtMs(
      identity as unknown as { [key: string]: unknown },
    );
    // If we cannot determine when the token was issued, fail closed once a
    // revocation point has been set.
    if (issuedAtMs === undefined || issuedAtMs < user.tokenValidAfter) {
      throw new ConvexError("Session has been revoked.");
    }
  }
  return user;
};
