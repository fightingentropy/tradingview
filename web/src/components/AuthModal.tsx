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
      <div class="symbol-search-overlay is-open" onClick={() => closeAuth()}>
        <div
          class="w-[min(420px,95vw)] rounded-2xl border border-brand-border bg-brand-surface shadow-2xl overflow-hidden"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-screen/70">
            <div>
              <h2 class="text-lg font-semibold text-slate-100">
                {mode() === "signIn" ? "Sign in" : "Create account"}
              </h2>
              <p class="text-xs text-brand-slate-500">
                Custom auth for TradingView
              </p>
            </div>
            <button
              type="button"
              class="text-brand-slate-400 hover:text-slate-100"
              onClick={() => closeAuth()}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="M6 6 18 18" />
              </svg>
            </button>
          </div>

          <div class="px-5 pt-4">
            <div class="rounded-xl border border-brand-border bg-brand-screen/80 p-1 flex gap-1">
              <button
                type="button"
                class={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode() === "signIn"
                    ? "bg-brand-accent text-brand-screen"
                    : "text-brand-slate-400 hover:text-slate-100"
                }`}
                onClick={() => switchMode("signIn")}
              >
                Sign in
              </button>
              <button
                type="button"
                class={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode() === "signUp"
                    ? "bg-brand-accent text-brand-screen"
                    : "text-brand-slate-400 hover:text-slate-100"
                }`}
                onClick={() => switchMode("signUp")}
              >
                Create account
              </button>
            </div>
          </div>

          <form class="px-5 py-4 space-y-4" onSubmit={submit}>
            <Show when={mode() === "signUp"}>
              <div class="space-y-1">
                <label class="text-xs text-brand-slate-500">Name</label>
                <input
                  type="text"
                  autocomplete="name"
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                  disabled={authLoading()}
                  class="w-full rounded-lg border border-brand-border bg-brand-screen px-3 py-2 text-sm text-slate-100 placeholder:text-brand-slate-500 focus:border-brand-accent"
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

            <div class="space-y-1">
              <label class="text-xs text-brand-slate-500">Email</label>
              <input
                type="email"
                autocomplete="email"
                value={email()}
                onInput={(event) => setEmail(event.currentTarget.value)}
                disabled={authLoading()}
                class="w-full rounded-lg border border-brand-border bg-brand-screen px-3 py-2 text-sm text-slate-100 placeholder:text-brand-slate-500 focus:border-brand-accent"
                placeholder="you@trader.xyz"
              />
            </div>

            <div class="space-y-1">
              <label class="text-xs text-brand-slate-500">Password</label>
              <input
                type="password"
                autocomplete={
                  mode() === "signIn" ? "current-password" : "new-password"
                }
                value={password()}
                onInput={(event) => setPassword(event.currentTarget.value)}
                disabled={authLoading()}
                class="w-full rounded-lg border border-brand-border bg-brand-screen px-3 py-2 text-sm text-slate-100 placeholder:text-brand-slate-500 focus:border-brand-accent"
                placeholder="********"
              />
            </div>

            <Show when={localError() || authError()}>
              <div class="text-xs text-brand-red-400">
                {localError() ?? authError()}
              </div>
            </Show>

            <button
              type="submit"
              disabled={authLoading()}
              class="w-full rounded-xl bg-brand-accent py-2.5 text-sm font-semibold text-brand-screen hover:brightness-105 disabled:opacity-60"
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
