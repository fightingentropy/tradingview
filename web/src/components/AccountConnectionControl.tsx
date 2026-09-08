import { Component, Show, createSignal, onCleanup } from "solid-js";
import {
  connectButtonLabel,
  connectOpen,
  openConnect,
} from "../stores/connect";
import {
  hyperliquidConnection,
  hyperliquidConnectionStatus,
  isHyperliquidConnected,
  isHyperliquidExecution,
  preloadHyperliquidExecutionSdk,
} from "../stores/hyperliquidExecution";
import {
  apiWalletVaultReady,
  apiWalletVaultUnlockPending,
  hasSavedApiWalletVault,
} from "../stores/apiWalletVault";
import { unlockSavedApiWallet } from "../stores/apiWalletConnection";

type AccountConnectionControlProps = {
  compact?: boolean;
  onBeforeOpen?: () => void;
};

type CopyState = "idle" | "copied" | "failed";

const shortAddress = (address: string) =>
  address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

const AccountConnectionControl: Component<AccountConnectionControlProps> = (
  props,
) => {
  const [copyState, setCopyState] = createSignal<CopyState>("idle");
  const [unlockError, setUnlockError] = createSignal<string>();
  let copyStateTimeout: ReturnType<typeof setTimeout> | undefined;

  const resetCopyStateAfterDelay = () => {
    if (copyStateTimeout) clearTimeout(copyStateTimeout);
    copyStateTimeout = setTimeout(() => setCopyState("idle"), 1_800);
  };

  const shouldUnlockDirectly = () =>
    apiWalletVaultReady() &&
    hasSavedApiWalletVault() &&
    hyperliquidConnectionStatus() === "disconnected";

  const handleOpenConnect = async () => {
    props.onBeforeOpen?.();
    setUnlockError(undefined);
    if (shouldUnlockDirectly()) {
      const result = await unlockSavedApiWallet();
      if (!result.ok) setUnlockError(result.error);
      return;
    }
    openConnect();
  };

  const handleCopyAddress = async () => {
    const address = hyperliquidConnection()?.masterAddress;
    if (!address) return;

    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    resetCopyStateAfterDelay();
  };

  onCleanup(() => {
    if (copyStateTimeout) clearTimeout(copyStateTimeout);
  });

  const networkLabel = () =>
    hyperliquidConnection()?.network === "mainnet"
      ? "Hyperliquid Mainnet"
      : "Hyperliquid Testnet";

  const copyLabel = () => {
    const address = hyperliquidConnection()?.masterAddress ?? "";
    if (copyState() === "copied") return "Master address copied";
    if (copyState() === "failed") return "Copy failed. Copy master address again";
    return `Copy master address ${address}`;
  };

  return (
    <Show
      when={isHyperliquidExecution() && hyperliquidConnection()}
      fallback={
        <div class="relative">
          <button
            type="button"
            aria-label={
              shouldUnlockDirectly()
                ? "Unlock saved API wallet with Touch ID"
                : "Connect accounts"
            }
            aria-haspopup={shouldUnlockDirectly() ? undefined : "dialog"}
            aria-expanded={shouldUnlockDirectly() ? undefined : connectOpen()}
            aria-controls={shouldUnlockDirectly() ? undefined : "connect-dialog"}
            aria-busy={apiWalletVaultUnlockPending()}
            disabled={
              apiWalletVaultUnlockPending() ||
              hyperliquidConnectionStatus() === "connecting"
            }
            class={`rounded-lg border px-3 py-1.5 font-semibold transition-colors disabled:cursor-wait disabled:opacity-70 ${
              props.compact ? "text-[11px]" : "text-sm"
            } ${
              isHyperliquidConnected()
                ? "border-brand-border text-brand-slate-300 hover:border-brand-slate-600 hover:text-slate-100"
                : "border-brand-accent bg-brand-accent text-brand-screen hover:bg-brand-accent/80"
            }`}
            onPointerEnter={preloadHyperliquidExecutionSdk}
            onFocus={preloadHyperliquidExecutionSdk}
            onClick={() => void handleOpenConnect()}
          >
            {connectButtonLabel(props.compact)}
          </button>
          <Show when={unlockError()}>
            {(message) => (
              <div
                role="alert"
                class="absolute right-0 top-full z-[80] mt-2 flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border border-brand-border bg-brand-surface p-3 text-xs leading-5 text-brand-slate-300 shadow-xl"
              >
                <span class="min-w-0 flex-1">{message()}</span>
                <button
                  type="button"
                  aria-label="Dismiss API wallet error"
                  class="shrink-0 text-brand-slate-500 hover:text-slate-100"
                  onClick={() => setUnlockError(undefined)}
                >
                  ×
                </button>
              </div>
            )}
          </Show>
        </div>
      }
    >
      <div class="flex h-9 items-stretch overflow-hidden rounded-lg border border-brand-border bg-brand-surface">
        <button
          type="button"
          aria-label={`Open ${networkLabel()} connection for master address ${hyperliquidConnection()?.masterAddress}`}
          aria-haspopup="dialog"
          aria-expanded={connectOpen()}
          aria-controls="connect-dialog"
          title={networkLabel()}
          class={`flex min-w-0 items-center gap-2 px-3 transition-colors hover:bg-brand-border/30 ${
            props.compact ? "text-xs" : "text-sm"
          }`}
          onClick={handleOpenConnect}
        >
          <Show when={!props.compact}>
            <span class="font-medium text-brand-slate-400">Master</span>
          </Show>
          <span class="font-mono font-medium text-slate-100">
            {shortAddress(hyperliquidConnection()?.masterAddress ?? "")}
          </span>
        </button>
        <button
          type="button"
          aria-label={copyLabel()}
          title={
            copyState() === "copied"
              ? "Copied"
              : copyState() === "failed"
                ? "Copy failed"
                : "Copy master address"
          }
          class={`flex w-9 shrink-0 items-center justify-center border-l border-brand-border transition-colors hover:bg-brand-border/30 ${
            copyState() === "failed"
              ? "text-brand-red-400"
              : "text-brand-accent"
          }`}
          onClick={() => void handleCopyAddress()}
        >
          <Show
            when={copyState() === "copied"}
            fallback={
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            }
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m5 12 4 4L19 6" />
            </svg>
          </Show>
        </button>
        <span class="sr-only" role="status" aria-live="polite">
          {copyState() === "copied"
            ? "Master address copied to clipboard."
            : copyState() === "failed"
              ? "Could not copy the master address."
              : ""}
        </span>
      </div>
    </Show>
  );
};

export default AccountConnectionControl;
