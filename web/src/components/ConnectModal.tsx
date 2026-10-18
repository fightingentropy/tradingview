import {
  Component,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";
import { authReady, isAuthenticated, login } from "../stores/auth";
import {
  apiWalletConnectionLabel,
  closeConnect,
  connectOpen,
} from "../stores/connect";
import {
  hyperliquidConnectionStatus,
  isHyperliquidConnected,
  isHyperliquidExecution,
} from "../stores/hyperliquidExecution";
import {
  apiWalletVaultReady,
  apiWalletVaultMetadata,
  apiWalletVaultUnlockPending,
  hasSavedApiWalletVault,
} from "../stores/apiWalletVault";
import { unlockSavedApiWallet } from "../stores/apiWalletConnection";
import { openSettings } from "../stores/settings";

const ConnectModal: Component = () => {
  let dialogRef: HTMLDivElement | undefined;
  let closeButtonRef: HTMLButtonElement | undefined;
  let previouslyFocused: HTMLElement | null = null;
  let handoffInProgress = false;
  const [quickUnlockError, setQuickUnlockError] = createSignal<string>();

  const handOffTo = (next: () => void) => {
    handoffInProgress = true;
    closeConnect();
    queueMicrotask(next);
  };

  const apiWalletDescription = () => {
    if (isHyperliquidExecution()) {
      return "Manage your connected trading account.";
    }
    if (isHyperliquidConnected()) {
      return "Switch from practice funds to your real account.";
    }
    if (apiWalletVaultReady() && hasSavedApiWalletVault()) {
      return "Unlock your saved account on this device.";
    }
    return "Paste your API key to connect your trading account.";
  };

  const shouldUnlockSavedWallet = () =>
    apiWalletVaultReady() &&
    hasSavedApiWalletVault() &&
    apiWalletVaultMetadata()?.network === "mainnet" &&
    hyperliquidConnectionStatus() === "disconnected";

  const handleApiWalletSelection = async () => {
    setQuickUnlockError(undefined);
    if (!shouldUnlockSavedWallet()) {
      handOffTo(openSettings);
      return;
    }
    const result = await unlockSavedApiWallet();
    if (!result.ok) {
      setQuickUnlockError(result.error);
      return;
    }
    handoffInProgress = true;
    closeConnect();
  };

  createEffect(() => {
    if (!connectOpen()) return;

    handoffInProgress = false;
    setQuickUnlockError(undefined);
    previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeConnect();
        return;
      }
      if (event.key !== "Tab" || !dialogRef) return;

      const focusable = Array.from(
        dialogRef.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => closeButtonRef?.focus());

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (!handoffInProgress) {
        requestAnimationFrame(() => {
          if (previouslyFocused?.isConnected) previouslyFocused.focus();
        });
      }
    });
  });

  return (
    <Show when={connectOpen()}>
      <Portal>
        <div
          class="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeConnect();
          }}
        >
          <div
            id="connect-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-dialog-title"
            aria-describedby="connect-dialog-description"
            class="modal-panel"
          >
            <header class="modal-header">
              <div class="min-w-0">
                <h2 id="connect-dialog-title" class="modal-title">
                  Connect
                </h2>
                <p id="connect-dialog-description" class="modal-subtitle">
                  Choose how you want to use TradingView.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close connection chooser"
                class="icon-btn modal-close"
                onClick={closeConnect}
              >
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </header>

            <div class="modal-body">
              <button
                type="button"
                disabled={
                  apiWalletVaultUnlockPending() ||
                  hyperliquidConnectionStatus() === "connecting"
                }
                aria-busy={apiWalletVaultUnlockPending()}
                class="option-card"
                onClick={() => void handleApiWalletSelection()}
              >
                <span class="option-icon">
                  <svg
                    aria-hidden="true"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="3" y="6" width="18" height="13" rx="2" />
                    <path d="M16 10h5v5h-5a2.5 2.5 0 0 1 0-5Z" />
                    <path d="M7 6V4h10v2" />
                  </svg>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center justify-between gap-3">
                    <span class="option-title">Hyperliquid</span>
                    <span
                      class={`badge ${isHyperliquidExecution() ? "badge-accent" : ""}`}
                    >
                      {apiWalletConnectionLabel()}
                    </span>
                  </span>
                  <span class="option-desc">{apiWalletDescription()}</span>
                </span>
              </button>
              <Show when={quickUnlockError()}>
                {(message) => (
                  <p role="alert" class="notice notice-error">
                    {message()}
                  </p>
                )}
              </Show>

              <button
                type="button"
                disabled={!authReady() || isAuthenticated()}
                class="option-card"
                onClick={() => handOffTo(login)}
              >
                <span class="option-icon">
                  <svg
                    aria-hidden="true"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center justify-between gap-3">
                    <span class="option-title">Sign in</span>
                    <Show when={!authReady()}>
                      <span class="badge">Checking</span>
                    </Show>
                    <Show when={authReady() && isAuthenticated()}>
                      <span class="badge badge-accent">Signed in</span>
                    </Show>
                  </span>
                  <span class="option-desc">
                    {isAuthenticated()
                      ? "Your TradingView account is already signed in."
                      : "Use your TradingView email account for the paper ledger and profile."}
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default ConnectModal;
