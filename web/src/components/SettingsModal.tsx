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
  dataProvider,
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
import {
  closeSettings,
  settingsOpen,
} from "../stores/settings";
import {
  type HyperliquidAccountMode,
  type HyperliquidNetwork,
  connectHyperliquid,
  disconnectHyperliquid,
  hyperliquidAccountMode,
  hyperliquidAccountModeLabel,
  hyperliquidAccountRefreshError,
  hyperliquidConnection,
  hyperliquidConnectionError,
  hyperliquidConnectionStatus,
  hyperliquidLastRefreshAt,
  isHyperliquidConnected,
  isHyperliquidExecution,
  refreshHyperliquidAccount,
  setHyperliquidAccountMode,
  setHyperliquidExecutionEnabled,
} from "../stores/hyperliquidExecution";
import { isVaultTradingAccount } from "../stores/tradingAccount";
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
  renameApiWalletPasskey,
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
  <h3 class="border-b border-brand-border bg-brand-screen px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-slate-400">
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
  const [network, setNetwork] = createSignal<HyperliquidNetwork>("testnet");
  const [masterAddress, setMasterAddress] = createSignal("");
  const [apiWalletPrivateKey, setApiWalletPrivateKey] = createSignal("");
  const [mainnetConfirmation, setMainnetConfirmation] = createSignal("");
  const [executionActionError, setExecutionActionError] =
    createSignal<string>();
  const [isRefreshingAccount, setIsRefreshingAccount] = createSignal(false);
  const [modeAcknowledged, setModeAcknowledged] = createSignal(false);
  const [modeInFlight, setModeInFlight] = createSignal<
    Exclude<HyperliquidAccountMode, "default">
  >();
  const [protectWithTouchId, setProtectWithTouchId] = createSignal(false);
  const [touchIdSupported, setTouchIdSupported] = createSignal<boolean>();
  const [touchIdSupportError, setTouchIdSupportError] =
    createSignal<string>();
  const [vaultAction, setVaultAction] = createSignal<
    "enrolling" | "unlocking" | "reauthenticating" | "renaming" | "forgetting"
  >();
  const [passkeyNameNotice, setPasskeyNameNotice] = createSignal<string>();
  let dialogRef: HTMLDivElement | undefined;
  let closeButtonRef: HTMLButtonElement | undefined;
  let previouslyFocused: HTMLElement | null = null;

  const marginDisabled = () =>
    isTogglingMargin() ||
    isHyperliquidExecution() ||
    !isAuthenticated() ||
    isVaultTradingAccount();

  const marginDescription = () => {
    if (isHyperliquidExecution()) {
      return "Disabled while orders are routed to Hyperliquid. This setting only affects the local paper ledger.";
    }
    if (isHyperliquidConnected()) {
      return "Controls simulated collateral only while Hyperliquid execution is paused.";
    }
    if (!isAuthenticated()) return "Sign in to change your account margin mode.";
    if (isVaultTradingAccount()) {
      return "Paper vault accounts use the standard simulated margin model.";
    }
    return "Use eligible simulated spot balances as collateral for paper perpetual positions.";
  };

  const connectionStatusLabel = () => {
    if (apiWalletVaultRestorePending()) {
      return "Restoring API wallet";
    }
    if (apiWalletVaultUnlockPending()) {
      return "Waiting for device verification";
    }
    if (hyperliquidConnectionStatus() === "connecting") {
      return "Verifying API wallet";
    }
    if (!isHyperliquidConnected()) {
      return hasSavedApiWalletVault()
        ? "API wallet locked"
        : "Paper simulation";
    }
    return isHyperliquidExecution()
      ? "Hyperliquid execution enabled"
      : "Hyperliquid connected, paper simulation active";
  };

  const canConnect = () =>
    !apiWalletVaultUnlockPending() &&
    hyperliquidConnectionStatus() !== "connecting" &&
    masterAddress().trim().length > 0 &&
    apiWalletPrivateKey().trim().length > 0 &&
    (network() !== "mainnet" || mainnetConfirmation().trim() === "MAINNET");

  const executionIssue = () =>
    executionActionError() ??
    apiWalletVaultError() ??
    hyperliquidConnectionError() ??
    hyperliquidAccountRefreshError();

  const refreshTouchIdSupport = async () => {
    setTouchIdSupported(undefined);
    setTouchIdSupportError(undefined);
    const result = await ensureTouchIdSupport();
    setTouchIdSupported(result.ok);
    if (!result.ok) setTouchIdSupportError(result.error);
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
      network: network(),
      masterAddress: masterAddress(),
      apiWalletPrivateKey: privateKey,
      mainnetConfirmation: mainnetConfirmation(),
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
          "Connected, but the verified account was unavailable for Touch ID setup.",
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
          `Connected for this tab, but Touch ID setup failed: ${vaultResult.error}`,
        );
        return;
      }
      if (
        passkeyRequirement() !== "every-refresh" &&
        vaultResult.reloadGraceReady !== true
      ) {
        const preferenceSaved = setPasskeyRequirement("every-refresh");
        setPasskeyNameNotice(
          preferenceSaved
            ? "Timed reload is unavailable in this browser. Every refresh will require device verification."
            : "Timed reload is unavailable. This page now requires verification after refresh, but the browser could not save that preference.",
        );
      }
    } else {
      privateKey = "";
    }
    setMainnetConfirmation("");
    setProtectWithTouchId(false);
    setModeAcknowledged(false);
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
        "The saved API wallet was removed during verification.",
      );
      return;
    }
    if (
      passkeyRequirement() !== "every-refresh" &&
      !unlocked.reloadGraceReady
    ) {
      const preferenceSaved = setPasskeyRequirement("every-refresh");
      setPasskeyNameNotice(
        preferenceSaved
          ? "Timed reload is unavailable in this browser. Every refresh will require device verification."
          : "Timed reload is unavailable. This page now requires verification after refresh, but the browser could not save that preference.",
      );
    }
    const connectionPromise = connectHyperliquid({
      network: payload.network,
      masterAddress: payload.masterAddress,
      apiWalletPrivateKey: payload.apiWalletPrivateKey,
      mainnetConfirmation: payload.network === "mainnet" ? "MAINNET" : undefined,
    });
    payload.apiWalletPrivateKey = "0x";
    const result = await connectionPromise;
    setVaultAction(undefined);
    if (apiWalletVaultRevocationEpoch() !== revocationEpoch) {
      clearApiWalletSession();
      disconnectHyperliquid();
      setExecutionActionError(
        "The saved API wallet was removed during connection.",
      );
      return;
    }
    if (!result.ok) {
      clearApiWalletSession();
      setExecutionActionError(result.error);
      return;
    }
    setModeAcknowledged(false);
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
    setNetwork("testnet");
    setProtectWithTouchId(false);
    void refreshTouchIdSupport();
  };

  const handleRenamePasskey = async () => {
    if (vaultAction() || !isHyperliquidConnected()) return;
    setVaultAction("renaming");
    setExecutionActionError(undefined);
    setPasskeyNameNotice(undefined);
    const result = await renameApiWalletPasskey();
    setVaultAction(undefined);
    if (!result.ok) {
      setExecutionActionError(result.error);
      return;
    }
    setPasskeyNameNotice(
      "Name update sent. Your passkey provider should now show TradingView API Wallet.",
    );
  };

  const passkeyRequirementDescription = () => {
    switch (passkeyRequirement()) {
      case "five-minutes":
        return "Reloads reconnect without another prompt for 5 minutes after verification. Once the window expires, refresh asks for device verification automatically.";
      case "one-hour":
        return "Reloads reconnect without another prompt for 1 hour after verification. Once the window expires, refresh asks for device verification automatically.";
      default:
        return "Every refresh asks for Touch ID or device verification automatically.";
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
          "Verification is required for this page, but the browser could not save the passkey preference.",
        );
      }
      return;
    }

    if (!hasSavedApiWalletVault() || !isHyperliquidConnected()) {
      if (!setPasskeyRequirement(next)) {
        setExecutionActionError(
          "The browser could not save that passkey requirement. The previous setting is unchanged.",
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
        `Passkey requirement was not changed: ${verified.error}`,
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
        "The connection changed during verification. The passkey requirement was not changed.",
      );
      return;
    }
    if (!setPasskeyRequirement(next)) {
      payload.apiWalletPrivateKey = "0x";
      setVaultAction(undefined);
      setExecutionActionError(
        "The browser could not save that passkey requirement. The previous setting is unchanged.",
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
      !reloadGraceReady ||
      hyperliquidConnectionStatus() !== "connected" ||
      passkeyRequirement() !== next ||
      apiWalletVaultRevocationEpoch() !== revocationEpoch
    ) {
      clearApiWalletSession();
      setPasskeyRequirement("every-refresh");
      setVaultAction(undefined);
      setExecutionActionError(
        "Timed reload is unavailable in this browser. Every refresh will continue to require device verification.",
      );
      return;
    }
    setVaultAction(undefined);
    setPasskeyNameNotice(
      next === "five-minutes"
        ? "Verified. Reloads may reconnect for the next 5 minutes without another prompt."
        : "Verified. Reloads may reconnect for the next hour without another prompt.",
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
    setNetwork("testnet");
    setApiWalletPrivateKey("");
    setMainnetConfirmation("");
    setProtectWithTouchId(false);
    setModeAcknowledged(false);
    setExecutionActionError(undefined);
    setPasskeyNameNotice(undefined);
  };

  const handleSetAccountMode = async (
    mode: Exclude<HyperliquidAccountMode, "default">,
  ) => {
    if (
      !modeAcknowledged() ||
      modeInFlight() !== undefined ||
      hyperliquidAccountMode() !== "default"
    ) {
      return;
    }
    setModeInFlight(mode);
    setExecutionActionError(undefined);
    const result = await setHyperliquidAccountMode(mode);
    setModeInFlight(undefined);
    if (!result.ok) setExecutionActionError(result.error);
  };

  createEffect(() => {
    if (!settingsOpen()) return;

    previouslyFocused = document.activeElement as HTMLElement | null;
    setMarginError(undefined);
    setExecutionActionError(undefined);
    setApiWalletPrivateKey("");
    setMainnetConfirmation("");
    setProtectWithTouchId(false);
    setModeAcknowledged(false);
    setPasskeyNameNotice(undefined);
    if (!isHyperliquidConnected()) setNetwork("testnet");
    if (!hasSavedApiWalletVault()) void refreshTouchIdSupport();
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
      setMainnetConfirmation("");
      setProtectWithTouchId(false);
      setModeAcknowledged(false);
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

  return (
    <Show when={settingsOpen()}>
      <Portal>
        <div
          class="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
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
            class="flex max-h-[calc(100dvh-2rem)] w-[min(680px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-brand-border bg-[#111418] shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
          >
            <header class="flex shrink-0 items-start justify-between gap-4 border-b border-brand-border bg-brand-screen px-5 py-4">
              <div>
                <h2
                  id="settings-dialog-title"
                  class="text-lg font-semibold text-slate-100"
                >
                  Settings
                </h2>
                <p class="mt-1 text-xs text-brand-slate-500">
                  Interface preferences save locally. API wallets can be
                  protected for reload with Touch ID.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close settings"
                class="flex h-9 w-9 items-center justify-center rounded border border-brand-border text-brand-slate-400 transition-colors hover:border-brand-slate-600 hover:text-slate-100"
                onClick={closeSettings}
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

            <div class="min-h-0 flex-1 overflow-y-auto">
              <section>
                <SectionTitle>Execution</SectionTitle>
                <div class="border-b border-brand-border px-5 py-4">
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <p class="text-sm font-medium text-slate-100">
                        Trade source
                      </p>
                      <p class="mt-1 text-xs leading-5 text-brand-slate-500">
                        {isHyperliquidExecution()
                          ? "Spot and perpetual orders from the Trade ticket are signed by the connected API wallet and sent to Hyperliquid."
                          : "Orders use the local paper ledger and do not reach Hyperliquid."}
                      </p>
                    </div>
                    <span
                      class={`shrink-0 rounded border px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] ${
                        isHyperliquidExecution()
                          ? "border-brand-accent/50 text-brand-accent"
                          : "border-brand-border text-brand-slate-400"
                      }`}
                    >
                      {connectionStatusLabel()}
                    </span>
                  </div>
                </div>

                <Show
                  when={isHyperliquidConnected()}
                  fallback={
                    <Show
                      when={apiWalletVaultReady()}
                      fallback={
                        <div class="px-5 py-6 text-sm text-brand-slate-400">
                          Checking for a saved API wallet…
                        </div>
                      }
                    >
                      <Show
                        when={hasSavedApiWalletVault()}
                        fallback={
                          <form onSubmit={handleConnect}>
                      <div class="space-y-4 px-5 py-4">
                        <div>
                          <h4 class="text-sm font-medium text-slate-100">
                            Connect a Hyperliquid API wallet
                          </h4>
                          <p class="mt-1 text-xs leading-5 text-brand-slate-500">
                            Testnet is selected by default. The master address is
                            used to read the account; the approved agent signs
                            the permitted trading actions.
                          </p>
                        </div>

                        <label class="block">
                          <span class="mb-1.5 block text-xs font-medium text-slate-300">
                            Network
                          </span>
                          <select
                            value={network()}
                            disabled={
                              hyperliquidConnectionStatus() === "connecting"
                            }
                            class="h-10 w-full rounded border border-brand-border bg-brand-screen px-3 text-sm text-slate-100 outline-none transition-colors focus:border-brand-slate-500 disabled:opacity-50"
                            onChange={(event) => {
                              setNetwork(
                                event.currentTarget
                                  .value as HyperliquidNetwork,
                              );
                              setMainnetConfirmation("");
                              setExecutionActionError(undefined);
                            }}
                          >
                            <option value="testnet">Hyperliquid Testnet</option>
                            <option value="mainnet">Hyperliquid Mainnet</option>
                          </select>
                        </label>

                        <label class="block">
                          <span class="mb-1.5 block text-xs font-medium text-slate-300">
                            Master account address
                          </span>
                          <input
                            type="text"
                            inputmode="text"
                            autocomplete="off"
                            autocapitalize="none"
                            spellcheck={false}
                            value={masterAddress()}
                            disabled={
                              hyperliquidConnectionStatus() === "connecting"
                            }
                            placeholder="0x..."
                            class="h-10 w-full rounded border border-brand-border bg-brand-screen px-3 font-mono text-sm text-slate-100 outline-none transition-colors placeholder:text-brand-slate-600 focus:border-brand-slate-500 disabled:opacity-50"
                            onInput={(event) => {
                              setMasterAddress(event.currentTarget.value);
                              setExecutionActionError(undefined);
                            }}
                          />
                        </label>

                        <label class="block">
                          <span class="mb-1.5 block text-xs font-medium text-slate-300">
                            API-wallet private key
                          </span>
                          <input
                            type="password"
                            inputmode="text"
                            autocomplete="off"
                            autocapitalize="none"
                            spellcheck={false}
                            value={apiWalletPrivateKey()}
                            disabled={
                              hyperliquidConnectionStatus() === "connecting"
                            }
                            placeholder="0x followed by 64 hexadecimal characters"
                            aria-describedby="api-wallet-security-note"
                            class="h-10 w-full rounded border border-brand-border bg-brand-screen px-3 font-mono text-sm text-slate-100 outline-none transition-colors placeholder:text-brand-slate-600 focus:border-brand-slate-500 disabled:opacity-50"
                            onInput={(event) => {
                              setApiWalletPrivateKey(
                                event.currentTarget.value,
                              );
                              setExecutionActionError(undefined);
                            }}
                          />
                        </label>

                        <Show when={network() === "mainnet"}>
                          <label class="block rounded border border-brand-red-400/40 p-3">
                            <span class="block text-xs font-semibold text-brand-red-400">
                              Mainnet sends real orders
                            </span>
                            <span class="mt-1 block text-xs leading-5 text-brand-slate-400">
                              Type MAINNET exactly to confirm this live network
                              for the current connection.
                            </span>
                            <input
                              type="text"
                              autocomplete="off"
                              autocapitalize="characters"
                              spellcheck={false}
                              value={mainnetConfirmation()}
                              disabled={
                                hyperliquidConnectionStatus() === "connecting"
                              }
                              placeholder="MAINNET"
                              class="mt-2 h-9 w-full rounded border border-brand-border bg-brand-screen px-3 font-mono text-sm text-slate-100 outline-none focus:border-brand-red-400 disabled:opacity-50"
                              onInput={(event) =>
                                setMainnetConfirmation(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </label>
                        </Show>

                        <label class="flex items-start gap-3 rounded border border-brand-border bg-brand-screen/50 p-3">
                          <input
                            type="checkbox"
                            checked={protectWithTouchId()}
                            disabled={
                              touchIdSupported() !== true ||
                              hyperliquidConnectionStatus() === "connecting"
                            }
                            class="mt-0.5 h-4 w-4 accent-brand-accent disabled:opacity-50"
                            onChange={(event) =>
                              setProtectWithTouchId(
                                event.currentTarget.checked,
                              )
                            }
                          />
                          <span class="min-w-0">
                            <span class="block text-xs font-semibold text-slate-200">
                              Unlock after reload with Touch ID
                            </span>
                            <span class="mt-1 block text-xs leading-5 text-brand-slate-500">
                              {touchIdSupported() === undefined
                                ? "Checking this device’s secure-unlock support…"
                                : touchIdSupported()
                                  ? "Stores an AES-GCM encrypted vault. You can choose the reload verification window below."
                                  : (touchIdSupportError() ??
                                    "Touch ID unlock is unavailable in this browser.")}
                            </span>
                          </span>
                        </label>

                        <Show when={protectWithTouchId()}>
                          <label class="block">
                            <span class="mb-1.5 block text-xs font-medium text-slate-300">
                              Passkey requirement
                            </span>
                            <select
                              value={passkeyRequirement()}
                              disabled={
                                touchIdSupported() !== true ||
                                hyperliquidConnectionStatus() === "connecting"
                              }
                              class="h-10 w-full rounded border border-brand-border bg-brand-screen px-3 text-sm text-slate-100 outline-none transition-colors focus:border-brand-slate-500 disabled:opacity-50"
                              onChange={(event) => {
                                if (
                                  !setPasskeyRequirement(
                                    event.currentTarget
                                      .value as PasskeyRequirement,
                                  )
                                ) {
                                  setExecutionActionError(
                                    "The browser could not save that passkey requirement.",
                                  );
                                }
                              }}
                            >
                              <option value="five-minutes">
                                5 minutes (default)
                              </option>
                              <option value="every-refresh">Every refresh</option>
                              <option value="one-hour">1 hour</option>
                            </select>
                            <span class="mt-1.5 block text-xs leading-5 text-brand-slate-500">
                              The timer starts when device verification succeeds,
                              never extends on refresh, and defaults to 5 minutes.
                            </span>
                          </label>
                        </Show>

                        <button
                          type="submit"
                          disabled={!canConnect()}
                          aria-busy={
                            hyperliquidConnectionStatus() === "connecting"
                              ? "true"
                              : undefined
                          }
                          class="h-10 w-full rounded border border-brand-accent bg-brand-accent px-4 text-sm font-semibold text-brand-screen transition-colors hover:bg-brand-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {hyperliquidConnectionStatus() === "connecting"
                            ? "Verifying API wallet\u2026"
                            : network() === "mainnet"
                              ? "Connect to Mainnet"
                              : "Connect to Testnet"}
                        </button>
                      </div>
                          </form>
                        }
                      >
                        <div class="space-y-4 px-5 py-5">
                          <div>
                            <div class="flex items-center justify-between gap-3">
                              <h4 class="text-sm font-medium text-slate-100">
                                {apiWalletVaultRestorePending()
                                  ? "Restoring saved API wallet"
                                  : apiWalletVaultUnlockPending()
                                    ? "Waiting for device verification"
                                  : "Saved API wallet locked"}
                              </h4>
                              <span class="rounded border border-brand-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-brand-slate-400">
                                Encrypted
                              </span>
                            </div>
                            <p class="mt-1 text-xs leading-5 text-brand-slate-500">
                              {apiWalletVaultRestorePending()
                                ? "Checking the same-tab reload window before asking for device verification."
                                : apiWalletVaultUnlockPending()
                                  ? "Complete the Touch ID or Mac verification prompt to restore Hyperliquid execution."
                                : "The signing key is encrypted in this browser. Touch ID or Mac verification decrypts it for this tab, then Hyperliquid revalidates the API wallet before execution is enabled."}
                            </p>
                          </div>

                          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 rounded border border-brand-border bg-brand-screen/50 p-3 text-xs">
                            <dt class="text-brand-slate-500">Network</dt>
                            <dd class="text-right font-mono uppercase text-slate-200">
                              {apiWalletVaultMetadata()?.network ?? "Saved"}
                            </dd>
                            <dt class="text-brand-slate-500">Master</dt>
                            <dd class="break-all text-right font-mono text-slate-200">
                              {apiWalletVaultMetadata()?.masterAddress ??
                                "Encrypted vault"}
                            </dd>
                          </dl>

                          <label for="locked-passkey-requirement" class="block">
                            <span class="mb-1.5 block text-xs font-medium text-slate-300">
                              Passkey requirement
                            </span>
                            <select
                              id="locked-passkey-requirement"
                              value={passkeyRequirement()}
                              disabled={
                                vaultAction() !== undefined ||
                                apiWalletVaultRestorePending() ||
                                apiWalletVaultUnlockPending()
                              }
                              class="h-10 w-full rounded border border-brand-border bg-brand-screen px-3 text-sm text-slate-100 outline-none transition-colors focus:border-brand-slate-500 disabled:opacity-50"
                              onChange={(event) =>
                                void handlePasskeyRequirementChange(
                                  event.currentTarget
                                    .value as PasskeyRequirement,
                                )
                              }
                            >
                              <option value="five-minutes">
                                5 minutes (default)
                              </option>
                              <option value="every-refresh">Every refresh</option>
                              <option value="one-hour">1 hour</option>
                            </select>
                            <span class="mt-1.5 block text-xs leading-5 text-brand-slate-500">
                              {passkeyRequirementDescription()}
                            </span>
                          </label>

                          <button
                            type="button"
                            disabled={
                              vaultAction() !== undefined ||
                              apiWalletVaultRestorePending() ||
                              apiWalletVaultUnlockPending() ||
                              hyperliquidConnectionStatus() === "connecting"
                            }
                            aria-busy={
                              vaultAction() === "unlocking" ||
                              apiWalletVaultRestorePending() ||
                              apiWalletVaultUnlockPending()
                                ? "true"
                                : undefined
                            }
                            class="h-10 w-full rounded border border-brand-accent bg-brand-accent px-4 text-sm font-semibold text-brand-screen transition-colors hover:bg-brand-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleUnlockVault()}
                          >
                            {apiWalletVaultRestorePending()
                              ? "Restoring saved API wallet…"
                              : apiWalletVaultUnlockPending()
                                ? "Waiting for verification…"
                              : vaultAction() === "unlocking"
                                ? "Waiting for verification…"
                                : `Unlock ${
                                    apiWalletVaultMetadata()?.network === "mainnet"
                                      ? "Mainnet"
                                      : "Testnet"
                                  } with Touch ID`}
                          </button>

                          <button
                            type="button"
                            disabled={
                              vaultAction() !== undefined ||
                              apiWalletVaultRestorePending() ||
                              apiWalletVaultUnlockPending() ||
                              hyperliquidConnectionStatus() === "connecting"
                            }
                            class="h-9 w-full rounded border border-brand-border px-4 text-xs font-medium text-brand-slate-400 transition-colors hover:border-brand-red-400/60 hover:text-brand-red-400 disabled:opacity-50"
                            onClick={() => void handleForgetVault()}
                          >
                            {vaultAction() === "forgetting"
                              ? "Forgetting…"
                              : "Forget saved wallet on this browser"}
                          </button>
                        </div>
                      </Show>
                    </Show>
                  }
                >
                  <div class="divide-y divide-brand-border">
                    <ToggleRow
                      label="Use Hyperliquid for order execution"
                      description="When off, the trade ticket returns to paper simulation while the verified API-wallet connection remains in this tab."
                      checked={isHyperliquidExecution()}
                      onChange={() =>
                        setHyperliquidExecutionEnabled(
                          !isHyperliquidExecution(),
                        )
                      }
                    />

                    <div class="flex items-start justify-between gap-5 px-5 py-4">
                      <div class="min-w-0">
                        <h4 class="text-sm font-medium text-slate-100">
                          Touch ID unlock
                        </h4>
                        <p class="mt-1 text-xs leading-5 text-brand-slate-500">
                          {hasSavedApiWalletVault()
                            ? "Enabled for this browser. Reload behavior follows the passkey requirement below."
                            : "Not enabled. Disconnect and reconnect with the Touch ID option selected to protect this API wallet."}
                        </p>
                      </div>
                      <Show when={hasSavedApiWalletVault()}>
                        <div class="flex shrink-0 gap-2">
                          <button
                            type="button"
                            disabled={vaultAction() !== undefined}
                            class="rounded border border-brand-border px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-brand-slate-600 hover:text-slate-100 disabled:opacity-50"
                            onClick={() => void handleRenamePasskey()}
                          >
                            {vaultAction() === "renaming"
                              ? "Updating…"
                              : "Rename passkey"}
                          </button>
                          <button
                            type="button"
                            disabled={vaultAction() !== undefined}
                            class="rounded border border-brand-border px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-brand-red-400/60 hover:text-brand-red-400 disabled:opacity-50"
                            onClick={() => void handleForgetVault()}
                          >
                            {vaultAction() === "forgetting"
                              ? "Forgetting…"
                              : "Forget device"}
                          </button>
                        </div>
                      </Show>
                    </div>
                    <Show when={passkeyNameNotice()}>
                      <p class="px-5 pb-4 text-xs leading-5 text-brand-accent">
                        {passkeyNameNotice()}
                      </p>
                    </Show>

                    <Show when={hasSavedApiWalletVault()}>
                      <div class="flex flex-col items-start gap-3 px-5 py-4 sm:flex-row sm:justify-between sm:gap-5">
                        <div class="min-w-0 pr-4">
                          <label
                            for="passkey-requirement"
                            class="text-sm font-medium text-slate-100"
                          >
                            Passkey requirement
                          </label>
                          <p class="mt-1 text-xs leading-5 text-brand-slate-500">
                            {vaultAction() === "reauthenticating"
                              ? "Waiting for device verification…"
                              : `${passkeyRequirementDescription()} Disconnecting or forgetting the wallet clears the window.`}
                          </p>
                        </div>
                        <select
                          id="passkey-requirement"
                          value={passkeyRequirement()}
                          disabled={
                            vaultAction() !== undefined ||
                            apiWalletVaultUnlockPending()
                          }
                          class="h-9 w-full shrink-0 rounded border border-brand-border bg-brand-screen px-3 text-sm text-slate-200 outline-none transition-colors focus:border-brand-slate-500 disabled:opacity-50 sm:w-auto sm:min-w-48"
                          onChange={(event) =>
                            void handlePasskeyRequirementChange(
                              event.currentTarget.value as PasskeyRequirement,
                            )
                          }
                        >
                          <option value="five-minutes">
                            5 minutes (default)
                          </option>
                          <option value="every-refresh">Every refresh</option>
                          <option value="one-hour">1 hour</option>
                        </select>
                      </div>
                    </Show>

                    <div class="px-5 py-4">
                      <div class="flex items-center justify-between gap-4">
                        <h4 class="text-sm font-medium text-slate-100">
                          Connected account
                        </h4>
                        <div class="flex gap-2">
                          <button
                            type="button"
                            disabled={isRefreshingAccount()}
                            aria-busy={
                              isRefreshingAccount() ? "true" : undefined
                            }
                            class="rounded border border-brand-border px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-brand-slate-600 hover:text-slate-100 disabled:opacity-50"
                            onClick={() => void handleRefreshAccount()}
                          >
                            {isRefreshingAccount() ? "Refreshing\u2026" : "Refresh"}
                          </button>
                          <button
                            type="button"
                            disabled={vaultAction() !== undefined}
                            class="rounded border border-brand-border px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-brand-red-400/60 hover:text-brand-red-400 disabled:opacity-50"
                            onClick={handleDisconnect}
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>

                      <dl class="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-x-5 gap-y-2 text-xs">
                        <dt class="text-brand-slate-500">Network</dt>
                        <dd class="text-right font-mono uppercase text-slate-200">
                          {hyperliquidConnection()?.network}
                        </dd>
                        <dt class="text-brand-slate-500">Master</dt>
                        <dd class="break-all text-right font-mono text-slate-200">
                          {hyperliquidConnection()?.masterAddress}
                        </dd>
                        <dt class="text-brand-slate-500">API wallet</dt>
                        <dd class="break-all text-right font-mono text-slate-200">
                          {hyperliquidConnection()?.agentAddress}
                        </dd>
                        <dt class="text-brand-slate-500">Agent name</dt>
                        <dd class="text-right text-slate-200">
                          {hyperliquidConnection()?.agentName ?? "Unnamed agent"}
                        </dd>
                        <dt class="text-brand-slate-500">Agent expiry</dt>
                        <dd class="text-right text-slate-200">
                          {formatTimestamp(
                            hyperliquidConnection()?.agentValidUntil,
                          )}
                        </dd>
                        <dt class="text-brand-slate-500">Account mode</dt>
                        <dd class="text-right text-slate-200">
                          {hyperliquidAccountModeLabel()}
                        </dd>
                        <dt class="text-brand-slate-500">Last refresh</dt>
                        <dd class="text-right text-slate-200">
                          {formatRefreshTime(hyperliquidLastRefreshAt())}
                        </dd>
                      </dl>
                    </div>

                    <div class="px-5 py-4">
                      <h4 class="text-sm font-medium text-slate-100">
                        Hyperliquid account mode
                      </h4>
                      <Show
                        when={hyperliquidAccountMode() === "default"}
                        fallback={
                          <div>
                            <p class="mt-1 text-xs leading-5 text-brand-slate-500">
                              {hyperliquidAccountModeLabel()} mode is read-only
                              here. Existing-mode transitions require the master
                              wallet in Hyperliquid Settings; this app will never
                              request that key.
                            </p>
                            <a
                              href={hyperliquidAppUrl(
                                hyperliquidConnection()?.network ?? "mainnet",
                                "settings",
                              )}
                              target="_blank"
                              rel="noreferrer"
                              class="mt-2 inline-flex text-xs font-medium text-brand-accent hover:underline"
                            >
                              Open Hyperliquid Settings
                            </a>
                          </div>
                        }
                      >
                        <div>
                          <p class="mt-1 text-xs leading-5 text-brand-slate-500">
                            This account is still in Default mode. An approved
                            API wallet can make one initial selection only.
                            After initialization, changes require the master
                            wallet in Hyperliquid Settings.
                          </p>
                          <label class="mt-3 flex items-start gap-2.5 text-xs leading-5 text-slate-300">
                            <input
                              type="checkbox"
                              checked={modeAcknowledged()}
                              disabled={modeInFlight() !== undefined}
                              class="mt-1 h-3.5 w-3.5 accent-brand-accent"
                              onChange={(event) =>
                                setModeAcknowledged(
                                  event.currentTarget.checked,
                                )
                              }
                            />
                            <span>
                              I understand this initializes the account mode and
                              cannot be reversed here with the API wallet.
                            </span>
                          </label>
                          <div class="mt-3 grid gap-2 sm:grid-cols-3">
                            <button
                              type="button"
                              disabled={
                                !modeAcknowledged() ||
                                modeInFlight() !== undefined
                              }
                              class="rounded border border-brand-border px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:border-brand-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() =>
                                void handleSetAccountMode("disabled")
                              }
                            >
                              <span class="block font-semibold">Standard</span>
                              <span class="mt-0.5 block text-[11px] text-brand-slate-500">
                                Separate spot and perps margin
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={
                                !modeAcknowledged() ||
                                modeInFlight() !== undefined
                              }
                              class="rounded border border-brand-border px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:border-brand-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() =>
                                void handleSetAccountMode("unifiedAccount")
                              }
                            >
                              <span class="block font-semibold">Unified</span>
                              <span class="mt-0.5 block text-[11px] text-brand-slate-500">
                                Shared eligible collateral
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={
                                !modeAcknowledged() ||
                                modeInFlight() !== undefined
                              }
                              class="rounded border border-brand-border px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:border-brand-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() =>
                                void handleSetAccountMode("portfolioMargin")
                              }
                            >
                              <span class="block font-semibold">Portfolio</span>
                              <span class="mt-0.5 block text-[11px] text-brand-slate-500">
                                Risk-based; exchange eligibility applies
                              </span>
                            </button>
                          </div>
                          <Show when={modeInFlight()}>
                            {(mode) => (
                              <p
                                class="mt-2 text-xs text-brand-slate-400"
                                aria-live="polite"
                              >
                                Initializing {mode()}\u2026
                              </p>
                            )}
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </div>
                </Show>

                <div
                  id="api-wallet-security-note"
                  class="border-t border-brand-border bg-brand-screen px-5 py-4"
                >
                  <p class="text-xs font-semibold text-slate-200">
                    API-wallet security
                  </p>
                  <ul class="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-brand-slate-500">
                    <li>
                      Never enter a master private key or seed phrase. Use only
                      a Hyperliquid-approved API-wallet (agent) private key.
                    </li>
                    <li>
                      While connected, the decrypted key exists in this tab's
                      memory. A timed reload window also keeps a short-lived
                      copy in a same-origin browser worker. Page scripts and
                      browser extensions can access it while the vault is
                      unlocked.
                    </li>
                    <li>
                      Touch ID protection stores only AES-GCM ciphertext in
                      IndexedDB. The WebAuthn passkey recreates the decryption
                      key after device verification; TradingView never writes the
                      plaintext private key, PRF output, or decryption key to
                      Web Storage, IndexedDB, or Convex.
                    </li>
                    <li>
                      Timed windows apply only to qualifying same-tab reloads
                      and never extend on refresh. After expiry, the next reload
                      requires device verification; an already open connection
                      is not interrupted. Browser memory loss can require
                      verification sooner.
                    </li>
                    <li>
                      WebAuthn can use Touch ID, Apple Watch, or the Mac login
                      password. The website requires device verification but
                      cannot force fingerprint-only authentication.
                    </li>
                    <li>
                      Disconnecting locks the local session and keeps the saved
                      ciphertext. Forgetting removes it from this browser.
                      Neither action revokes the API wallet on Hyperliquid.
                    </li>
                    <li>
                      One API wallet can have one live TradingView tab at a time.
                      Use a separate agent for another tab or trading process.
                    </li>
                  </ul>
                </div>

                <Show when={executionIssue()}>
                  {(error) => (
                    <p
                      class="border-t border-brand-border px-5 py-3 text-xs leading-5 text-brand-red-400"
                      role="alert"
                    >
                      {error()}
                    </p>
                  )}
                </Show>
              </section>

              <section class="border-t border-brand-border">
                <SectionTitle>Layout</SectionTitle>
                <div class="divide-y divide-brand-border">
                  <ToggleRow
                    label="Watchlist panel"
                    description="Show the resizable market list beside the trade chart on desktop."
                    checked={showWatchlist()}
                    onChange={() => setShowWatchlist((value) => !value)}
                  />
                  <ToggleRow
                    label="Order book"
                    description="Show live bids and asks beside the order form."
                    checked={showOrderBook()}
                    onChange={() => setShowOrderBook((value) => !value)}
                  />
                  <ToggleRow
                    label="Account panel"
                    description="Show balances, positions and order history below the chart."
                    checked={showAccountPanel()}
                    onChange={() => setShowAccountPanel((value) => !value)}
                  />
                </div>
              </section>

              <section class="border-t border-brand-border">
                <SectionTitle>Chart</SectionTitle>
                <div class="divide-y divide-brand-border">
                  <ToggleRow
                    label="Volume bars"
                    description="Display traded volume at the bottom of every chart."
                    checked={showChartVolume()}
                    onChange={() => setShowChartVolume((value) => !value)}
                  />
                  <ToggleRow
                    label="Price grid"
                    description="Display horizontal and vertical grid lines on charts."
                    checked={showChartGrid()}
                    onChange={() => setShowChartGrid((value) => !value)}
                  />
                </div>
              </section>

              <section class="border-t border-brand-border">
                <SectionTitle>Accessibility</SectionTitle>
                <ToggleRow
                  label="Reduce motion"
                  description="Minimize interface transitions and repeating animation."
                  checked={reduceMotion()}
                  onChange={() => setReduceMotion((value) => !value)}
                />
              </section>

              <section class="border-t border-brand-border">
                <SectionTitle>Paper mode</SectionTitle>
                <ToggleRow
                  label="Portfolio margin simulation"
                  description={marginDescription()}
                  checked={isPortfolioMarginEnabled()}
                  disabled={marginDisabled()}
                  busy={isTogglingMargin()}
                  onChange={() => void handleTogglePortfolioMargin()}
                />
                <Show when={marginError()}>
                  {(error) => (
                    <p
                      class="border-t border-brand-border px-5 py-3 text-xs text-brand-red-400"
                      aria-live="polite"
                    >
                      {error()}
                    </p>
                  )}
                </Show>
              </section>

              <section class="border-t border-brand-border">
                <SectionTitle>Data</SectionTitle>
                <div class="flex min-h-16 items-center justify-between gap-6 px-5 py-3.5">
                  <span>
                    <span class="block text-sm font-medium text-slate-100">
                      Market data provider
                    </span>
                    <span class="mt-1 block text-xs leading-5 text-brand-slate-500">
                      Live prices, candles and market metadata.
                    </span>
                  </span>
                  <span class="font-mono text-xs text-slate-300">
                    {dataProvider() === "hyperliquid"
                      ? "Hyperliquid"
                      : dataProvider()}
                  </span>
                </div>
              </section>
            </div>

            <footer class="flex shrink-0 items-center justify-between border-t border-brand-border bg-brand-screen px-5 py-3">
              <p class="text-xs text-brand-slate-500">
                Interface preferences and encrypted Touch ID vault data stay on
                this browser.
              </p>
              <button
                type="button"
                class="rounded px-2 py-1.5 text-xs text-brand-slate-400 transition-colors hover:bg-brand-surface hover:text-slate-100"
                onClick={resetInterfaceSettings}
              >
                Reset interface defaults
              </button>
            </footer>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default SettingsModal;
