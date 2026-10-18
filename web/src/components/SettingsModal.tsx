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
    class="toggle-row"
    onClick={props.onChange}
  >
    <span class="min-w-0">
      <span class="toggle-label">{props.label}</span>
      <span class="toggle-desc">{props.description}</span>
    </span>
    <span aria-hidden="true" class="switch" />
  </button>
);

const SectionTitle: Component<{ children: string }> = (props) => (
  <h3 class="settings-section-title">{props.children}</h3>
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
  const primaryButton = "btn btn-primary btn-lg btn-block";
  const secondaryButton = "btn btn-secondary btn-sm";

  return (
    <Show when={settingsOpen()}>
      <Portal>
        <div
          class="modal-backdrop"
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
            class="modal-panel modal-panel-lg"
          >
            <header class="shrink-0 pb-4 shadow-[inset_0_-1px_0_var(--color-brand-hairline)]">
              <div class="modal-header">
                <h2 id="settings-dialog-title" class="modal-title">
                  Settings
                </h2>
                <button
                  ref={closeButtonRef}
                  type="button"
                  aria-label="Close settings"
                  class="icon-btn modal-close"
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
              <nav
                aria-label="Settings sections"
                class="segmented mx-6 mt-3 w-fit"
              >
                <button
                  type="button"
                  aria-pressed={section() === "account"}
                  onClick={() => setSection("account")}
                >
                  Account
                </button>
                <button
                  type="button"
                  aria-pressed={section() === "appearance"}
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
                    <div class="px-6 pb-6 pt-4">
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
                <div class="px-6 pb-6 pt-5">
                  <Show
                    when={apiWalletVaultReady()}
                    fallback={
                      <p class="settings-copy">
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
                                <h3 class="settings-heading">
                                  Connect Hyperliquid
                                </h3>
                                <p class="settings-copy mt-1.5">
                                  Paste your API key. We’ll find your account
                                  and load your balances automatically.
                                </p>
                              </div>
                              <label class="field">
                                <span class="field-label">API key</span>
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
                                  class="field-input"
                                  onInput={(event) => {
                                    setApiWalletPrivateKey(
                                      event.currentTarget.value,
                                    );
                                    setExecutionActionError(undefined);
                                  }}
                                />
                              </label>
                              <p id="api-key-help" class="field-hint !mt-2">
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
                              <label class="flex cursor-pointer items-start gap-3 rounded-md bg-brand-screen p-3.5">
                                <input
                                  type="checkbox"
                                  checked={protectWithTouchId()}
                                  disabled={
                                    touchIdSupported() !== true || busy()
                                  }
                                  class="mt-0.5 h-[18px] w-[18px] shrink-0 accent-brand-accent disabled:opacity-40"
                                  onChange={(event) =>
                                    setProtectWithTouchId(
                                      event.currentTarget.checked,
                                    )
                                  }
                                />
                                <span>
                                  <span class="block text-[15px] font-medium text-brand-slate-100">
                                    Remember on this device
                                  </span>
                                  <span class="mt-1 block text-[13px] leading-5 text-brand-slate-500">
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
                                <p class="mt-3 text-center text-[13px] leading-5 text-brand-slate-500">
                                  Connects to your real Hyperliquid account.
                                </p>
                              </div>
                            </form>
                          }
                        >
                          <div class="space-y-4">
                            <h3 class="settings-heading">
                              {savedConnectionSupported()
                                ? "Your account is saved"
                                : "Reconnect your account"}
                            </h3>
                            <p class="settings-copy">
                              {!savedConnectionSupported()
                                ? "This saved connection is no longer supported. Remove it, then connect with a key from your live Hyperliquid account."
                                : busy()
                                  ? "Complete the unlock prompt on your device."
                                  : "Unlock to reconnect and load your balances."}
                            </p>
                            <Show when={savedConnectionSupported()}>
                              <p class="break-all rounded-md bg-brand-screen px-3.5 py-3 font-mono text-[13px] text-brand-slate-400">
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
                              class="btn btn-secondary btn-block"
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
                          <h3 class="settings-heading">Hyperliquid</h3>
                          <span class="badge badge-accent">
                            {connectionStatusLabel()}
                          </span>
                        </div>
                        <p class="break-all rounded-md bg-brand-screen px-3.5 py-3 font-mono text-[13px] text-brand-slate-100">
                          {hyperliquidConnection()?.masterAddress}
                        </p>
                        <p class="settings-copy">
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
                        class="notice notice-error mt-4"
                      >
                        {error()}
                      </p>
                    )}
                  </Show>
                  <Show when={passkeyNameNotice()}>
                    <p role="status" class="notice notice-success mt-3">
                      {passkeyNameNotice()}
                    </p>
                  </Show>

                  <Show
                    when={
                      hasSavedApiWalletVault() && savedConnectionSupported()
                    }
                  >
                    <details class="disclosure">
                      <summary>Security preferences</summary>
                      <label class="field pb-4">
                        <span class="field-label">Ask me to unlock again</span>
                        <select
                          value={passkeyRequirement()}
                          disabled={busy()}
                          class="field-input"
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
                        <span class="field-hint">
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
                    <details class="disclosure">
                      <summary>Account details</summary>
                      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13px]">
                        <dt class="text-brand-slate-500">API key name</dt>
                        <dd class="break-all text-right text-brand-slate-100">
                          {hyperliquidConnection()?.agentName ?? "Trading key"}
                        </dd>
                        <dt class="text-brand-slate-500">Key expires</dt>
                        <dd class="text-right text-brand-slate-100">
                          {formatTimestamp(
                            hyperliquidConnection()?.agentValidUntil,
                          )}
                        </dd>
                        <dt class="text-brand-slate-500">Account type</dt>
                        <dd class="text-right text-brand-slate-100">
                          {hyperliquidAccountModeLabel()}
                        </dd>
                        <dt class="text-brand-slate-500">Last updated</dt>
                        <dd class="text-right text-brand-slate-100">
                          {formatRefreshTime(hyperliquidLastRefreshAt())}
                        </dd>
                      </dl>
                      <a
                        href={hyperliquidAppUrl("mainnet", "settings")}
                        target="_blank"
                        rel="noreferrer"
                        class="my-4 inline-flex text-[13px] font-medium text-brand-accent hover:underline"
                      >
                        Manage account on Hyperliquid ↗
                      </a>
                      <div class="-mx-6">
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
                    <details class="disclosure">
                      <summary>Practice trading settings</summary>
                      <div class="-mx-6">
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
                        <p role="alert" class="pb-3 text-[13px] text-brand-red-400">
                          {marginError()}
                        </p>
                      </Show>
                    </details>
                  </Show>
                  <details class="disclosure">
                    <summary>How your key is protected</summary>
                    <div class="space-y-3 pb-2 text-[13px] leading-5 text-brand-slate-400">
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
            <footer class="modal-footer">
              Preferences save automatically on this browser.
            </footer>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default SettingsModal;
