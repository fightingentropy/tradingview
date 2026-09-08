import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  createVault,
  depositVault,
  setActiveVaultId,
  vaultDetail,
  vaultsList,
  withdrawVault,
} from "../stores/vaults";
import { currentVaultId, setCurrentPage } from "../stores/page";
import { isAuthenticated } from "../stores/auth";
import { getBalance } from "../stores/clob";
import { setTradingAccountToVault } from "../stores/tradingAccount";
import type { Id } from "../../convex/_generated/dataModel";

const formatUsd = (value?: number) => {
  if (!Number.isFinite(value ?? NaN)) return "--";
  const numeric = Number(value);
  const formatted = Math.abs(numeric).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${numeric < 0 ? "-" : ""}$${formatted}`;
};

const formatShares = (value?: number) => {
  if (!Number.isFinite(value ?? NaN)) return "--";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
};

const parseNumber = (value: string) => {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const Vaults: Component = () => {
  const [createName, setCreateName] = createSignal("");
  const [createLoading, setCreateLoading] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [modalOpen, setModalOpen] = createSignal(false);
  const [modalMode, setModalMode] = createSignal<"deposit" | "withdraw">(
    "deposit",
  );
  const [modalAmount, setModalAmount] = createSignal("");
  const [modalError, setModalError] = createSignal<string | null>(null);
  const [modalLoading, setModalLoading] = createSignal(false);

  const vaults = () => vaultsList();
  const detail = () => vaultDetail();

  createEffect(() => {
    setActiveVaultId(
      currentVaultId() ? (currentVaultId() as Id<"vaults">) : null,
    );
  });

  const sharePrice = createMemo(() => detail()?.sharePrice ?? 0);
  const memberShares = createMemo(() => detail()?.memberShares ?? 0);
  const memberCostBasis = createMemo(() => detail()?.memberCostBasisUSDC ?? 0);

  const memberValue = createMemo(() => memberShares() * sharePrice());
  const memberProfit = createMemo(() =>
    Math.max(0, memberValue() - memberCostBasis()),
  );

  const maxDeposit = () => getBalance("USDC");
  const maxWithdraw = () => memberShares();

  const modalParsed = createMemo(() => parseNumber(modalAmount()));
  const modalShares = createMemo(() =>
    modalMode() === "deposit"
      ? modalParsed() / (sharePrice() || 1)
      : modalParsed(),
  );

  const modalValue = createMemo(() => modalParsed() * sharePrice());
  const modalCostBasisPortion = createMemo(() => {
    if (modalMode() === "deposit") return 0;
    const sharesBefore = memberShares();
    if (!Number.isFinite(sharesBefore) || sharesBefore <= 0) return 0;
    return memberCostBasis() * (modalParsed() / sharesBefore);
  });
  const modalProfit = createMemo(() =>
    Math.max(0, modalValue() - modalCostBasisPortion()),
  );
  const modalFee = createMemo(() => modalProfit() * 0.1);
  const modalPayout = createMemo(() => modalValue() - modalFee());

  createEffect(() => {
    if (!modalOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const handleCreateVault = async (event: Event) => {
    event.preventDefault();
    if (createLoading()) return;
    setCreateError(null);
    setCreateLoading(true);
    const result = await createVault({ name: createName() });
    setCreateLoading(false);
    if (!result.ok) {
      setCreateError(result.error ?? "Vault creation failed.");
      return;
    }
    setCreateName("");
    if (result.vaultId) {
      setCurrentPage("vaults", { vaultId: result.vaultId });
    }
  };

  const openModal = (mode: "deposit" | "withdraw") => {
    setModalMode(mode);
    setModalAmount("");
    setModalError(null);
    setModalOpen(true);
  };

  const handleModalSubmit = async (event: Event) => {
    event.preventDefault();
    if (modalLoading()) return;
    setModalError(null);

    const parsed = modalParsed();
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setModalError("Enter a valid amount.");
      return;
    }

    if (!detail()) {
      setModalError("Vault not loaded.");
      return;
    }

    if (modalMode() === "deposit") {
      if (parsed > maxDeposit()) {
        setModalError("Amount exceeds available USDC.");
        return;
      }
      setModalLoading(true);
      const result = await depositVault({
        vaultId: detail()!._id,
        amount: parsed,
      });
      setModalLoading(false);
      if (!result.ok) {
        setModalError(result.error ?? "Deposit failed.");
        return;
      }
    } else {
      if (parsed > maxWithdraw()) {
        setModalError("Shares exceed available balance.");
        return;
      }
      setModalLoading(true);
      const result = await withdrawVault({
        vaultId: detail()!._id,
        shares: parsed,
      });
      setModalLoading(false);
      if (!result.ok) {
        setModalError(result.error ?? "Withdrawal failed.");
        return;
      }
    }

    setModalOpen(false);
  };

  const handleBack = () => {
    setCurrentPage("vaults");
  };

  const handleTradeFromVault = () => {
    const vault = detail();
    if (!vault || vault.status !== "active") return;
    setTradingAccountToVault(vault._id);
    setCurrentPage("trade");
  };

  return (
    <div class="flex flex-col h-full bg-brand-screen text-slate-200 overflow-hidden">
      <Show when={!currentVaultId()}>
        <div class="px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold text-slate-100">Vaults</h1>
            <p class="text-sm text-brand-slate-400">
              Pooled USDC vaults with share-based accounting.
            </p>
          </div>
          <Show when={isAuthenticated()}>
            <form
              class="flex flex-wrap items-center gap-3"
              onSubmit={handleCreateVault}
            >
              <input
                type="text"
                value={createName()}
                onInput={(event) => setCreateName(event.currentTarget.value)}
                placeholder="Vault name"
                class="h-9 rounded-lg border border-brand-border bg-brand-surface px-3 text-sm text-slate-100 placeholder:text-brand-slate-500 outline-none"
              />
              <button
                type="submit"
                disabled={createLoading()}
                class="h-9 rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-screen hover:bg-brand-accent/80 disabled:opacity-60"
              >
                {createLoading() ? "Creating..." : "Create Vault"}
              </button>
              <Show when={createError()}>
                <span class="text-xs text-brand-red-400">{createError()}</span>
              </Show>
            </form>
          </Show>
        </div>

        <div class="flex-1 overflow-auto px-4 pb-4">
          <Show
            when={vaults().length > 0}
            fallback={
              <div class="rounded-xl border border-brand-border bg-brand-surface p-6 text-sm text-brand-slate-400">
                No vaults yet. Create one to get started.
              </div>
            }
          >
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <For each={vaults()}>
                {(vault) => (
                  <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <h2 class="text-lg font-semibold text-slate-100">
                          {vault.name}
                        </h2>
                        <p class="text-xs text-brand-slate-500">
                          Status: {vault.status}
                        </p>
                      </div>
                      <button
                        class="rounded-lg border border-brand-border px-3 py-1 text-xs font-semibold text-brand-slate-100 hover:border-brand-accent hover:text-brand-accent"
                        onClick={() =>
                          setCurrentPage("vaults", { vaultId: vault._id })
                        }
                      >
                        View
                      </button>
                    </div>

                    <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <div class="text-xs text-brand-slate-500">Equity</div>
                        <div class="text-slate-100">
                          {formatUsd(vault.equityUSDC)}
                        </div>
                      </div>
                      <div>
                        <div class="text-xs text-brand-slate-500">
                          Share Price
                        </div>
                        <div class="text-slate-100">
                          {formatUsd(vault.sharePrice)}
                        </div>
                      </div>
                      <div>
                        <div class="text-xs text-brand-slate-500">
                          Total Shares
                        </div>
                        <div class="text-slate-100">
                          {formatShares(vault.totalShares)}
                        </div>
                      </div>
                      <div>
                        <div class="text-xs text-brand-slate-500">
                          Your Shares
                        </div>
                        <div class="text-slate-100">
                          {formatShares(vault.memberShares)}
                        </div>
                      </div>
                    </div>

                    <Show when={vault.memberShares > 0}>
                      <div class="mt-3 text-xs text-brand-slate-400">
                        Your value:{" "}
                        {formatUsd(vault.memberShares * vault.sharePrice)}
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={currentVaultId()}>
        <div class="px-4 py-4 flex items-center gap-3">
          <button
            class="text-sm text-brand-slate-400 hover:text-brand-accent"
            onClick={handleBack}
          >
            Back to Vaults
          </button>
        </div>

        <div class="flex-1 overflow-auto px-4 pb-4">
          <Show
            when={detail()}
            fallback={
              <div class="rounded-xl border border-brand-border bg-brand-surface p-6 text-sm text-brand-slate-400">
                Loading vault details...
              </div>
            }
          >
            {(vault) => (
              <div class="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div class="xl:col-span-8 space-y-4">
                  <div class="rounded-xl border border-brand-border bg-brand-surface p-5">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h1 class="text-2xl font-semibold text-slate-100">
                          {vault().name}
                        </h1>
                        <p class="text-sm text-brand-slate-500">
                          Status: {vault().status}
                        </p>
                      </div>
                      <div class="flex items-center gap-2">
                        <Show when={vault().isOperator}>
                          <button
                            class={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                              vault().status === "active"
                                ? "border-brand-accent text-brand-accent hover:bg-brand-accent/10"
                                : "border-brand-border text-brand-slate-500 cursor-not-allowed"
                            }`}
                            disabled={vault().status !== "active"}
                            onClick={handleTradeFromVault}
                          >
                            Trade from Vault
                          </button>
                        </Show>
                        <button
                          class="rounded-lg bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-screen hover:bg-brand-accent/80 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={!isAuthenticated()}
                          onClick={() => openModal("deposit")}
                        >
                          Deposit USDC
                        </button>
                        <button
                          class="rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-slate-100 hover:border-brand-accent hover:text-brand-accent disabled:opacity-50"
                          disabled={!isAuthenticated() || memberShares() <= 0}
                          onClick={() => openModal("withdraw")}
                        >
                          Withdraw
                        </button>
                      </div>
                    </div>

                    <div class="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div class="text-xs text-brand-slate-500">Equity</div>
                        <div class="text-slate-100">
                          {formatUsd(vault().equityUSDC)}
                        </div>
                      </div>
                      <div>
                        <div class="text-xs text-brand-slate-500">
                          Share Price
                        </div>
                        <div class="text-slate-100">
                          {formatUsd(vault().sharePrice)}
                        </div>
                      </div>
                      <div>
                        <div class="text-xs text-brand-slate-500">
                          Total Shares
                        </div>
                        <div class="text-slate-100">
                          {formatShares(vault().totalShares)}
                        </div>
                      </div>
                      <div>
                        <div class="text-xs text-brand-slate-500">
                          Vault PnL
                        </div>
                        <div
                          class={
                            vault().pnl >= 0
                              ? "text-brand-green-400"
                              : "text-brand-red-400"
                          }
                        >
                          {formatUsd(vault().pnl)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="rounded-xl border border-brand-border bg-brand-surface p-5">
                    <div class="text-sm font-semibold text-slate-100">
                      Your Position
                    </div>
                    <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div class="text-xs text-brand-slate-500">Shares</div>
                        <div class="text-slate-100">
                          {formatShares(memberShares())}
                        </div>
                      </div>
                      <div>
                        <div class="text-xs text-brand-slate-500">Value</div>
                        <div class="text-slate-100">
                          {formatUsd(memberValue())}
                        </div>
                      </div>
                      <div>
                        <div class="text-xs text-brand-slate-500">
                          Cost Basis
                        </div>
                        <div class="text-slate-100">
                          {formatUsd(memberCostBasis())}
                        </div>
                      </div>
                      <div>
                        <div class="text-xs text-brand-slate-500">
                          Profit (before fee)
                        </div>
                        <div
                          class={
                            memberProfit() >= 0
                              ? "text-brand-green-400"
                              : "text-brand-red-400"
                          }
                        >
                          {formatUsd(memberProfit())}
                        </div>
                      </div>
                    </div>
                    <div class="mt-4 text-xs text-brand-slate-500">
                      Performance fee: 10% of profits on withdrawal only.
                    </div>
                  </div>
                </div>

                <div class="xl:col-span-4 space-y-4">
                  <div class="rounded-xl border border-brand-border bg-brand-surface p-5">
                    <div class="text-sm font-semibold text-slate-100">
                      Deposit
                    </div>
                    <p class="mt-2 text-xs text-brand-slate-500">
                      Available USDC: {formatUsd(maxDeposit())}
                    </p>
                    <button
                      class="mt-4 w-full rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-slate-100 hover:border-brand-accent hover:text-brand-accent disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!isAuthenticated()}
                      onClick={() => openModal("deposit")}
                    >
                      Add USDC
                    </button>
                  </div>
                  <div class="rounded-xl border border-brand-border bg-brand-surface p-5">
                    <div class="text-sm font-semibold text-slate-100">
                      Withdraw
                    </div>
                    <p class="mt-2 text-xs text-brand-slate-500">
                      Shares available: {formatShares(memberShares())}
                    </p>
                    <button
                      class="mt-4 w-full rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-slate-100 hover:border-brand-accent hover:text-brand-accent disabled:opacity-50"
                      disabled={!isAuthenticated() || memberShares() <= 0}
                      onClick={() => openModal("withdraw")}
                    >
                      Redeem Shares
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <Show when={modalOpen()}>
        <div
          class="symbol-search-overlay is-open"
          onClick={() => setModalOpen(false)}
        >
          <div
            class="w-[min(440px,95vw)] rounded-2xl border border-brand-border bg-brand-surface shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-screen/70">
              <div class="flex-1 text-center">
                <h2 class="text-lg font-semibold text-slate-100">
                  {modalMode() === "deposit" ? "Deposit USDC" : "Withdraw USDC"}
                </h2>
                <p class="text-xs text-brand-slate-500">
                  {modalMode() === "deposit"
                    ? "Mint vault shares with USDC."
                    : "Redeem shares with a 10% fee on profits."}
                </p>
              </div>
              <button
                type="button"
                class="text-brand-slate-400 hover:text-slate-100 absolute right-4"
                onClick={() => setModalOpen(false)}
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

            <form class="px-5 py-5 space-y-4" onSubmit={handleModalSubmit}>
              <div class="rounded-xl border border-brand-border bg-brand-screen overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={
                      modalMode() === "deposit" ? "USDC amount" : "Shares"
                    }
                    value={modalAmount()}
                    onInput={(e) => setModalAmount(e.currentTarget.value)}
                    disabled={modalLoading()}
                    class="flex-1 bg-transparent text-slate-100 text-sm placeholder:text-brand-slate-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setModalAmount(
                        (modalMode() === "deposit"
                          ? maxDeposit()
                          : maxWithdraw()
                        ).toString(),
                      )
                    }
                    class="text-brand-accent text-sm font-medium hover:underline whitespace-nowrap"
                  >
                    MAX
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3 text-xs text-brand-slate-400">
                <div>
                  <div>Share price</div>
                  <div class="text-slate-100">{formatUsd(sharePrice())}</div>
                </div>
                <div>
                  <div>
                    {modalMode() === "deposit"
                      ? "Shares minted"
                      : "Withdrawal value"}
                  </div>
                  <div class="text-slate-100">
                    {modalMode() === "deposit"
                      ? formatShares(modalShares())
                      : formatUsd(modalValue())}
                  </div>
                </div>
                <Show when={modalMode() === "withdraw"}>
                  <>
                    <div>
                      <div>Performance fee</div>
                      <div class="text-slate-100">{formatUsd(modalFee())}</div>
                    </div>
                    <div>
                      <div>Estimated payout</div>
                      <div class="text-slate-100">
                        {formatUsd(modalPayout())}
                      </div>
                    </div>
                  </>
                </Show>
              </div>

              <Show when={modalError()}>
                <div class="text-xs text-brand-red-400 text-center">
                  {modalError()}
                </div>
              </Show>

              <button
                type="submit"
                disabled={modalLoading() || !modalAmount()}
                class="w-full rounded-xl bg-brand-accent/90 py-3 text-sm font-semibold text-brand-screen hover:bg-brand-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {modalLoading() ? "Processing..." : "Confirm"}
              </button>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default Vaults;
