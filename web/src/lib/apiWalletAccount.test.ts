import { describe, expect, test } from "bun:test";
import { resolveApiWalletAccount } from "./apiWalletAccount";
import {
  connectHyperliquid,
  hyperliquidConnectionStatus,
} from "../stores/hyperliquidExecution";

const account = `0x${"ab".repeat(20)}`;
const approvedRole = { role: "agent", data: { user: account } };

describe("API key account detection", () => {
  test("uses the account reported by Hyperliquid without a manual address", () => {
    expect(resolveApiWalletAccount(approvedRole)).toBe(account);
    expect(
      resolveApiWalletAccount({
        role: "agent",
        data: { user: `0x${"AB".repeat(20)}` },
      }),
    ).toBe(account);
  });

  test("refuses wallet keys, unapproved keys and malformed account responses", () => {
    for (const role of ["user", "missing", "vault", "subAccount"]) {
      expect(() =>
        resolveApiWalletAccount({ role, data: { user: account } }),
      ).toThrow("not an approved trading API key");
    }
    for (const role of [
      null,
      {},
      { role: "agent" },
      { role: "agent", data: { user: "0x123" } },
    ]) {
      expect(() => resolveApiWalletAccount(role)).toThrow();
    }
  });

  test("saved credentials must still match the originally verified account", () => {
    expect(resolveApiWalletAccount(approvedRole, account)).toBe(account);
    expect(() =>
      resolveApiWalletAccount(approvedRole, `0x${"cd".repeat(20)}`),
    ).toThrow("different account");
  });

  test("legacy testnet connections cannot reach the exchange or become active", async () => {
    const result = await connectHyperliquid({
      network: "testnet",
      apiWalletPrivateKey: `0x${"ab".repeat(32)}`,
    });
    expect(result.ok).toBe(false);
    expect(hyperliquidConnectionStatus()).toBe("disconnected");
  });

  test("the one-field connection flow validates incomplete keys before any request", async () => {
    const result = await connectHyperliquid({
      apiWalletPrivateKey: "incomplete",
    });
    expect(result).toEqual({
      ok: false,
      error:
        "That key looks incomplete. Copy the full API key from Hyperliquid’s API settings.",
    });
    expect(hyperliquidConnectionStatus()).toBe("disconnected");
  });
});
