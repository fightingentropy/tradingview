import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { restoreSavedApiWalletOnStartup, unlockSavedApiWallet } from "./apiWalletConnection";
import * as execution from "./hyperliquidExecution";
import * as vault from "./apiWalletVault";
import * as session from "./apiWalletSession";
import { passkeyRequirement, setPasskeyRequirement } from "./apiWalletSession";

const initialRequirement = passkeyRequirement();
afterEach(() => {
  mock.restore();
  setPasskeyRequirement(initialRequirement);
});

function mockSavedConnection(reloadGraceReady: boolean) {
  const payload: vault.VaultPayload = {
    version: 1,
    network: "mainnet",
    masterAddress: `0x${"1".repeat(40)}`,
    agentAddress: `0x${"2".repeat(40)}`,
    apiWalletPrivateKey: `0x${"3".repeat(64)}`,
  };
  spyOn(vault, "hasSavedApiWalletVault").mockReturnValue(true);
  spyOn(vault, "apiWalletVaultMetadata").mockReturnValue({
    network: payload.network, masterAddress: payload.masterAddress,
    agentAddress: payload.agentAddress, createdAt: 1,
  });
  spyOn(vault, "apiWalletVaultRevocationEpoch").mockReturnValue(0);
  spyOn(execution, "hyperliquidConnectionStatus").mockReturnValue("disconnected");
  const connect = spyOn(execution, "connectHyperliquid").mockResolvedValue({ ok: true });
  const unlock = spyOn(vault, "unlockApiWalletVault").mockResolvedValue({
    ok: true, payload, vaultId: "test-vault", reloadGraceReady,
  });
  return { connect, unlock, payload };
}

test("a temporary reload-session failure keeps the selected hour after a verified unlock", async () => {
  setPasskeyRequirement("one-hour");
  const { connect, payload } = mockSavedConnection(false);
  expect(await unlockSavedApiWallet()).toEqual({ ok: true });
  expect(connect).toHaveBeenCalledTimes(1);
  expect(passkeyRequirement()).toBe("one-hour");
  expect(payload.apiWalletPrivateKey).toBe("0x");
});

test("startup verifies again after session loss without permanently changing the interval", async () => {
  setPasskeyRequirement("one-hour");
  const { connect, unlock } = mockSavedConnection(false);
  spyOn(vault, "initializeApiWalletVault").mockResolvedValue();
  spyOn(vault, "restoreApiWalletVaultSession").mockResolvedValue({ ok: false });
  await restoreSavedApiWalletOnStartup();
  expect(unlock).toHaveBeenCalledTimes(1);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(passkeyRequirement()).toBe("one-hour");
});

test("an exchange timeout after verification keeps the one-hour session for a retry", async () => {
  setPasskeyRequirement("one-hour");
  const { connect, payload } = mockSavedConnection(true);
  connect.mockResolvedValue({ ok: false, error: "The account request timed out." });
  const clear = spyOn(session, "clearApiWalletSession").mockImplementation(() => {});
  const cache = spyOn(session, "cacheApiWalletSession");
  expect(await unlockSavedApiWallet()).toEqual({ ok: false, error: "The account request timed out." });
  expect(clear).not.toHaveBeenCalled();
  expect(cache).not.toHaveBeenCalled(); // A retry must not restart the hour.
  expect(payload.apiWalletPrivateKey).toBe("0x");
});

test("a restored session does not reprompt or discard verification when account loading fails", async () => {
  const { connect, unlock, payload } = mockSavedConnection(true);
  spyOn(vault, "initializeApiWalletVault").mockResolvedValue();
  spyOn(vault, "restoreApiWalletVaultSession").mockResolvedValue({ ok: true, payload });
  connect.mockResolvedValue({ ok: false, error: "Network unavailable" });
  const clear = spyOn(session, "clearApiWalletSession").mockImplementation(() => {});
  await restoreSavedApiWalletOnStartup();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(unlock).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
});

test("forgetting the saved wallet during connection still clears and disconnects it", async () => {
  const { connect } = mockSavedConnection(true);
  const epoch = spyOn(vault, "apiWalletVaultRevocationEpoch").mockReturnValue(0);
  connect.mockImplementation(async () => { epoch.mockReturnValue(1); return { ok: true }; });
  const clear = spyOn(session, "clearApiWalletSession").mockImplementation(() => {});
  const disconnect = spyOn(execution, "disconnectHyperliquid").mockImplementation(() => {});
  expect((await unlockSavedApiWallet()).ok).toBe(false);
  expect(clear).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
});
