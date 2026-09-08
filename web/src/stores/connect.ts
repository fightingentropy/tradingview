import { createSignal } from "solid-js";
import {
  apiWalletVaultUnlockPending,
  apiWalletVaultReady,
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

const apiWalletConnectionLabel = (compact = false) => {
  if (isHyperliquidExecution()) return hyperliquidExecutionLabel();
  if (isHyperliquidConnected()) {
    return compact ? "API paused" : "API wallet paused";
  }
  if (apiWalletVaultReady() && hasSavedApiWalletVault()) {
    return "Saved, locked";
  }
  return "Not connected";
};

const connectButtonLabel = (compact = false) => {
  if (apiWalletVaultUnlockPending()) {
    return compact ? "Verifying…" : "Waiting for verification…";
  }
  if (isHyperliquidConnected()) return apiWalletConnectionLabel(compact);
  if (apiWalletVaultReady() && hasSavedApiWalletVault()) {
    return compact ? "Unlock" : "Unlock API wallet";
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
