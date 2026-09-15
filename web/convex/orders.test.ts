import { describe, expect, test } from "bun:test";
import * as orders from "./orders";
import { getMetrics } from "./portfolio";
import { listTrades } from "./trades";

// Exercise the registered handlers with an authenticated operator and archived data.
// A legacy vault's userId may still name the operator; ownerType must remain authoritative.
const contextForOrder = (ownerType: string, ownerId: string) => {
  const patches: unknown[] = [];
  const order = {
    _id: "order-1",
    ownerType,
    ownerId,
    userId: "user-1",
    status: "open",
  };
  const ctx = {
    auth: {
      getUserIdentity: async () => ({
        tokenIdentifier: "identity-1",
        jti: "session-1",
        device_id: "device-1",
      }),
    },
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          unique: async () =>
            table === "authSessions"
              ? { deviceId: "device-1", accessExpiresAt: Date.now() + 60_000 }
              : { _id: "user-1" },
        }),
      }),
      get: async () => order,
      patch: async (...args: unknown[]) => {
        patches.push(args);
      },
    },
  };
  return { ctx, patches };
};

type RegisteredHandler = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  exportArgs: () => string;
};
const registered = (fn: unknown) => fn as RegisteredHandler;

describe("personal trading after pooled vault retirement", () => {
  test("public trading and portfolio APIs no longer accept a vault account", () => {
    for (const fn of [...Object.values(orders), getMetrics, listTrades]) {
      const args = JSON.parse(registered(fn).exportArgs());
      expect(args.value).not.toHaveProperty("vaultId");
    }
  });

  test("an operator cannot cancel or fill an archived vault order", async () => {
    for (const fn of [orders.cancelOrder, orders.fillOpenOrder]) {
      const { ctx, patches } = contextForOrder("vault", "vault-1");
      await registered(fn)._handler(ctx, { orderId: "order-1" });
      expect(patches).toEqual([]);
    }
  });

  test("another user's order remains inaccessible", async () => {
    for (const fn of [orders.cancelOrder, orders.fillOpenOrder]) {
      const { ctx, patches } = contextForOrder("user", "user-2");
      await registered(fn)._handler(ctx, { orderId: "order-1" });
      expect(patches).toEqual([]);
    }
  });

  test("the authenticated user's personal order can still be cancelled", async () => {
    const { ctx, patches } = contextForOrder("user", "user-1");
    await registered(orders.cancelOrder)._handler(ctx, { orderId: "order-1" });
    expect(patches).toEqual([
      ["order-1", { status: "cancelled", updatedAt: expect.any(Number) }],
    ]);
  });
});
