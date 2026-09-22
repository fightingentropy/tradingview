import {
  connectHyperliquid,
  disconnectHyperliquid,
  hyperliquidConnectionStatus,
} from "./hyperliquidExecution";
import {
  type VaultPayload,
  apiWalletVaultRevocationEpoch,
  apiWalletVaultMetadata,
  hasSavedApiWalletVault,
  initializeApiWalletVault,
  restoreApiWalletVaultSession,
  unlockApiWalletVault,
} from "./apiWalletVault";
import { clearApiWalletSession } from "./apiWalletSession";

export type SavedApiWalletConnectionResult =
  { ok: true } | { ok: false; error: string };

const connectRecoveredApiWallet = async (
  payload: VaultPayload,
  revocationEpoch: number,
): Promise<SavedApiWalletConnectionResult> => {
  if (apiWalletVaultRevocationEpoch() !== revocationEpoch) {
    payload.apiWalletPrivateKey = "0x";
    clearApiWalletSession();
    return {
      ok: false,
      error: "Your connection changed. Please try connecting again.",
    };
  }
  if (hyperliquidConnectionStatus() !== "disconnected") {
    payload.apiWalletPrivateKey = "0x";
    return { ok: false, error: "Your account is already connecting or connected." };
  }

  const connectionPromise = connectHyperliquid({
    network: payload.network,
    masterAddress: payload.masterAddress,
    apiWalletPrivateKey: payload.apiWalletPrivateKey,
  });
  payload.apiWalletPrivateKey = "0x";
  const result = await connectionPromise;

  if (apiWalletVaultRevocationEpoch() !== revocationEpoch) {
    clearApiWalletSession();
    disconnectHyperliquid();
    return {
      ok: false,
      error: "The saved connection was removed. Please reconnect.",
    };
  }
  // A slow or failed exchange read does not undo successful device verification.
  // Trading remains disconnected; a reload can retry within the original window.
  return result.ok ? { ok: true } : result;
};

export const unlockSavedApiWallet =
  async (): Promise<SavedApiWalletConnectionResult> => {
    if (!hasSavedApiWalletVault()) {
      return {
        ok: false,
        error: "No saved account is available. Connect with your API key.",
      };
    }
    if (apiWalletVaultMetadata()?.network !== "mainnet") {
      return {
        ok: false,
        error:
          "Open Settings to replace this saved connection with a live Hyperliquid account.",
      };
    }
    if (hyperliquidConnectionStatus() !== "disconnected") {
      return {
        ok: false,
        error:
          hyperliquidConnectionStatus() === "connecting"
            ? "Your account is already connecting."
            : "Your account is already connected.",
      };
    }

    const revocationEpoch = apiWalletVaultRevocationEpoch();
    const unlocked = await unlockApiWalletVault();
    if (!unlocked.ok) return unlocked;
    // An unavailable reload session must require verification again, without
    // replacing the user's saved interval with a permanent stricter choice.
    return await connectRecoveredApiWallet(unlocked.payload, revocationEpoch);
  };

export const restoreSavedApiWalletOnStartup = async () => {
  // A reload may restore an in-memory session within its configured grace
  // window. Any other startup falls through to the normal Touch ID unlock.
  const revocationEpoch = apiWalletVaultRevocationEpoch();
  await initializeApiWalletVault();
  if (
    apiWalletVaultRevocationEpoch() !== revocationEpoch ||
    apiWalletVaultMetadata()?.network !== "mainnet"
  )
    return;
  const restored = await restoreApiWalletVaultSession();
  if (restored.ok) {
    await connectRecoveredApiWallet(restored.payload, revocationEpoch);
    return;
  }

  if (
    apiWalletVaultRevocationEpoch() !== revocationEpoch ||
    !hasSavedApiWalletVault() ||
    hyperliquidConnectionStatus() !== "disconnected"
  ) {
    return;
  }
  await unlockSavedApiWallet();
};
