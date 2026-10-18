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
      <div class="modal-backdrop" onClick={() => closeTransferModal()}>
        <div
          role="dialog"
          aria-labelledby="transfer-dialog-title"
          class="modal-panel"
          onClick={(event) => event.stopPropagation()}
        >
          <header class="modal-header">
            <div class="min-w-0">
              <h2 id="transfer-dialog-title" class="modal-title">
                Transfer USDC
              </h2>
              <p class="modal-subtitle">
                Transfer USDC between your Perps and Spot balances.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              class="icon-btn modal-close"
              onClick={() => closeTransferModal()}
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
            {/* Direction */}
            <div class="transfer-legs">
              <div class="transfer-leg">
                <span>From</span>
                <span>{fromLabel()}</span>
              </div>
              <button
                type="button"
                aria-label="Swap direction"
                onClick={toggleDirection}
                class="icon-btn transfer-swap"
              >
                <svg
                  aria-hidden="true"
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
                  <path d="M17 4l4 4-4 4" />
                  <path d="M21 8H7" />
                  <path d="M7 20l-4-4 4-4" />
                  <path d="M3 16h14" />
                </svg>
              </button>
              <div class="transfer-leg">
                <span>To</span>
                <span>{toLabel()}</span>
              </div>
            </div>

            {/* Amount Input */}
            <div class="amount-field">
              <input
                type="text"
                inputMode="decimal"
                aria-label="Amount"
                placeholder="Amount"
                value={amount()}
                onInput={(e) => setAmount(e.currentTarget.value)}
                disabled={loading()}
              />
              <button type="button" onClick={handleMax} class="chip-btn">
                MAX: {formatBalance(maxBalance())}
              </button>
            </div>

            {/* Error */}
            <Show when={error()}>
              <div role="alert" class="notice notice-error">
                {error()}
              </div>
            </Show>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading() || !amount()}
              class="btn btn-primary btn-lg btn-block"
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
