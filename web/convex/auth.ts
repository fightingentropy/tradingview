"use node";

import {
  createHash,
  createSign,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "crypto";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";

type AuthAccount = {
  _id: Id<"authAccounts">;
  email: string;
  emailLower: string;
  passwordHash: string;
  passwordSalt: string;
  passwordN?: number;
  name?: string;
};

type AuthSession = {
  token: string;
  expiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  deviceId: string;
  user: {
    email: string;
    name: string;
  };
};

const TOKEN_TTL_SECONDS = 60 * 15;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;
const MAX_PASSWORD_LENGTH = 128;
// scrypt cost parameter. New accounts use 1<<17; legacy hashes without a
// stored passwordN default to 16384 (the Node default) for back-compat.
const SCRYPT_N_NEW = 1 << 17;
const SCRYPT_N_DEFAULT = 16384;
// scryptSync enforces an internal memory limit; raising N requires a larger
// maxmem. 256 MiB is comfortably above the requirement for N = 1<<17.
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

// Rate-limit configuration: lock out after 5 failures within the window,
// with exponential backoff on continued failures.
const RL_WINDOW_MS = 15 * 60 * 1000;
const RL_MAX_ATTEMPTS = 5;
const RL_BASE_LOCK_MS = 60 * 1000;
const RL_MAX_LOCK_MS = 60 * 60 * 1000;
const GLOBAL_RL_WINDOW_MS = 60 * 1000;
const GLOBAL_SIGNIN_MAX_ATTEMPTS = 40;
const GLOBAL_SIGNUP_MAX_ATTEMPTS = 12;
const AUTH_MAX_CONCURRENT_SCRYPT = 4;
const AUTH_LEASE_MS = 30 * 1000;

// A fixed dummy salt/hash used to run scrypt when an account is missing on
// signIn, so response timing does not reveal account existence.
const DUMMY_SALT = Buffer.from(
  "0000000000000000000000000000000000000000000000000000000000000000",
  "hex",
);

const getAccountByEmailRef = makeFunctionReference<
  "query",
  { emailLower: string },
  AuthAccount | null
>("authData:getAccountByEmail");
const getAccountByIdRef = makeFunctionReference<
  "query",
  { accountId: Id<"authAccounts"> },
  AuthAccount | null
>("authData:getAccountById");
const createAccountRef = makeFunctionReference<
  "mutation",
  {
    email: string;
    emailLower: string;
    passwordHash: string;
    passwordSalt: string;
    passwordN?: number;
    name?: string;
    createdAt: number;
  },
  Id<"authAccounts">
>("authData:createAccount");
const updateLoginTimestampRef = makeFunctionReference<
  "mutation",
  { accountId: Id<"authAccounts">; lastLoginAt: number },
  void
>("authData:updateLoginTimestamp");
const recordFailedAttemptRef = makeFunctionReference<
  "mutation",
  {
    key: string;
    now: number;
    windowMs: number;
    maxAttempts: number;
    baseLockMs: number;
    maxLockMs: number;
  },
  { attempts: number; lockedUntil: number | null }
>("authData:recordFailedAttempt");
const clearRateLimitRef = makeFunctionReference<
  "mutation",
  { key: string },
  void
>("authData:clearRateLimit");
const acquireAuthWorkLeaseRef = makeFunctionReference<
  "mutation",
  {
    leaseId: string;
    now: number;
    durationMs: number;
    maxConcurrent: number;
  },
  boolean
>("authData:acquireAuthWorkLease");
const releaseAuthWorkLeaseRef = makeFunctionReference<
  "mutation",
  { leaseId: string },
  void
>("authData:releaseAuthWorkLease");
const createAuthSessionRef = makeFunctionReference<
  "mutation",
  {
    accountId: Id<"authAccounts">;
    jti: string;
    deviceId: string;
    refreshTokenHash: string;
    createdAt: number;
    accessExpiresAt: number;
    refreshExpiresAt: number;
  },
  void
>("authData:createAuthSession");
const rotateAuthSessionRef = makeFunctionReference<
  "mutation",
  {
    refreshTokenHash: string;
    deviceId: string;
    newJti: string;
    newRefreshTokenHash: string;
    now: number;
    accessExpiresAt: number;
    refreshExpiresAt: number;
  },
  Id<"authAccounts"> | null
>("authData:rotateAuthSession");

const normalizePem = (value: string) =>
  value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;

const getAuthConfig = () => {
  const issuer = process.env.CUSTOM_AUTH_ISSUER;
  const audience = process.env.CUSTOM_AUTH_AUDIENCE;
  const privateKeyRaw = process.env.CUSTOM_AUTH_PRIVATE_KEY;
  if (!issuer) {
    throw new ConvexError("CUSTOM_AUTH_ISSUER is not set.");
  }
  if (!privateKeyRaw) {
    throw new ConvexError("CUSTOM_AUTH_PRIVATE_KEY is not set.");
  }
  const privateKey = normalizePem(privateKeyRaw);
  return {
    issuer,
    audience,
    privateKey,
  };
};

const base64Url = (input: string | Buffer) =>
  Buffer.from(input).toString("base64url");

const getKeyId = () => {
  const direct = process.env.CUSTOM_AUTH_KEY_ID;
  if (direct) return direct;
  const jwkRaw = process.env.CUSTOM_AUTH_PUBLIC_JWK;
  if (!jwkRaw) return undefined;
  try {
    const parsed = JSON.parse(jwkRaw) as { kid?: string };
    return typeof parsed.kid === "string" ? parsed.kid : undefined;
  } catch {
    return undefined;
  }
};

const signJwt = (payload: Record<string, unknown>) => {
  const { privateKey } = getAuthConfig();
  const header: Record<string, string> = {
    alg: "RS256",
    typ: "JWT",
  };
  const keyId = getKeyId();
  if (keyId) {
    header.kid = keyId;
  }
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${data}.${base64Url(signature)}`;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const normalizeName = (name?: string) => {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
};

const displayNameFor = (account: { name?: string; email: string }) =>
  account.name?.trim() || account.email.split("@")[0];

const scryptWithN = (password: string, salt: Buffer, N: number) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      PASSWORD_KEY_BYTES,
      { N, maxmem: SCRYPT_MAXMEM },
      (error, key) => {
        if (error) reject(error);
        else resolve(key as Buffer);
      },
    );
  });

const createPasswordHash = async (password: string) => {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = await scryptWithN(password, salt, SCRYPT_N_NEW);
  return {
    passwordSalt: salt.toString("base64"),
    passwordHash: hash.toString("base64"),
    passwordN: SCRYPT_N_NEW,
  };
};

const verifyPassword = async (
  password: string,
  passwordSalt: string,
  passwordHash: string,
  passwordN?: number,
) => {
  const salt = Buffer.from(passwordSalt, "base64");
  const expected = Buffer.from(passwordHash, "base64");
  const N = passwordN ?? SCRYPT_N_DEFAULT;
  if (
    salt.length !== PASSWORD_SALT_BYTES ||
    expected.length !== PASSWORD_KEY_BYTES ||
    (N !== SCRYPT_N_DEFAULT && N !== SCRYPT_N_NEW)
  ) {
    return false;
  }
  const actual = await scryptWithN(password, salt, N);
  return timingSafeEqual(expected, actual);
};

// Run a scrypt against a dummy salt to keep signIn timing constant when the
// account is missing. The result is intentionally discarded.
const runDummyScrypt = async (password: string) => {
  try {
    await scryptWithN(password, DUMMY_SALT, SCRYPT_N_NEW);
  } catch {
    // ignore — purely a timing equalizer
  }
};

const normalizeDeviceId = (value: string) => {
  const deviceId = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(deviceId)) {
    throw new ConvexError("Invalid device identifier.");
  }
  return deviceId;
};

const hashRefreshToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("base64url");

const consumeAuthBudget = async (
  ctx: ActionCtx,
  key: string,
  now: number,
  windowMs: number,
  maxAttempts: number,
) => {
  const result = await ctx.runMutation(recordFailedAttemptRef, {
    key,
    now,
    windowMs,
    maxAttempts,
    baseLockMs: RL_BASE_LOCK_MS,
    maxLockMs: RL_MAX_LOCK_MS,
  });
  if (result.lockedUntil !== null && result.lockedUntil > now) {
    const seconds = Math.ceil((result.lockedUntil - now) / 1000);
    throw new ConvexError(
      `Too many attempts. Try again in ${seconds} seconds.`,
    );
  }
};

const withScryptLease = async <T>(
  ctx: ActionCtx,
  operation: () => Promise<T>,
): Promise<T> => {
  const leaseId = randomBytes(18).toString("base64url");
  const acquired = await ctx.runMutation(acquireAuthWorkLeaseRef, {
    leaseId,
    now: Date.now(),
    durationMs: AUTH_LEASE_MS,
    maxConcurrent: AUTH_MAX_CONCURRENT_SCRYPT,
  });
  if (!acquired) {
    throw new ConvexError("Authentication is busy. Try again shortly.");
  }
  try {
    return await operation();
  } finally {
    await ctx.runMutation(releaseAuthWorkLeaseRef, { leaseId });
  }
};

const verifyTurnstile = async (token?: string) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return;
  if (!token || token.length > 2048) {
    throw new ConvexError("Complete the signup verification challenge.");
  }
  const body = new URLSearchParams({ secret, response: token });
  let response: Response;
  try {
    response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    throw new ConvexError("Signup verification is temporarily unavailable.");
  }
  let result: {
    success?: unknown;
    hostname?: unknown;
    action?: unknown;
  };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw new ConvexError("Signup verification is temporarily unavailable.");
  }
  const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
  if (
    !response.ok ||
    result.success !== true ||
    result.action !== "signup" ||
    (expectedHostname && result.hostname !== expectedHostname)
  ) {
    throw new ConvexError("Signup verification failed.");
  }
};

const buildAccessToken = (
  account: AuthAccount,
  deviceId: string,
  jti: string,
  nowSeconds: number,
  expSeconds: number,
) => {
  const { issuer, audience } = getAuthConfig();
  const displayName = displayNameFor(account);
  const payload: Record<string, unknown> = {
    iss: issuer,
    sub: account._id,
    iat: nowSeconds,
    exp: expSeconds,
    jti,
    device_id: deviceId,
    name: displayName,
    email: account.email,
  };
  if (audience) payload.aud = audience;
  return { token: signJwt(payload), displayName };
};

const buildSession = async (
  ctx: ActionCtx,
  account: AuthAccount,
  deviceId: string,
): Promise<AuthSession> => {
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const exp = now + TOKEN_TTL_SECONDS;
  const jti = randomBytes(18).toString("base64url");
  const refreshToken = randomBytes(32).toString("base64url");
  const refreshExpiresAt = nowMs + REFRESH_TOKEN_TTL_MS;
  const { token, displayName } = buildAccessToken(
    account,
    deviceId,
    jti,
    now,
    exp,
  );
  await ctx.runMutation(createAuthSessionRef, {
    accountId: account._id,
    jti,
    deviceId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    createdAt: nowMs,
    accessExpiresAt: exp * 1000,
    refreshExpiresAt,
  });
  return {
    token,
    expiresAt: exp * 1000,
    refreshToken,
    refreshExpiresAt,
    deviceId,
    user: {
      email: account.email,
      name: displayName,
    },
  };
};

export const signUp = action({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
    deviceId: v.string(),
    turnstileToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const emailLower = normalizeEmail(args.email);
    const deviceId = normalizeDeviceId(args.deviceId);
    if (!isValidEmail(emailLower)) {
      throw new ConvexError("Enter a valid email address.");
    }
    if (args.password.length < 8) {
      throw new ConvexError("Password must be at least 8 characters.");
    }
    // Reject overly long passwords BEFORE scrypt to prevent CPU DoS.
    if (args.password.length > MAX_PASSWORD_LENGTH) {
      throw new ConvexError(
        `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
      );
    }

    const now = Date.now();
    if (
      process.env.TURNSTILE_SECRET_KEY &&
      (!args.turnstileToken || args.turnstileToken.length > 2048)
    ) {
      throw new ConvexError("Complete the signup verification challenge.");
    }
    // Consume the global budget before any outbound verification request or
    // expensive password hashing. Missing/malformed challenge tokens are
    // rejected above without consuming shared capacity.
    await consumeAuthBudget(
      ctx,
      "auth:global:signup",
      now,
      GLOBAL_RL_WINDOW_MS,
      GLOBAL_SIGNUP_MAX_ATTEMPTS,
    );
    await verifyTurnstile(args.turnstileToken);
    // The email budget prevents concentrated abuse of one account identity.
    await consumeAuthBudget(
      ctx,
      `auth:email:${emailLower}`,
      now,
      RL_WINDOW_MS,
      RL_MAX_ATTEMPTS,
    );

    const existing = await ctx.runQuery(getAccountByEmailRef, {
      emailLower,
    });
    if (existing) {
      throw new ConvexError("Email already in use.");
    }

    const { passwordHash, passwordSalt, passwordN } = await withScryptLease(
      ctx,
      () => createPasswordHash(args.password),
    );
    const name = normalizeName(args.name);
    const accountId = await ctx.runMutation(createAccountRef, {
      email: args.email.trim(),
      emailLower,
      passwordHash,
      passwordSalt,
      passwordN,
      name,
      createdAt: now,
    });

    await ctx.runMutation(updateLoginTimestampRef, {
      accountId,
      lastLoginAt: now,
    });

    // Successful sign-up clears any accumulated rate-limit state.
    await ctx.runMutation(clearRateLimitRef, {
      key: `auth:email:${emailLower}`,
    });

    return await buildSession(
      ctx,
      {
        _id: accountId,
        email: args.email.trim(),
        emailLower,
        passwordHash,
        passwordSalt,
        passwordN,
        name,
      },
      deviceId,
    );
  },
});

