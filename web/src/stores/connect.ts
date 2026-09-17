import { createSignal } from "solid-js";
import {
  apiWalletVaultUnlockPending,
  apiWalletVaultReady,
  apiWalletVaultMetadata,
  hasSavedApiWalletVault,
} from "./apiWalletVault";
import {
  hyperliquidExecutionLabel,
  isHyperliquidConnected,
  isHyperliquidExecution,
} from "./hyperliquidExecution";

const [connectOpen, setConnectOpen] = createSignal(false);

const openConnect = () => setConnectOpen(true);
const closeConnect = () => setConnectOpen(false);

const apiWalletConnectionLabel = (_compact = false) => {
  if (isHyperliquidExecution()) return hyperliquidExecutionLabel();
  if (isHyperliquidConnected()) {
    return "Practice mode";
  }
  if (apiWalletVaultReady() && hasSavedApiWalletVault()) {
    return apiWalletVaultMetadata()?.network === "mainnet"
      ? "Saved account"
      : "Reconnect";
  }
  return "Not connected";
};

const connectButtonLabel = (compact = false) => {
  if (apiWalletVaultUnlockPending()) {
    return compact ? "Verifying…" : "Waiting for verification…";
  }
  if (isHyperliquidConnected()) return apiWalletConnectionLabel(compact);
  if (apiWalletVaultReady() && hasSavedApiWalletVault()) {
    return apiWalletVaultMetadata()?.network === "mainnet"
      ? "Unlock account"
      : "Connect";
  }
  return "Connect";
};

export {
  apiWalletConnectionLabel,
  closeConnect,
  connectButtonLabel,
  connectOpen,
  openConnect,
};
