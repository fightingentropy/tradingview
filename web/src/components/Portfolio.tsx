import { usePageActive } from "./PageView";
import "./Portfolio.css";
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
    <div class="h-full overflow-y-auto bg-brand-screen text-brand-slate-100">
      <main class="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <header class="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div class="min-w-0">
            <h1 class="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-brand-slate-100 sm:text-[32px]">
              Portfolio
            </h1>
            <Show
              when={connection()?.masterAddress}
              fallback={
                <p class="mt-1 text-[15px] text-brand-slate-400">Paper account</p>
              }
            >
              {(address) => (
                <div class="mt-1 flex items-center gap-1.5 text-[15px]">
                  <span class="text-brand-slate-500">Master</span>
                  <span class="font-mono text-brand-slate-100">
                    {shortAddress(address())}
                  </span>
                  <button
                    type="button"
                    class="-my-1.5 grid h-11 w-11 place-items-center rounded-full text-brand-slate-500 transition-colors duration-150 ease-[var(--ease-out)] motion-reduce:transition-none hover:bg-brand-raised hover:text-brand-slate-100 sm:h-9 sm:w-9"
                    classList={{ "text-brand-accent": copied() }}
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
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <Show
                        when={copied()}
                        fallback={
                          <>
                            <rect x="8" y="8" width="11" height="11" rx="2" />
                            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                          </>
                        }
                      >
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                      </Show>
                    </svg>
                  </button>
                </div>
              )}
            </Show>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="pf-btn" onClick={openSettings}>
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
                    class="pf-btn"
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
                class="pf-btn pf-btn-primary"
              >
                Deposit
              </a>
            </Show>
          </div>
        </header>

        <section class="pf-overview">
          <PortfolioPerformance
            live={liveMode()}
            active={pageActive()}
            snapshots={hyperliquidPortfolioSnapshots()}
            tradingEquity={hyperliquidAccountValue()}
            paperTrades={tradeHistory()}
            paperEquity={metrics()}
            loading={liveMode() && hyperliquidPortfolioRefreshPending()}
          />

          <div class="pf-side pf-card">
            <div>
              <div class="pf-label">
                {liveMode() ? "14 Day Volume" : "Paper Volume"}
              </div>
              <div class="pf-figure">
                {formatCompactUsd(
                  liveMode() ? feeSummary()?.volume14d : metrics()?.volume,
                )}
              </div>
            </div>

            <div class="pf-side-head">
              <span>Fees</span>
              <span>Taker / Maker</span>
            </div>
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
        </section>

        <Show when={hyperliquidPortfolioRefreshError()}>
          {(message) => (
            <p class="mt-3 text-[13px] text-brand-red-400">{message()}</p>
          )}
        </Show>

        <section class="pf-card mt-3 overflow-hidden">
          <div class="flex items-center border-b border-brand-border">
            <div class="pf-tabs">
              <For each={PORTFOLIO_TABS}>
                {(tab) => (
                  <button
                    type="button"
                    aria-pressed={activeTab() === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                    <Show when={tabCountFor(tab.id) > 0}>
                      <span class="pf-count">{tabCountFor(tab.id)}</span>
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
  <div class="pf-fee">
    <span class="pf-fee-label">
      {props.label}
      <span class="pf-fee-suffix"> fees</span>
    </span>
    <span class="pf-fee-value font-mono">{props.value}</span>
    <span class="pf-fee-caption">Taker / Maker</span>
  </div>
);

export default Portfolio;
