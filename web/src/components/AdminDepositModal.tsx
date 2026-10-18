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
      <div class="modal-backdrop" onClick={() => props.onClose()}>
        <div
          role="dialog"
          aria-labelledby="admin-deposit-dialog-title"
          class="modal-panel"
          onClick={(event) => event.stopPropagation()}
        >
          <header class="modal-header">
            <div class="min-w-0">
              <h2 id="admin-deposit-dialog-title" class="modal-title">
                Admin Deposit USDC
              </h2>
              <p class="modal-subtitle">Mint demo USDC into your perps balance.</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              class="icon-btn modal-close"
              onClick={() => props.onClose()}
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

          <form class="modal-body" onSubmit={handleSubmit}>
            <div class="amount-field">
              <input
                type="text"
                inputMode="decimal"
                aria-label="USDC amount"
                placeholder="USDC amount"
                value={amount()}
                onInput={(e) => setAmount(e.currentTarget.value)}
                disabled={loading()}
              />
              <span class="amount-unit">USDC</span>
            </div>

            <Show when={error()}>
              <div role="alert" class="notice notice-error">
                {error()}
              </div>
            </Show>

            <button
              type="submit"
              disabled={loading() || !amount()}
              class="btn btn-primary btn-lg btn-block"
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
