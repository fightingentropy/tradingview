import { usePageActive } from "./PageView";
import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { hyperliquidAppUrl } from "../lib/hyperliquidNetwork";
import {
  hyperliquidAccountValue,
  hyperliquidAccountTransfers,
  hyperliquidConnection,
  hyperliquidFeeSummary,
  hyperliquidFundingPayments,
  hyperliquidHistoricalOrders,
  hyperliquidInterestPayments,
  hyperliquidPortfolioRefreshError,
  hyperliquidPortfolioRefreshPending,
  hyperliquidPortfolioSnapshots,
  hyperliquidTradeFills,
  hyperliquidTwapOrders,
  isHyperliquidExecution,
  refreshHyperliquidActivity,
  refreshHyperliquidPortfolio,
} from "../stores/hyperliquidExecution";
import { openOrders, positions } from "../stores/clob";
import { portfolioMetrics, tradeHistory } from "../stores/portfolio";
import { openSettings } from "../stores/settings";
import {
  ChaseTable,
  FundingHistoryTable,
  OrderHistoryTable,
  TwapTable,
} from "./AccountActivityTables";
import AccountDockFilters from "./AccountDockFilters";
import BalancesPanel from "./BalancesPanel";
import OpenOrdersTable from "./OpenOrdersTable";
import {
  InterestHistoryTable,
  TransfersHistoryTable,
} from "./PortfolioHistoryTables";
import PositionsTable from "./PositionsTable";
import PortfolioPerformance from "./PortfolioPerformance";
import TradeHistoryTable from "./TradeHistoryTable";
import {
  ACCOUNT_TABS,
  formatAccountMarket,
  isAccountActivityTab,
  type AccountSideFilter,
  type AccountTab,
} from "./accountDock";

const PORTFOLIO_TABS = [
  ...ACCOUNT_TABS,
  { id: "interest", label: "Interest" },
  { id: "transfers", label: "Deposits and Withdrawals" },
] as const;

type PortfolioTab = AccountTab | "interest" | "transfers";
const ACTIVITY_POLL_MS = 60_000;
const PORTFOLIO_POLL_MS = 60_000;

const isCoreAccountTab = (tab: PortfolioTab): tab is AccountTab =>
  ACCOUNT_TABS.some((candidate) => candidate.id === tab);

const formatCompactUsd = (value?: number) => {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  const numeric = Number(value);
  return `$${Intl.NumberFormat("en-US", {
    notation: Math.abs(numeric) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(numeric)}`;
};

const formatRate = (rate?: number) => {
  if (!Number.isFinite(rate ?? Number.NaN)) return "--";
  return `${(Number(rate) * 100).toFixed(4)}%`;
};

const shortAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

