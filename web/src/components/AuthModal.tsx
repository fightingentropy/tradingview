import {
  Component,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  authError,
  authLoading,
  authOpen,
  clearAuthError,
  closeAuth,
  signIn,
  signUp,
} from "../stores/auth";
import { TurnstileWidget } from "./TurnstileWidget";

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();

const AuthModal: Component = () => {
  const [mode, setMode] = createSignal<"signIn" | "signUp">("signIn");
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [localError, setLocalError] = createSignal<string | null>(null);
  const [turnstileToken, setTurnstileToken] = createSignal<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = createSignal(0);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setLocalError(null);
    setTurnstileToken(null);
    setMode("signIn");
  };

  createEffect(() => {
    if (!authOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAuth();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  createEffect(() => {
    if (!authOpen()) return;
    clearAuthError();
    setLocalError(null);
  });

  createEffect(() => {
    if (authOpen()) return;
    resetForm();
  });

  const submit = async (event: Event) => {
    event.preventDefault();
    setLocalError(null);
    if (!email().trim() || !password().trim()) {
      setLocalError("Email and password are required.");
      return;
    }
    if (mode() === "signUp" && turnstileSiteKey && !turnstileToken()) {
      setLocalError("Complete the signup verification challenge.");
      return;
    }
    const ok =
      mode() === "signIn"
        ? await signIn({ email: email(), password: password() })
        : await signUp({
            email: email(),
            password: password(),
            name: name().trim() || undefined,
            turnstileToken: turnstileToken() ?? undefined,
          });
    if (ok) {
      resetForm();
    } else if (mode() === "signUp" && turnstileSiteKey) {
      setTurnstileToken(null);
      setTurnstileResetKey((value) => value + 1);
    }
  };

  const switchMode = (nextMode: "signIn" | "signUp") => {
    if (nextMode === mode()) return;
    setMode(nextMode);
    clearAuthError();
    setLocalError(null);
    setTurnstileToken(null);
  };

  return (
    <Show when={authOpen()}>
      <div class="modal-backdrop" onClick={() => closeAuth()}>
        <div
          role="dialog"
          aria-labelledby="auth-dialog-title"
          class="modal-panel"
          onClick={(event) => event.stopPropagation()}
        >
          <header class="modal-header">
            <div class="min-w-0">
              <h2 id="auth-dialog-title" class="modal-title">
                {mode() === "signIn" ? "Sign in" : "Create account"}
              </h2>
              <p class="modal-subtitle">Custom auth for TradingView</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              class="icon-btn modal-close"
              onClick={() => closeAuth()}
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="M6 6 18 18" />
              </svg>
            </button>
          </header>

          <form class="modal-body" onSubmit={submit}>
            <div class="segmented segmented-fill">
              <button
                type="button"
                aria-pressed={mode() === "signIn"}
                onClick={() => switchMode("signIn")}
              >
                Sign in
              </button>
              <button
                type="button"
                aria-pressed={mode() === "signUp"}
                onClick={() => switchMode("signUp")}
              >
                Create account
              </button>
            </div>

            <Show when={mode() === "signUp"}>
              <div class="field">
                <label for="auth-name" class="field-label">
                  Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  autocomplete="name"
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                  disabled={authLoading()}
                  class="field-input"
                  placeholder="Demo Trader"
                />
              </div>
            </Show>

            <Show when={mode() === "signUp" && turnstileSiteKey}>
              <TurnstileWidget
                siteKey={turnstileSiteKey as string}
                resetKey={turnstileResetKey()}
                onToken={setTurnstileToken}
              />
            </Show>

            <div class="field">
              <label for="auth-email" class="field-label">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                autocomplete="email"
                value={email()}
                onInput={(event) => setEmail(event.currentTarget.value)}
                disabled={authLoading()}
                class="field-input"
                placeholder="you@trader.xyz"
              />
            </div>

            <div class="field">
              <label for="auth-password" class="field-label">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                autocomplete={
                  mode() === "signIn" ? "current-password" : "new-password"
                }
                value={password()}
                onInput={(event) => setPassword(event.currentTarget.value)}
                disabled={authLoading()}
                class="field-input"
                placeholder="********"
              />
            </div>

            <Show when={localError() || authError()}>
              <div role="alert" class="notice notice-error">
                {localError() ?? authError()}
              </div>
            </Show>

            <button
              type="submit"
              disabled={authLoading()}
              class="btn btn-primary btn-lg btn-block"
            >
              {authLoading()
                ? "Working..."
                : mode() === "signIn"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </Show>
  );
};

export default AuthModal;