export const signIn = action({
  args: {
    email: v.string(),
    password: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const emailLower = normalizeEmail(args.email);
    const deviceId = normalizeDeviceId(args.deviceId);
    if (!isValidEmail(emailLower)) {
      throw new ConvexError("Enter a valid email address.");
    }
    // Reject overly long passwords BEFORE scrypt to prevent CPU DoS.
    if (args.password.length > MAX_PASSWORD_LENGTH) {
      throw new ConvexError("Invalid email or password.");
    }

    const now = Date.now();
    await consumeAuthBudget(
      ctx,
      "auth:global:signin",
      now,
      GLOBAL_RL_WINDOW_MS,
      GLOBAL_SIGNIN_MAX_ATTEMPTS,
    );
    await consumeAuthBudget(
      ctx,
      `auth:email:${emailLower}`,
      now,
      RL_WINDOW_MS,
      RL_MAX_ATTEMPTS,
    );

    const account = await ctx.runQuery(getAccountByEmailRef, {
      emailLower,
    });

    const ok = await withScryptLease(ctx, async () => {
      if (!account) {
        // Constant-time: run a dummy scrypt so timing does not reveal that the
        // account does not exist.
        await runDummyScrypt(args.password);
        return false;
      }
      return await verifyPassword(
        args.password,
        account.passwordSalt,
        account.passwordHash,
        account.passwordN,
      );
    });

    if (!account || !ok) {
      throw new ConvexError("Invalid email or password.");
    }

    await ctx.runMutation(updateLoginTimestampRef, {
      accountId: account._id,
      lastLoginAt: now,
    });

    // Successful sign-in resets the rate limit.
    await ctx.runMutation(clearRateLimitRef, {
      key: `auth:email:${emailLower}`,
    });

    return await buildSession(ctx, account, deviceId);
  },
});