const Portfolio: Component = () => {
  const pageActive = usePageActive();
  const [activeTab, setActiveTab] = createSignal<PortfolioTab>("balances");
  const [sideFilter, setSideFilter] = createSignal<AccountSideFilter>("all");
  const [marketFilter, setMarketFilter] = createSignal("all");
  const [copied, setCopied] = createSignal(false);

  const metrics = portfolioMetrics;
  const feeSummary = hyperliquidFeeSummary;
  const connection = hyperliquidConnection;
  const liveMode = isHyperliquidExecution;

  const availableMarkets = createMemo(() => {
    const symbols = [
      ...positions().map((position) => position.symbol),
      ...openOrders().map((order) => order.symbol),
      ...tradeHistory().map((trade) => trade.symbol),
      ...hyperliquidTradeFills().map((trade) => trade.symbol),
      ...hyperliquidFundingPayments().map((payment) => payment.symbol),
      ...hyperliquidHistoricalOrders().map((order) => order.symbol),
      ...hyperliquidTwapOrders().map((order) => order.symbol),
    ];
    return [...new Set(symbols.map(formatAccountMarket))].sort();
  });

  createEffect(() => {
    if (!pageActive() || !liveMode()) return;
    untrack(() => void refreshHyperliquidPortfolio());
    const timer = window.setInterval(
      () => untrack(() => void refreshHyperliquidPortfolio()),
      PORTFOLIO_POLL_MS,
    );
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    activeTab();
    setSideFilter("all");
    setMarketFilter("all");
  });

  createEffect(() => {
    const tab = activeTab();
    if (pageActive() && liveMode() && isCoreAccountTab(tab) && isAccountActivityTab(tab)) {
      untrack(() => void refreshHyperliquidActivity());
      const timer = window.setInterval(
        () => untrack(() => void refreshHyperliquidActivity()),
        ACTIVITY_POLL_MS,
      );
      onCleanup(() => window.clearInterval(timer));
    }
  });

  const tabCountFor = (tab: PortfolioTab) => {
    if (tab === "positions") return positions().length;
    if (tab === "openOrders") return openOrders().length;
    if (tab === "interest") return hyperliquidInterestPayments().length;
    if (tab === "transfers") return hyperliquidAccountTransfers().length;
    return 0;
  };

  const copyMasterAddress = async () => {
    const address = connection()?.masterAddress;
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const portfolioUrl = createMemo(() =>
    hyperliquidAppUrl(connection()?.network ?? "mainnet", "portfolio"),
  );

  return (
    <div class="h-full overflow-y-auto bg-brand-screen text-slate-200">
      <main class="mx-auto w-full max-w-[1600px] px-4 py-5 lg:px-6">
        <header class="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight text-slate-100">
              Portfolio
            </h1>
            <Show
              when={connection()?.masterAddress}
              fallback={
                <p class="mt-2 text-sm text-brand-slate-400">Paper account</p>
              }
            >
              {(address) => (
                <div class="mt-2 flex items-center gap-2 text-sm">
                  <span class="font-medium text-slate-200">Master:</span>
                  <span class="font-mono text-brand-slate-300">
                    {shortAddress(address())}
                  </span>
                  <button
                    type="button"
                    class="text-brand-slate-400 hover:text-brand-accent"
                    aria-label="Copy master address"
                    title={copied() ? "Copied" : "Copy address"}
                    onClick={() => void copyMasterAddress()}
                  >
                    <svg
                      class="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                    >
                      <rect x="8" y="8" width="11" height="11" rx="2" />
                      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                    </svg>
                  </button>
                </div>
              )}
            </Show>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-full border border-brand-border bg-brand-surface px-3.5 py-2 text-sm font-medium text-slate-200 hover:border-brand-slate-500"
              onClick={openSettings}
            >
              Account Type
            </button>
            <Show when={liveMode()}>
              <For each={["Send", "Withdraw"]}>
                {(label) => (
                  <a
                    href={portfolioUrl()}
                    target="_blank"
                    rel="noreferrer"
                    title="Opens Hyperliquid"
                    class="rounded-full border border-brand-border bg-brand-surface px-3.5 py-2 text-sm font-medium text-slate-200 hover:border-brand-slate-500"
                  >
                    {label}
                  </a>
                )}
              </For>
              <a
                href={portfolioUrl()}
                target="_blank"
                rel="noreferrer"
                title="Opens Hyperliquid"
                class="rounded-full border border-brand-accent bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-screen hover:bg-brand-accent/90"
              >
                Deposit
              </a>
            </Show>
          </div>
        </header>

        <section class="grid gap-2 lg:grid-cols-[240px_350px_minmax(0,1fr)]">
          <div class="order-3 grid gap-2 lg:order-none">
            <div class="rounded-lg border border-brand-border bg-brand-surface p-4">
              <div class="text-sm text-brand-slate-400">
                {liveMode() ? "14 Day Volume" : "Paper Volume"}
              </div>
              <div class="mt-3 text-3xl font-medium tracking-tight text-slate-100">
                {formatCompactUsd(
                  liveMode() ? feeSummary()?.volume14d : metrics()?.volume,
                )}
              </div>
            </div>

            <div class="rounded-lg border border-brand-border bg-brand-surface p-4">
              <div class="flex items-center justify-between text-sm text-brand-slate-400">
                <span>Fees</span>
                <span>Taker / Maker</span>
              </div>
              <div class="mt-4 space-y-3">
                <FeeRow
                  label="Perps"
                  value={
                    feeSummary()
                      ? `${formatRate(feeSummary()?.perpTakerRate)} / ${formatRate(
                          feeSummary()?.perpMakerRate,
                        )}`
                      : "-- / --"
                  }
                />
                <FeeRow
                  label="Spot"
                  value={
                    feeSummary()
                      ? `${formatRate(feeSummary()?.spotTakerRate)} / ${formatRate(
                          feeSummary()?.spotMakerRate,
                        )}`
                      : "-- / --"
                  }
                />
              </div>
            </div>
          </div>

          <PortfolioPerformance
            live={liveMode()}
            active={pageActive()}
            snapshots={hyperliquidPortfolioSnapshots()}
            tradingEquity={hyperliquidAccountValue()}
            paperTrades={tradeHistory()}
            paperEquity={metrics()}
            loading={liveMode() && hyperliquidPortfolioRefreshPending()}
          />
        </section>

        <Show when={hyperliquidPortfolioRefreshError()}>
          {(message) => (
            <p class="mt-2 text-xs text-brand-red-400">{message()}</p>
          )}
        </Show>

        <section class="mt-2 overflow-hidden rounded-lg border border-brand-border bg-brand-surface">
          <div class="flex items-center border-b border-brand-border">
            <div class="flex min-w-0 flex-1 items-center overflow-x-auto">
              <For each={PORTFOLIO_TABS}>
                {(tab) => (
                  <button
                    type="button"
                    class={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${
                      activeTab() === tab.id
                        ? "border-brand-accent text-slate-100"
                        : "border-transparent text-brand-slate-400 hover:text-slate-200"
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                    <Show when={tabCountFor(tab.id) > 0}>
                      <span class="ml-1 text-xs text-brand-slate-500">
                        ({tabCountFor(tab.id)})
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <Show when={isCoreAccountTab(activeTab())}>
              <AccountDockFilters
                tab={activeTab() as AccountTab}
                side={sideFilter()}
                market={marketFilter()}
                markets={availableMarkets()}
                onSideChange={setSideFilter}
                onMarketChange={setMarketFilter}
              />
            </Show>
          </div>

          <Show when={activeTab() === "balances"}>
            <BalancesPanel />
          </Show>
          <Show when={activeTab() === "positions"}>
            <PositionsTable
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "openOrders"}>
            <OpenOrdersTable
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "twap"}>
            <TwapTable
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "chase"}>
            <ChaseTable marketFilter={marketFilter()} />
          </Show>
          <Show when={activeTab() === "tradeHistory"}>
            <TradeHistoryTable
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "fundingHistory"}>
            <FundingHistoryTable
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "orderHistory"}>
            <OrderHistoryTable
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "interest"}>
            <InterestHistoryTable />
          </Show>
          <Show when={activeTab() === "transfers"}>
            <TransfersHistoryTable />
          </Show>
        </section>
      </main>
    </div>
  );
};

const FeeRow: Component<{ label: string; value: string }> = (props) => (
  <div class="flex items-center justify-between gap-3 text-sm">
    <span class="text-brand-slate-400">{props.label}</span>
    <span class="font-mono text-slate-100">{props.value}</span>
  </div>
);

export default Portfolio;
