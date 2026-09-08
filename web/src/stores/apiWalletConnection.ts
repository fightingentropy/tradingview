import {
  connectHyperliquid,
  disconnectHyperliquid,
  hyperliquidConnectionStatus,
} from "./hyperliquidExecution";
import {
  type VaultPayload,
  apiWalletVaultRevocationEpoch,
  hasSavedApiWalletVault,
  restoreApiWalletVaultSession,
  unlockApiWalletVault,
} from "./apiWalletVault";
import {
  clearApiWalletSession,
  passkeyRequirement,
  setPasskeyRequirement,
} from "./apiWalletSession";

export type SavedApiWalletConnectionResult =
  | { ok: true }
  | { ok: false; error: string };

const connectRecoveredApiWallet = async (
  payload: VaultPayload,
  revocationEpoch: number,
): Promise<SavedApiWalletConnectionResult> => {
  if (
    apiWalletVaultRevocationEpoch() !== revocationEpoch ||
    hyperliquidConnectionStatus() !== "disconnected"
  ) {
    payload.apiWalletPrivateKey = "0x";
    clearApiWalletSession();
    return {
      ok: false,
      error: "The API-wallet connection changed before it could be restored.",
    };
  }

  const connectionPromise = connectHyperliquid({
    network: payload.network,
    masterAddress: payload.masterAddress,
    apiWalletPrivateKey: payload.apiWalletPrivateKey,
    mainnetConfirmation:
      payload.network === "mainnet" ? "MAINNET" : undefined,
  });
  payload.apiWalletPrivateKey = "0x";
  const result = await connectionPromise;

  if (!result.ok || apiWalletVaultRevocationEpoch() !== revocationEpoch) {
    clearApiWalletSession();
    if (apiWalletVaultRevocationEpoch() !== revocationEpoch) {
      disconnectHyperliquid();
      return {
        ok: false,
        error: "The saved API wallet was removed during connection.",
      };
    }
  }
  return result.ok ? { ok: true } : result;
};

export const unlockSavedApiWallet = async (): Promise<
  SavedApiWalletConnectionResult
> => {
  if (!hasSavedApiWalletVault()) {
    return { ok: false, error: "No saved API wallet is available to unlock." };
  }
  if (hyperliquidConnectionStatus() !== "disconnected") {
    return {
      ok: false,
      error:
        hyperliquidConnectionStatus() === "connecting"
          ? "The API wallet is already being verified."
          : "The API wallet is already connected.",
    };
  }

  const revocationEpoch = apiWalletVaultRevocationEpoch();
  const unlocked = await unlockApiWalletVault();
  if (!unlocked.ok) return unlocked;
  if (
    passkeyRequirement() !== "every-refresh" &&
    !unlocked.reloadGraceReady
  ) {
    setPasskeyRequirement("every-refresh");
  }
  return await connectRecoveredApiWallet(unlocked.payload, revocationEpoch);
};

export const restoreSavedApiWalletOnStartup = async () => {
  // A reload may restore an in-memory session within its configured grace
  // window. Any other startup falls through to the normal Touch ID unlock.
  const revocationEpoch = apiWalletVaultRevocationEpoch();
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
