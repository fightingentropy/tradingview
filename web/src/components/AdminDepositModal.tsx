import {
  Component,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { convex } from "../lib/convex";
import { api } from "../../convex/_generated/api";
import { isAdmin } from "../stores/auth";

const AdminDepositModal: Component<{
  open: boolean;
  onClose: () => void;
}> = (props) => {
  const [amount, setAmount] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (props.open) {
      setAmount("");
      setError(null);
      setLoading(false);
    }
  });

  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setError(null);

    if (!isAdmin()) {
      setError("Admin access required.");
      return;
    }

    const parsedAmount = parseFloat(amount());
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a valid USDC amount.");
      return;
    }

    setLoading(true);
    try {
      await convex.mutation(api.admin.mintPerpsUSDC, {
        amount: parsedAmount,
        idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
      });
      props.onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deposit failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Show when={props.open}>
      <div
        class="symbol-search-overlay is-open"
        onClick={() => props.onClose()}
      >
        <div
          class="w-[min(420px,95vw)] rounded-2xl border border-brand-border bg-brand-surface shadow-2xl overflow-hidden"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-screen/70">
            <div class="flex-1 text-center">
              <h2 class="text-lg font-semibold text-slate-100">
                Admin Deposit USDC
              </h2>
              <p class="text-xs text-brand-slate-500">
                Mint demo USDC into your perps balance.
              </p>
            </div>
            <button
              type="button"
              class="text-brand-slate-400 hover:text-slate-100 absolute right-4"
              onClick={() => props.onClose()}
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

          <form class="px-5 py-5 space-y-5" onSubmit={handleSubmit}>
            <div class="rounded-xl border border-brand-border bg-brand-screen overflow-hidden">
              <div class="flex items-center gap-2 px-4 py-3">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="USDC amount"
                  value={amount()}
                  onInput={(e) => setAmount(e.currentTarget.value)}
                  disabled={loading()}
                  class="flex-1 bg-transparent text-slate-100 text-sm placeholder:text-brand-slate-500 outline-none"
                />
                <span class="text-xs text-brand-slate-500">USDC</span>
              </div>
            </div>

            <Show when={error()}>
              <div class="text-xs text-brand-red-400 text-center">
                {error()}
              </div>
            </Show>

            <button
              type="submit"
              disabled={loading() || !amount()}
              class="w-full rounded-xl bg-brand-accent/90 py-3 text-sm font-semibold text-brand-screen hover:bg-brand-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading() ? "Depositing..." : "Deposit USDC"}
            </button>
          </form>
        </div>
      </div>
    </Show>
  );
};

export default AdminDepositModal;