export const refreshSession = action({
  args: { refreshToken: v.string(), deviceId: v.string() },
  handler: async (ctx, args): Promise<AuthSession> => {
    const deviceId = normalizeDeviceId(args.deviceId);
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(args.refreshToken)) {
      throw new ConvexError("Session refresh failed.");
    }
    const nowMs = Date.now();
    await consumeAuthBudget(
      ctx,
      "auth:global:refresh",
      nowMs,
      GLOBAL_RL_WINDOW_MS,
      120,
    );

    const newJti = randomBytes(18).toString("base64url");
    const newRefreshToken = randomBytes(32).toString("base64url");
    const nowSeconds = Math.floor(nowMs / 1000);
    const expSeconds = nowSeconds + TOKEN_TTL_SECONDS;
    const refreshExpiresAt = nowMs + REFRESH_TOKEN_TTL_MS;
    const accountId = await ctx.runMutation(rotateAuthSessionRef, {
      refreshTokenHash: hashRefreshToken(args.refreshToken),
      deviceId,
      newJti,
      newRefreshTokenHash: hashRefreshToken(newRefreshToken),
      now: nowMs,
      accessExpiresAt: expSeconds * 1000,
      refreshExpiresAt,
    });
    if (!accountId) {
      throw new ConvexError("Session refresh failed.");
    }
    const account = await ctx.runQuery(getAccountByIdRef, { accountId });
    if (!account) {
      throw new ConvexError("Session refresh failed.");
    }
    const { token, displayName } = buildAccessToken(
      account,
      deviceId,
      newJti,
      nowSeconds,
      expSeconds,
    );
    return {
      token,
      expiresAt: expSeconds * 1000,
      refreshToken: newRefreshToken,
      refreshExpiresAt,
      deviceId,
      user: { email: account.email, name: displayName },
    };
  },
});
