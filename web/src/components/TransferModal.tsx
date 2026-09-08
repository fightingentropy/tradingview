import {
  Component,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { getAvailableBalance } from "../stores/clob";
import {
  closeTransferModal,
  getSpotBalance,
  transferDirection,
  transferModalOpen,
  transferUSDC,
} from "../stores/wallet";

const formatBalance = (value: number) => {
  if (!Number.isFinite(value)) return "0.00";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const TransferModal: Component = () => {
  const [direction, setDirection] = createSignal<"perpsToSpot" | "spotToPerps">(
    "perpsToSpot",
  );
  const [amount, setAmount] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Sync direction from store when modal opens
  createEffect(() => {
    if (transferModalOpen()) {
      setDirection(transferDirection());
      setAmount("");
      setError(null);
    }
  });

  // Close on Escape
  createEffect(() => {
    if (!transferModalOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTransferModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const maxBalance = () => {
    if (direction() === "perpsToSpot") {
      return getAvailableBalance("USDC");
    }
    return getSpotBalance("USDC");
  };

  const fromLabel = () => (direction() === "perpsToSpot" ? "Perps" : "Spot");
  const toLabel = () => (direction() === "perpsToSpot" ? "Spot" : "Perps");

  const toggleDirection = () => {
    setDirection((prev) =>
      prev === "perpsToSpot" ? "spotToPerps" : "perpsToSpot",
    );
    setAmount("");
    setError(null);
  };

  const handleMax = () => {
    const max = maxBalance();
    setAmount(max > 0 ? max.toString() : "");
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setError(null);

    const parsedAmount = parseFloat(amount());
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a valid amount.");
      return;
    }

    if (parsedAmount > maxBalance()) {
      setError("Amount exceeds available balance.");
      return;
    }

    setLoading(true);
    const result = await transferUSDC({
      amount: parsedAmount,
      direction: direction(),
    });
    setLoading(false);

    if (result.ok) {
      closeTransferModal();
    } else {
      setError(result.error ?? "Transfer failed.");
    }
  };

  return (
    <Show when={transferModalOpen()}>
      <div
        class="symbol-search-overlay is-open"
        onClick={() => closeTransferModal()}
      >
        <div
          class="w-[min(420px,95vw)] rounded-2xl border border-brand-border bg-brand-surface shadow-2xl overflow-hidden"
          onClick={(event) => event.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-screen/70">
            <div class="flex-1 text-center">
              <h2 class="text-lg font-semibold text-slate-100">Transfer USDC</h2>
              <p class="text-xs text-brand-slate-500">
                Transfer USDC between your Perps and Spot balances.
              </p>
            </div>
            <button
              type="button"
              class="text-brand-slate-400 hover:text-slate-100 absolute right-4"
              onClick={() => closeTransferModal()}
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
            {/* Direction Toggle */}
            <div class="flex items-center justify-center gap-3">
              <button
                type="button"
                class="px-4 py-2 rounded-lg bg-brand-screen border border-brand-border text-sm font-medium text-slate-100"
              >
                {fromLabel()}
              </button>
              <button
                type="button"
                onClick={toggleDirection}
                class="p-2 rounded-lg bg-brand-screen border border-brand-border text-brand-accent hover:bg-brand-accent/10 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M7 16V4M7 4L3 8M7 4L11 8" />
                  <path d="M17 8V20M17 20L21 16M17 20L13 16" />
                </svg>
              </button>
              <button
                type="button"
                class="px-4 py-2 rounded-lg bg-brand-screen border border-brand-border text-sm font-medium text-slate-100"
              >
                {toLabel()}
              </button>
            </div>

            {/* Amount Input */}
            <div class="rounded-xl border border-brand-border bg-brand-screen overflow-hidden">
              <div class="flex items-center gap-2 px-4 py-3">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Amount"
                  value={amount()}
                  onInput={(e) => setAmount(e.currentTarget.value)}
                  disabled={loading()}
                  class="flex-1 bg-transparent text-slate-100 text-sm placeholder:text-brand-slate-500 outline-none"
                />
                <button
                  type="button"
                  onClick={handleMax}
                  class="text-brand-accent text-sm font-medium hover:underline whitespace-nowrap"
                >
                  MAX: {formatBalance(maxBalance())}
                </button>
              </div>
            </div>

            {/* Error */}
            <Show when={error()}>
              <div class="text-xs text-brand-red-400 text-center">
                {error()}
              </div>
            </Show>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading() || !amount()}
              class="w-full rounded-xl bg-brand-accent/90 py-3 text-sm font-semibold text-brand-screen hover:bg-brand-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading() ? "Transferring..." : "Confirm"}
            </button>
          </form>
        </div>
      </div>
    </Show>
  );
};

export default TransferModal;
