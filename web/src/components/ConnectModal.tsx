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
      return "Manage the API wallet currently routing Trade orders to Hyperliquid.";
    }
    if (isHyperliquidConnected()) {
      return "Resume or manage the verified API wallet held in this tab.";
    }
    if (apiWalletVaultReady() && hasSavedApiWalletVault()) {
      return "Unlock the saved API wallet with Touch ID or device verification.";
    }
    return "Use an approved Hyperliquid agent key through the existing session-only flow.";
  };

  const shouldUnlockSavedWallet = () =>
    apiWalletVaultReady() &&
    hasSavedApiWalletVault() &&
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
          class="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
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
            class="w-[min(460px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-brand-border bg-[#111418] shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
          >
            <header class="flex items-start justify-between gap-4 border-b border-brand-border bg-brand-screen px-5 py-4">
              <div>
                <h2
                  id="connect-dialog-title"
                  class="text-lg font-semibold text-slate-100"
                >
                  Connect
                </h2>
                <p
                  id="connect-dialog-description"
                  class="mt-1 text-xs leading-5 text-brand-slate-500"
                >
                  Choose how you want to use TradingView.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close connection chooser"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-brand-border text-brand-slate-400 transition-colors hover:border-brand-slate-600 hover:text-slate-100"
                onClick={closeConnect}
              >
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </header>

            <div class="space-y-2 p-4">
              <button
                type="button"
                disabled={
                  apiWalletVaultUnlockPending() ||
                  hyperliquidConnectionStatus() === "connecting"
                }
                aria-busy={apiWalletVaultUnlockPending()}
                class="flex w-full items-start gap-3 rounded-lg border border-brand-border bg-brand-screen/50 p-4 text-left transition-colors hover:border-brand-slate-600 hover:bg-white/[0.025] disabled:cursor-wait disabled:opacity-70"
                onClick={() => void handleApiWalletSelection()}
              >
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-border text-brand-accent">
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
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
                    <span class="text-sm font-semibold text-slate-100">
                      API wallet
                    </span>
                    <span
                      class={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${
                        isHyperliquidExecution()
                          ? "border-brand-accent/50 text-brand-accent"
                          : "border-brand-border text-brand-slate-400"
                      }`}
                    >
                      {apiWalletConnectionLabel()}
                    </span>
                  </span>
                  <span class="mt-1 block text-xs leading-5 text-brand-slate-500">
                    {apiWalletDescription()}
                  </span>
                </span>
              </button>
              <Show when={quickUnlockError()}>
                {(message) => (
                  <p
                    role="alert"
                    class="rounded-lg border border-brand-red-400/30 bg-brand-red-400/5 px-3 py-2 text-xs leading-5 text-brand-red-400"
                  >
                    {message()}
                  </p>
                )}
              </Show>

              <button
                type="button"
                disabled={!authReady() || isAuthenticated()}
                class="flex w-full items-start gap-3 rounded-lg border border-brand-border bg-brand-screen/50 p-4 text-left transition-colors hover:border-brand-slate-600 hover:bg-white/[0.025] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => handOffTo(login)}
              >
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-border text-brand-slate-300">
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center justify-between gap-3">
                    <span class="text-sm font-semibold text-slate-100">
                      Sign in
                    </span>
                    <Show when={!authReady()}>
                      <span class="rounded border border-brand-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-brand-slate-500">
                        Checking
                      </span>
                    </Show>
                    <Show when={authReady() && isAuthenticated()}>
                      <span class="rounded border border-brand-accent/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-brand-accent">
                        Signed in
                      </span>
                    </Show>
                  </span>
                  <span class="mt-1 block text-xs leading-5 text-brand-slate-500">
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
