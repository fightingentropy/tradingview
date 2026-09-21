import {
  Component,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";
import { hyperliquidAppUrl } from "../lib/hyperliquidNetwork";
import { isAuthenticated } from "../stores/auth";
import {
  isPortfolioMarginEnabled,
  togglePortfolioMargin,
} from "../stores/clob";
import {
  reduceMotion,
  resetInterfaceSettings,
  setReduceMotion,
  setShowAccountPanel,
  setShowChartGrid,
  setShowChartVolume,
  setShowOrderBook,
  setShowWatchlist,
  showAccountPanel,
  showChartGrid,
  showChartVolume,
  showOrderBook,
  showWatchlist,
} from "../stores/market";
import { closeSettings, settingsOpen } from "../stores/settings";
import {
  connectHyperliquid,
  disconnectHyperliquid,
  hyperliquidAccountModeLabel,
  hyperliquidAccountRefreshError,
  hyperliquidConnection,
  hyperliquidConnectionError,
  hyperliquidConnectionStatus,
  hyperliquidLastRefreshAt,
  isHyperliquidConnected,
  isHyperliquidExecution,
  refreshHyperliquidAccount,
  setHyperliquidExecutionEnabled,
} from "../stores/hyperliquidExecution";
import {
  apiWalletVaultError,
  apiWalletVaultMetadata,
  apiWalletVaultReady,
  apiWalletVaultRevocationEpoch,
  apiWalletVaultRestorePending,
  apiWalletVaultUnlockPending,
  enrollApiWalletVault,
  ensureTouchIdSupport,
  forgetApiWalletVault,
  hasSavedApiWalletVault,
  unlockApiWalletVault,
} from "../stores/apiWalletVault";
import {
  type PasskeyRequirement,
  cacheApiWalletSession,
  clearApiWalletSession,
  passkeyRequirement,
  setPasskeyRequirement,
} from "../stores/apiWalletSession";

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: () => void;
}

