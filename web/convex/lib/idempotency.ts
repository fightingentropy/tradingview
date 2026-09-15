import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizeIdempotencyKey } from "./accounting";

type OwnerType = "user";

const ownerKey = (ownerType: OwnerType, ownerId: Id<"users">) =>
  `${ownerType}:${ownerId}`;

export const requestFingerprint = (
  fields: Record<string, string | number | boolean | null | undefined>,
) =>
  Object.entries(fields)
    .filter(
      (entry): entry is [string, string | number | boolean | null] =>
        entry[1] !== undefined,
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("&");

export const readOperationReceipt = async <T>(
  ctx: MutationCtx,
  input: {
    ownerType: OwnerType;
    ownerId: Id<"users">;
    operation: string;
    idempotencyKey?: string;
    fingerprint: string;
  },
): Promise<{ key?: string; result?: T }> => {
  if (!input.idempotencyKey) return {};
  let key: string;
  try {
    key = normalizeIdempotencyKey(input.idempotencyKey);
  } catch (error) {
    throw new ConvexError(
      error instanceof Error ? error.message : "Invalid idempotency key.",
    );
  }
  const owner = ownerKey(input.ownerType, input.ownerId);
  const existing = await ctx.db
    .query("operationReceipts")
    .withIndex("by_owner_key", (query) =>
      query.eq("ownerKey", owner).eq("idempotencyKey", key),
    )
    .unique();
  if (!existing) return { key };
  if (
    existing.operation !== input.operation ||
    existing.requestFingerprint !== input.fingerprint
  ) {
    throw new ConvexError(
      "Idempotency key was already used for a different request.",
    );
  }
  return { key, result: JSON.parse(existing.resultJson) as T };
};

export const writeOperationReceipt = async <T>(
  ctx: MutationCtx,
  input: {
    ownerType: OwnerType;
    ownerId: Id<"users">;
    operation: string;
    idempotencyKey?: string;
    fingerprint: string;
    result: T;
  },
) => {
  if (!input.idempotencyKey) return;
  await ctx.db.insert("operationReceipts", {
    ownerKey: ownerKey(input.ownerType, input.ownerId),
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    requestFingerprint: input.fingerprint,
    resultJson: JSON.stringify(input.result),
    createdAt: Date.now(),
  });
};

export const writeLedgerEvent = async (
  ctx: MutationCtx,
  input: {
    ownerType: OwnerType;
    ownerId: Id<"users">;
    operation: string;
    asset: string;
    amountExact: string;
    precision: number;
    accountingVersion: string;
    roundingRule: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey?: string;
  },
) => {
  await ctx.db.insert("ledgerEvents", {
    ownerKey: ownerKey(input.ownerType, input.ownerId),
    operation: input.operation,
    asset: input.asset,
    amountExact: input.amountExact,
    precision: input.precision,
    accountingVersion: input.accountingVersion,
    roundingRule: input.roundingRule,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
    createdAt: Date.now(),
  });
};