const ToggleRow: Component<ToggleRowProps> = (props) => (
  <button
    type="button"
    role="switch"
    aria-checked={props.checked}
    aria-busy={props.busy ? "true" : undefined}
    disabled={props.disabled}
    class="flex min-h-16 w-full items-center justify-between gap-6 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.025] disabled:cursor-not-allowed disabled:opacity-50"
    onClick={props.onChange}
  >
    <span class="min-w-0">
      <span class="block text-sm font-medium text-slate-100">
        {props.label}
      </span>
      <span class="mt-1 block text-xs leading-5 text-brand-slate-500">
        {props.description}
      </span>
    </span>
    <span
      aria-hidden="true"
      class={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        props.checked
          ? "border-brand-accent bg-brand-accent"
          : "border-brand-slate-600 bg-brand-border"
      }`}
    >
      <span
        class={`absolute top-[3px] h-3 w-3 rounded-full bg-white transition-transform ${
          props.checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </span>
  </button>
);

const SectionTitle: Component<{ children: string }> = (props) => (
  <h3 class="border-b border-brand-border bg-brand-screen px-5 py-2.5 text-xs font-medium text-brand-slate-400">
    {props.children}
  </h3>
);

const formatTimestamp = (value: number | undefined) => {
  if (value === undefined) return "Not reported";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const formatRefreshTime = (value: number | undefined) => {
  if (value === undefined) return "Not refreshed";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
};

const SettingsModal: Component = () => {
  const [isTogglingMargin, setIsTogglingMargin] = createSignal(false);
  const [marginError, setMarginError] = createSignal<string>();
  const [section, setSection] = createSignal<"account" | "appearance">(
    "account",
  );
  const [apiWalletPrivateKey, setApiWalletPrivateKey] = createSignal("");
  const [executionActionError, setExecutionActionError] =
    createSignal<string>();
  const [isRefreshingAccount, setIsRefreshingAccount] = createSignal(false);
  const [protectWithTouchId, setProtectWithTouchId] = createSignal(false);
  const [touchIdSupported, setTouchIdSupported] = createSignal<boolean>();
  const [vaultAction, setVaultAction] = createSignal<
    "enrolling" | "unlocking" | "reauthenticating" | "forgetting"
  >();
  const [passkeyNameNotice, setPasskeyNameNotice] = createSignal<string>();
  let dialogRef: HTMLDivElement | undefined;
  let closeButtonRef: HTMLButtonElement | undefined;
  let previouslyFocused: HTMLElement | null = null;

  const marginDisabled = () =>
    isTogglingMargin() || isHyperliquidExecution() || !isAuthenticated();

  const marginDescription = () => {
    if (isHyperliquidExecution()) {
      return "Available in practice mode only.";
    }
    if (isHyperliquidConnected()) {
      return "Use your practice investments to support other practice trades.";
    }
    if (!isAuthenticated())
      return "Sign in to change practice trading settings.";
    return "Use your practice investments to support other practice trades.";
  };

  const connectionStatusLabel = () => {
    if (apiWalletVaultRestorePending()) {
      return "Reconnecting…";
    }
    if (apiWalletVaultUnlockPending()) {
      return "Waiting for device verification";
    }
    if (hyperliquidConnectionStatus() === "connecting") {
      return "Connecting…";
    }
    if (!isHyperliquidConnected()) {
      return hasSavedApiWalletVault() ? "Locked" : "Not connected";
    }
    return isHyperliquidExecution() ? "Live trading" : "Practice mode";
  };

  const canConnect = () =>
    !apiWalletVaultUnlockPending() &&
    hyperliquidConnectionStatus() !== "connecting" &&
    !vaultAction() &&
    apiWalletPrivateKey().trim().length > 0;

  const executionIssue = () =>
    executionActionError() ??
    apiWalletVaultError() ??
    hyperliquidConnectionError() ??
    hyperliquidAccountRefreshError();

  const refreshTouchIdSupport = async () => {
    setTouchIdSupported(undefined);
    const result = await ensureTouchIdSupport();
    setTouchIdSupported(result.ok);
  };

  const handleTogglePortfolioMargin = async () => {
    if (marginDisabled()) return;
    setIsTogglingMargin(true);
    setMarginError(undefined);
    const result = await togglePortfolioMargin(!isPortfolioMarginEnabled());
    setIsTogglingMargin(false);
    if (!result.ok) {
      setMarginError(result.error ?? "Could not update portfolio margin.");
    }
  };

  const handleConnect = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!canConnect()) return;
    setExecutionActionError(undefined);
    setPasskeyNameNotice(undefined);

    let privateKey = apiWalletPrivateKey();
    const shouldEnrollTouchId = protectWithTouchId();

    const connectionPromise = connectHyperliquid({
      apiWalletPrivateKey: privateKey,
    });

    // The store reads the credential synchronously before its first await. Drop
    // the form copy immediately; the connected signer remains tab-memory only.
    setApiWalletPrivateKey("");
    const result = await connectionPromise;
    if (!result.ok) {
      privateKey = "";
      setExecutionActionError(result.error);
      return;
    }

    if (shouldEnrollTouchId) {
      const activeConnection = hyperliquidConnection();
      if (!activeConnection) {
        privateKey = "";
        setExecutionActionError(
          "Connected, but your key could not be saved. Please reconnect to try again.",
        );
        return;
      }
      setVaultAction("enrolling");
      const vaultResult = await enrollApiWalletVault({
        network: activeConnection.network,
        masterAddress: activeConnection.masterAddress,
        agentAddress: activeConnection.agentAddress,
        apiWalletPrivateKey: privateKey,
      });
      setVaultAction(undefined);
      privateKey = "";
      if (!vaultResult.ok) {
        setExecutionActionError(
          `Connected for now. Your key could not be saved: ${vaultResult.error}`,
        );
        return;
      }
      if (
        passkeyRequirement() !== "every-refresh" &&
        vaultResult.reloadGraceReady !== true
      ) {
        setPasskeyNameNotice(
          "Your unlock interval is unchanged. This browser couldn’t keep the session, so refreshing may ask you to unlock again.",
        );
      }
    } else {
      privateKey = "";
    }
    setProtectWithTouchId(false);
  };

  const handleUnlockVault = async () => {
    if (
      vaultAction() ||
      apiWalletVaultRestorePending() ||
      apiWalletVaultUnlockPending() ||
      hyperliquidConnectionStatus() !== "disconnected"
    ) {
      return;
    }
    setVaultAction("unlocking");
    setExecutionActionError(undefined);
    setPasskeyNameNotice(undefined);
    const revocationEpoch = apiWalletVaultRevocationEpoch();
    const unlocked = await unlockApiWalletVault();
    if (!unlocked.ok) {
      setVaultAction(undefined);
      setExecutionActionError(unlocked.error);
      return;
    }
    const payload = unlocked.payload;
    if (apiWalletVaultRevocationEpoch() !== revocationEpoch) {
      payload.apiWalletPrivateKey = "0x";
      clearApiWalletSession();
      setVaultAction(undefined);
      setExecutionActionError(
        "The saved connection was removed. Please reconnect.",
      );
      return;
    }
    if (
      passkeyRequirement() !== "every-refresh" &&
      !unlocked.reloadGraceReady
    ) {
      setPasskeyNameNotice(
        "Your unlock interval is unchanged. This browser couldn’t keep the session, so refreshing may ask you to unlock again.",
      );
    }
    const connectionPromise = connectHyperliquid({
      network: payload.network,
      masterAddress: payload.masterAddress,
      apiWalletPrivateKey: payload.apiWalletPrivateKey,
    });
    payload.apiWalletPrivateKey = "0x";
    const result = await connectionPromise;
    setVaultAction(undefined);
    if (apiWalletVaultRevocationEpoch() !== revocationEpoch) {
      clearApiWalletSession();
      disconnectHyperliquid();
      setExecutionActionError(
        "The saved connection was removed. Please reconnect.",
      );
      return;
    }
    if (!result.ok) {
      clearApiWalletSession();
      setExecutionActionError(result.error);
      return;
    }
  };

  const handleForgetVault = async () => {
    if (
      vaultAction() ||
      apiWalletVaultRestorePending() ||
      apiWalletVaultUnlockPending()
    ) {
      return;
    }
    setVaultAction("forgetting");
    setExecutionActionError(undefined);
    setPasskeyNameNotice(undefined);
    disconnectHyperliquid();
    const result = await forgetApiWalletVault();
    disconnectHyperliquid();
    setVaultAction(undefined);
    if (!result.ok) {
      setExecutionActionError(result.error);
      return;
    }
    setProtectWithTouchId(false);
    void refreshTouchIdSupport();
  };

  const passkeyRequirementDescription = () => {
    switch (passkeyRequirement()) {
      case "five-minutes":
        return "You can refresh for 5 minutes after unlocking without another prompt.";
      case "one-hour":
        return "You can refresh for an hour after unlocking without another prompt.";
      default:
        return "Unlock each time you refresh the page.";
    }
  };

  const handlePasskeyRequirementChange = async (next: PasskeyRequirement) => {
    const previous = passkeyRequirement();
    if (next === previous || vaultAction() || apiWalletVaultUnlockPending()) {
      return;
    }
    setExecutionActionError(undefined);
    setPasskeyNameNotice(undefined);

    if (next === "every-refresh") {
      const preferenceSaved = setPasskeyRequirement(next);
      if (!preferenceSaved) {
        setExecutionActionError(
          "Unlock is required after refresh. Your browser could not save this preference.",
        );
      }
      return;
    }

    if (!hasSavedApiWalletVault() || !isHyperliquidConnected()) {
      if (!setPasskeyRequirement(next)) {
        setExecutionActionError(
          "Your browser could not save this preference. Please try again.",
        );
      }
      return;
    }

    setVaultAction("reauthenticating");
    const revocationEpoch = apiWalletVaultRevocationEpoch();
    const verified = await unlockApiWalletVault({ cacheRequirement: false });
    if (!verified.ok) {
      setVaultAction(undefined);
      setExecutionActionError(
        `Your unlock preference was not changed: ${verified.error}`,
      );
      return;
    }
    const payload = verified.payload;
    if (
      hyperliquidConnectionStatus() !== "connected" ||
      passkeyRequirement() !== previous ||
      apiWalletVaultRevocationEpoch() !== revocationEpoch
    ) {
      payload.apiWalletPrivateKey = "0x";
      clearApiWalletSession();
      setVaultAction(undefined);
      setExecutionActionError(
        "Your connection changed. Please try updating this preference again.",
      );
      return;
    }
    if (!setPasskeyRequirement(next)) {
      payload.apiWalletPrivateKey = "0x";
      setVaultAction(undefined);
      setExecutionActionError(
        "Your browser could not save this preference. Please try again.",
      );
      return;
    }
    const reloadGraceReady = await cacheApiWalletSession(
      payload,
      verified.vaultId,
      next,
    );
    payload.apiWalletPrivateKey = "0x";
    if (
      hyperliquidConnectionStatus() !== "connected" ||
      passkeyRequirement() !== next ||
      apiWalletVaultRevocationEpoch() !== revocationEpoch
    ) {
      clearApiWalletSession();
      setVaultAction(undefined);
      setExecutionActionError(
        "Your connection changed. Please check your unlock preference again.",
      );
      return;
    }
    if (!reloadGraceReady) {
      clearApiWalletSession();
      setVaultAction(undefined);
      setExecutionActionError(
        "Your unlock interval is saved. This browser couldn’t keep the session, so refreshing may ask you to unlock again.",
      );
      return;
    }
    setVaultAction(undefined);
    setPasskeyNameNotice(
      next === "five-minutes"
        ? "Saved. Refresh without unlocking again for 5 minutes."
        : "Saved. Refresh without unlocking again for an hour.",
    );
  };

  const handleRefreshAccount = async () => {
    if (isRefreshingAccount()) return;
    setIsRefreshingAccount(true);
    setExecutionActionError(undefined);
    setPasskeyNameNotice(undefined);
    await refreshHyperliquidAccount();
    setIsRefreshingAccount(false);
    if (hyperliquidAccountRefreshError()) {
      setExecutionActionError(hyperliquidAccountRefreshError());
    }
  };

  const handleDisconnect = () => {
    if (vaultAction()) return;
    clearApiWalletSession();
    disconnectHyperliquid();
    setApiWalletPrivateKey("");
    setProtectWithTouchId(false);
    setExecutionActionError(undefined);
    setPasskeyNameNotice(undefined);
  };

  createEffect(() => {
    if (!settingsOpen()) return;

    setSection("account");
    previouslyFocused = document.activeElement as HTMLElement | null;
    setMarginError(undefined);
    setExecutionActionError(undefined);
    setApiWalletPrivateKey("");
    setProtectWithTouchId(false);
    setPasskeyNameNotice(undefined);
    if (!hasSavedApiWalletVault()) void refreshTouchIdSupport();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableSelector = [
      "button:not([disabled])",
      "summary",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSettings();
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
      setApiWalletPrivateKey("");
      setProtectWithTouchId(false);
      setPasskeyNameNotice(undefined);
      requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) {
          previouslyFocused.focus();
        } else {
          document
            .querySelector<HTMLElement>("[data-testid='charts-nav-hot-zone']")
            ?.focus();
        }
      });
    });
  });

  const busy = () =>
    Boolean(vaultAction()) ||
    apiWalletVaultRestorePending() ||
    apiWalletVaultUnlockPending() ||
    hyperliquidConnectionStatus() === "connecting";
  const savedConnectionSupported = () =>
    apiWalletVaultMetadata()?.network === "mainnet";
  const primaryButton =
    "min-h-11 w-full rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-screen transition-colors hover:bg-brand-accent/90 disabled:cursor-not-allowed disabled:opacity-45";
  const secondaryButton =
    "min-h-10 rounded-lg border border-brand-border px-3 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-50";
  const summaryClass =
    "cursor-pointer py-4 text-sm font-medium text-slate-300 marker:text-brand-slate-500";

  return (
    <Show when={settingsOpen()}>
      <Portal>
        <div
          class="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSettings();
          }}
        >
          <div
            id="settings-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
            class="flex max-h-[calc(100dvh-1.5rem)] w-[min(560px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-brand-border bg-[#111418] shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
          >
            <header class="shrink-0 border-b border-brand-border px-6 pt-5">
              <div class="flex items-center justify-between gap-4">
                <h2
                  id="settings-dialog-title"
                  class="text-xl font-semibold text-slate-100"
                >
                  Settings
                </h2>
                <button
                  ref={closeButtonRef}
                  type="button"
                  aria-label="Close settings"
                  class="flex h-10 w-10 items-center justify-center rounded-lg text-brand-slate-400 hover:bg-white/5 hover:text-slate-100"
                  onClick={closeSettings}
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
              </div>
              <nav aria-label="Settings sections" class="mt-4 flex gap-6">
                <button
                  type="button"
                  aria-pressed={section() === "account"}
                  class={`border-b-2 pb-3 text-sm font-medium ${section() === "account" ? "border-brand-accent text-slate-100" : "border-transparent text-brand-slate-500"}`}
                  onClick={() => setSection("account")}
                >
                  Account
                </button>
                <button
                  type="button"
                  aria-pressed={section() === "appearance"}
                  class={`border-b-2 pb-3 text-sm font-medium ${section() === "appearance" ? "border-brand-accent text-slate-100" : "border-transparent text-brand-slate-500"}`}
                  onClick={() => setSection("appearance")}
                >
                  Appearance
                </button>
              </nav>
            </header>
            <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <Show
                when={section() === "account"}
                fallback={
                  <div>
                    <SectionTitle>Workspace</SectionTitle>
                    <ToggleRow
                      label="Watchlist"
                      description="Your saved markets beside the chart."
                      checked={showWatchlist()}
                      onChange={() => setShowWatchlist((value) => !value)}
                    />
                    <ToggleRow
                      label="Order book"
                      description="Buy and sell offers beside the order form."
                      checked={showOrderBook()}
                      onChange={() => setShowOrderBook((value) => !value)}
                    />
                    <ToggleRow
                      label="Balances and activity"
                      description="Your positions and order history below the chart."
                      checked={showAccountPanel()}
                      onChange={() => setShowAccountPanel((value) => !value)}
                    />
                    <SectionTitle>Chart</SectionTitle>
                    <ToggleRow
                      label="Volume bars"
                      description="Show how much was traded below the chart."
                      checked={showChartVolume()}
                      onChange={() => setShowChartVolume((value) => !value)}
                    />
                    <ToggleRow
                      label="Grid lines"
                      description="Show horizontal and vertical guides."
                      checked={showChartGrid()}
                      onChange={() => setShowChartGrid((value) => !value)}
                    />
                    <ToggleRow
                      label="Reduce motion"
                      description="Use fewer animations."
                      checked={reduceMotion()}
                      onChange={() => setReduceMotion((value) => !value)}
                    />
                    <div class="border-t border-brand-border px-5 py-4">
                      <button
                        type="button"
                        class={secondaryButton}
                        onClick={resetInterfaceSettings}
                      >
                        Reset appearance
                      </button>
                    </div>
                  </div>
                }
              >
                <div class="px-6 py-6">
                  <Show
                    when={apiWalletVaultReady()}
                    fallback={
                      <p class="text-sm text-brand-slate-400">
                        Checking your saved connection…
                      </p>
                    }
                  >
                    <Show
                      when={isHyperliquidConnected()}
                      fallback={
                        <Show
                          when={hasSavedApiWalletVault()}
                          fallback={
                            <form onSubmit={handleConnect} class="space-y-5">
                              <div>
                                <h3 class="text-lg font-medium text-slate-100">
                                  Connect Hyperliquid
                                </h3>
                                <p class="mt-2 text-sm leading-6 text-brand-slate-400">
                                  Paste your API key. We’ll find your account
                                  and load your balances automatically.
                                </p>
                              </div>
                              <label class="block">
                                <span class="mb-2 flex items-center justify-between gap-3 text-sm font-medium text-slate-200">
                                  API key
                                </span>
                                <input
                                  name="api-key"
                                  type="password"
                                  autocomplete="off"
                                  autocapitalize="none"
                                  spellcheck={false}
                                  value={apiWalletPrivateKey()}
                                  disabled={busy()}
                                  placeholder="Paste your Hyperliquid API key"
                                  aria-describedby="api-key-help"
                                  class="h-12 w-full rounded-lg border border-brand-border bg-brand-screen px-3.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-brand-slate-500 focus:border-brand-accent disabled:opacity-50"
                                  onInput={(event) => {
                                    setApiWalletPrivateKey(
                                      event.currentTarget.value,
                                    );
                                    setExecutionActionError(undefined);
                                  }}
                                />
                              </label>
                              <p
                                id="api-key-help"
                                class="!mt-2 text-xs leading-5 text-brand-slate-500"
                              >
                                Use a trading API key, never your wallet’s
                                recovery phrase or private key.{" "}
                                <a
                                  href={hyperliquidAppUrl("mainnet", "API")}
                                  target="_blank"
                                  rel="noreferrer"
                                  class="inline-flex whitespace-nowrap text-brand-accent hover:underline"
                                >
                                  Get an API key ↗
                                </a>
                              </p>
                              <label class="flex cursor-pointer items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={protectWithTouchId()}
                                  disabled={
                                    touchIdSupported() !== true || busy()
                                  }
                                  class="mt-1 h-4 w-4 shrink-0 accent-brand-accent disabled:opacity-40"
                                  onChange={(event) =>
                                    setProtectWithTouchId(
                                      event.currentTarget.checked,
                                    )
                                  }
                                />
                                <span>
                                  <span class="block text-sm text-slate-200">
                                    Remember on this device
                                  </span>
                                  <span class="mt-1 block text-xs leading-5 text-brand-slate-500">
                                    {touchIdSupported() === undefined
                                      ? "Checking secure storage…"
                                      : touchIdSupported()
                                        ? "Save securely and unlock with Touch ID or your device screen lock."
                                        : "Secure saving isn’t available in this browser. You can still connect for this session."}
                                  </span>
                                </span>
                              </label>
                              <div>
                                <button
                                  type="submit"
                                  disabled={!canConnect()}
                                  aria-busy={busy()}
                                  class={primaryButton}
                                >
                                  {busy() ? "Connecting…" : "Connect account"}
                                </button>
                                <p class="mt-2 text-center text-xs leading-5 text-brand-slate-500">
                                  Connects to your real Hyperliquid account.
                                </p>
                              </div>
                            </form>
                          }
                        >
                          <div class="space-y-4">
                            <h3 class="text-lg font-medium text-slate-100">
                              {savedConnectionSupported()
                                ? "Your account is saved"
                                : "Reconnect your account"}
                            </h3>
                            <p class="text-sm leading-6 text-brand-slate-400">
                              {!savedConnectionSupported()
                                ? "This saved connection is no longer supported. Remove it, then connect with a key from your live Hyperliquid account."
                                : busy()
                                  ? "Complete the unlock prompt on your device."
                                  : "Unlock to reconnect and load your balances."}
                            </p>
                            <Show when={savedConnectionSupported()}>
                              <p class="break-all rounded-lg bg-brand-screen px-3 py-3 font-mono text-xs text-slate-300">
                                {apiWalletVaultMetadata()?.masterAddress}
                              </p>
                              <button
                                type="button"
                                disabled={busy()}
                                aria-busy={busy()}
                                class={primaryButton}
                                onClick={() => void handleUnlockVault()}
                              >
                                {busy() ? "Connecting…" : "Unlock and connect"}
                              </button>
                            </Show>
                            <button
                              type="button"
                              disabled={busy()}
                              class={`${secondaryButton} w-full`}
                              onClick={() => void handleForgetVault()}
                            >
                              {vaultAction() === "forgetting"
                                ? "Removing…"
                                : "Remove saved connection"}
                            </button>
                          </div>
                        </Show>
                      }
                    >
                      <div class="space-y-4">
                        <div class="flex items-center justify-between gap-3">
                          <h3 class="text-lg font-medium text-slate-100">
                            Hyperliquid
                          </h3>
                          <span class="rounded-full bg-brand-accent/10 px-2.5 py-1 text-xs font-medium text-brand-accent">
                            {connectionStatusLabel()}
                          </span>
                        </div>
                        <p class="break-all font-mono text-sm text-slate-200">
                          {hyperliquidConnection()?.masterAddress}
                        </p>
                        <p class="text-sm leading-6 text-brand-slate-400">
                          {isHyperliquidExecution()
                            ? "Orders use your real account balance."
                            : "Orders use practice funds. Your real balance is unchanged."}{" "}
                          Your existing account settings are used automatically.
                        </p>
                        <div class="flex gap-2">
                          <button
                            type="button"
                            disabled={isRefreshingAccount()}
                            class={secondaryButton}
                            onClick={() => void handleRefreshAccount()}
                          >
                            {isRefreshingAccount()
                              ? "Refreshing…"
                              : "Refresh balances"}
                          </button>
                          <button
                            type="button"
                            disabled={busy()}
                            class={secondaryButton}
                            onClick={handleDisconnect}
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    </Show>
                  </Show>

                  <Show when={executionIssue()}>
                    {(error) => (
                      <p
                        role="alert"
                        class="mt-4 rounded-lg border border-brand-red-400/25 bg-brand-red-400/5 px-3 py-3 text-sm leading-6 text-brand-red-400"
                      >
                        {error()}
                      </p>
                    )}
                  </Show>
                  <Show when={passkeyNameNotice()}>
                    <p
                      role="status"
                      class="mt-3 text-xs leading-5 text-brand-accent"
                    >
                      {passkeyNameNotice()}
                    </p>
                  </Show>

                  <Show
                    when={
                      hasSavedApiWalletVault() && savedConnectionSupported()
                    }
                  >
                    <details class="mt-5 border-t border-brand-border">
                      <summary class={summaryClass}>
                        Security preferences
                      </summary>
                      <label class="block pb-4">
                        <span class="mb-2 block text-sm text-slate-200">
                          Ask me to unlock again
                        </span>
                        <select
                          value={passkeyRequirement()}
                          disabled={busy()}
                          class="h-11 w-full rounded-lg border border-brand-border bg-brand-screen px-3 text-sm text-slate-200"
                          onChange={(event) =>
                            void handlePasskeyRequirementChange(
                              event.currentTarget.value as PasskeyRequirement,
                            )
                          }
                        >
                          <option value="one-hour">After 1 hour</option>
                          <option value="five-minutes">After 5 minutes</option>
                          <option value="every-refresh">
                            Every time I refresh
                          </option>
                        </select>
                        <span class="mt-2 block text-xs leading-5 text-brand-slate-500">
                          {passkeyRequirementDescription()}
                        </span>
                      </label>
                      <Show when={isHyperliquidConnected()}>
                        <button
                          type="button"
                          disabled={busy()}
                          class={`${secondaryButton} mb-4`}
                          onClick={() => void handleForgetVault()}
                        >
                          Remove saved connection
                        </button>
                      </Show>
                    </details>
                  </Show>

                  <Show when={isHyperliquidConnected()}>
                    <details class="mt-5 border-t border-brand-border">
                      <summary class={summaryClass}>Account details</summary>
                      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs">
                        <dt class="text-brand-slate-500">API key name</dt>
                        <dd class="break-all text-right text-slate-200">
                          {hyperliquidConnection()?.agentName ?? "Trading key"}
                        </dd>
                        <dt class="text-brand-slate-500">Key expires</dt>
                        <dd class="text-right text-slate-200">
                          {formatTimestamp(
                            hyperliquidConnection()?.agentValidUntil,
                          )}
                        </dd>
                        <dt class="text-brand-slate-500">Account type</dt>
                        <dd class="text-right text-slate-200">
                          {hyperliquidAccountModeLabel()}
                        </dd>
                        <dt class="text-brand-slate-500">Last updated</dt>
                        <dd class="text-right text-slate-200">
                          {formatRefreshTime(hyperliquidLastRefreshAt())}
                        </dd>
                      </dl>
                      <a
                        href={hyperliquidAppUrl("mainnet", "settings")}
                        target="_blank"
                        rel="noreferrer"
                        class="my-4 inline-flex text-xs font-medium text-brand-accent hover:underline"
                      >
                        Manage account on Hyperliquid ↗
                      </a>
                      <div class="-mx-5">
                        <ToggleRow
                          label="Practice trading"
                          description="Try orders with practice funds instead of your real balance."
                          checked={!isHyperliquidExecution()}
                          onChange={() =>
                            setHyperliquidExecutionEnabled(
                              !isHyperliquidExecution(),
                            )
                          }
                        />
                      </div>
                    </details>
                  </Show>
                  <Show when={!isHyperliquidExecution() && isAuthenticated()}>
                    <details class="mt-5 border-t border-brand-border">
                      <summary class={summaryClass}>
                        Practice trading settings
                      </summary>
                      <div class="-mx-5">
                        <ToggleRow
                          label="Share practice funds across positions"
                          description={marginDescription()}
                          checked={isPortfolioMarginEnabled()}
                          disabled={marginDisabled()}
                          busy={isTogglingMargin()}
                          onChange={() => void handleTogglePortfolioMargin()}
                        />
                      </div>
                      <Show when={marginError()}>
                        <p role="alert" class="pb-3 text-xs text-brand-red-400">
                          {marginError()}
                        </p>
                      </Show>
                    </details>
                  </Show>
                  <details class="mt-5 border-t border-brand-border">
                    <summary class={summaryClass}>
                      How your key is protected
                    </summary>
                    <div class="space-y-3 pb-1 text-xs leading-5 text-brand-slate-400">
                      <p>
                        Your key stays in this browser and is never sent to our
                        servers. Without “Remember on this device”, you’ll need
                        to enter it again after reloading.
                      </p>
                      <p>
                        If you save it, it is encrypted and requires your
                        device’s unlock method. While connected, the key is
                        available to this page, so only use browser extensions
                        you trust.
                      </p>
                      <p>
                        Disconnecting keeps the saved key locked. Removing the
                        saved connection deletes it from this browser. To revoke
                        the key completely, use{" "}
                        <a
                          href={hyperliquidAppUrl("mainnet", "API")}
                          target="_blank"
                          rel="noreferrer"
                          class="text-brand-accent hover:underline"
                        >
                          Hyperliquid’s API settings
                        </a>
                        .
                      </p>
                      <p>
                        Use a separate API key for each active trading app or
                        tab.
                      </p>
                    </div>
                  </details>
                </div>
              </Show>
            </div>
            <footer class="shrink-0 border-t border-brand-border px-6 py-3 text-xs text-brand-slate-500">
              Preferences save automatically on this browser.
            </footer>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default SettingsModal;
