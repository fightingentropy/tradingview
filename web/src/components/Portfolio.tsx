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
  type HyperliquidPortfolioPeriod,
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
import TradeHistoryTable from "./TradeHistoryTable";
import {
  ACCOUNT_TABS,
  formatAccountMarket,
  isAccountActivityTab,
  type AccountSideFilter,
  type AccountTab,
} from "./accountDock";

const PERIOD_OPTIONS = [
  {
    id: "24h",
    label: "24H",
    combined: "day",
    perps: "perpDay",
    rangeMs: 24 * 60 * 60 * 1000,
  },
  {
    id: "7d",
    label: "7D",
    combined: "week",
    perps: "perpWeek",
    rangeMs: 7 * 24 * 60 * 60 * 1000,
  },
  {
    id: "30d",
    label: "30D",
    combined: "month",
    perps: "perpMonth",
    rangeMs: 30 * 24 * 60 * 60 * 1000,
  },
  {
    id: "all",
    label: "All-time",
    combined: "allTime",
    perps: "perpAllTime",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  combined: HyperliquidPortfolioPeriod;
  perps: HyperliquidPortfolioPeriod;
  rangeMs?: number;
}>;

const CHART_OPTIONS = [
  { id: "accountValue", label: "Account Value" },
  { id: "pnl", label: "PNL" },
  { id: "perpsPnl", label: "Perps PNL" },
] as const;

const PORTFOLIO_TABS = [
  ...ACCOUNT_TABS,
  { id: "interest", label: "Interest" },
  { id: "transfers", label: "Deposits and Withdrawals" },
] as const;

type PeriodOption = (typeof PERIOD_OPTIONS)[number];
type PeriodId = PeriodOption["id"];
type ChartId = (typeof CHART_OPTIONS)[number]["id"];
type PortfolioTab = AccountTab | "interest" | "transfers";
type ChartPoint = { time: number; value: number };

const DEFAULT_PERIOD = PERIOD_OPTIONS[3];
const DEFAULT_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVITY_POLL_MS = 60_000;
const PORTFOLIO_POLL_MS = 60_000;
const CHART_LINE_COLOR = "#e2e8f0";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const isCoreAccountTab = (tab: PortfolioTab): tab is AccountTab =>
  ACCOUNT_TABS.some((candidate) => candidate.id === tab);

const latestValue = (points: ChartPoint[]) =>
  points.length > 0 ? points[points.length - 1].value : undefined;

const formatUsd = (value?: number, signed = false) => {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  const numeric = Number(value);
  const sign = signed
    ? numeric > 0
      ? "+"
      : numeric < 0
        ? "-"
        : ""
    : numeric < 0
      ? "-"
      : "";
  return `${sign}$${Math.abs(numeric).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

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

const formatPercent = (value?: number) => {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  return `${Number(value).toFixed(2)}%`;
};

const formatAxisValue = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  const absolute = Math.abs(value);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: absolute >= 100 ? 0 : 2,
    maximumFractionDigits: absolute >= 100 ? 0 : 2,
  });
};

const formatAxisDate = (timestamp: number, periodId: PeriodId) => {
  const date = new Date(timestamp);
  if (periodId === "24h") {
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (periodId === "all") {
    return date.toLocaleDateString("en-GB", {
      month: "short",
      year: "2-digit",
    });
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
};

const maxDrawdown = (history: ChartPoint[]) => {
  let peak = 0;
  let largest = 0;
  for (const point of history) {
    if (point.value > peak) peak = point.value;
    if (peak > 0) largest = Math.max(largest, (peak - point.value) / peak);
  }
  return largest * 100;
};

const shortAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

const Portfolio: Component = () => {
  const [activeTab, setActiveTab] = createSignal<PortfolioTab>("balances");
  const [sideFilter, setSideFilter] = createSignal<AccountSideFilter>("all");
  const [marketFilter, setMarketFilter] = createSignal("all");
  const [periodFilter, setPeriodFilter] =
    createSignal<PeriodOption>(DEFAULT_PERIOD);
  const [chartType, setChartType] = createSignal<ChartId>("accountValue");
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
    if (!liveMode()) return;
    untrack(() => void refreshHyperliquidPortfolio());
    const timer = window.setInterval(
      () => untrack(() => void refreshHyperliquidPortfolio()),
      PORTFOLIO_POLL_MS,
    );
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    const tab = activeTab();
    setSideFilter("all");
    setMarketFilter("all");
    if (liveMode() && isCoreAccountTab(tab) && isAccountActivityTab(tab)) {
      untrack(() => void refreshHyperliquidActivity());
      const timer = window.setInterval(
        () => untrack(() => void refreshHyperliquidActivity()),
        ACTIVITY_POLL_MS,
      );
      onCleanup(() => window.clearInterval(timer));
    }
  });

  const combinedSnapshot = createMemo(
    () => hyperliquidPortfolioSnapshots()[periodFilter().combined],
  );
  const perpsSnapshot = createMemo(
    () => hyperliquidPortfolioSnapshots()[periodFilter().perps],
  );

  const paperPnlSeries = createMemo(() => {
    const selected = periodFilter();
    const rangeMs = "rangeMs" in selected ? selected.rangeMs : undefined;
    const rangeEnd = Date.now();
    const rangeStart = rangeMs
      ? rangeEnd - rangeMs
      : (tradeHistory()[0]?.createdAt ?? rangeEnd - DEFAULT_RANGE_MS);
    const filtered = tradeHistory()
      .filter((trade) => trade.createdAt >= rangeStart)
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt);
    let running = 0;
    const points: ChartPoint[] = [{ time: rangeStart, value: 0 }];
    for (const trade of filtered) {
      running += trade.pnl;
      points.push({ time: trade.createdAt, value: running });
    }
    points.push({ time: rangeEnd, value: running });
    return { points, hasActivity: filtered.length > 0 };
  });

  const chartSeries = createMemo(() => {
    if (liveMode()) {
      if (chartType() === "accountValue") {
        return combinedSnapshot()?.accountValueHistory ?? [];
      }
      if (chartType() === "perpsPnl") {
        return perpsSnapshot()?.pnlHistory ?? [];
      }
      return combinedSnapshot()?.pnlHistory ?? [];
    }
    const paperSeries = paperPnlSeries();
    if (!paperSeries.hasActivity) return [];
    const pnl = paperSeries.points;
    if (chartType() !== "accountValue") return pnl;
    const finalPnl = latestValue(pnl) ?? 0;
    const finalEquity = metrics()?.totalEquity ?? 0;
    const startingEquity = finalEquity - finalPnl;
    return pnl.map((point) => ({
      ...point,
      value: startingEquity + point.value,
    }));
  });

  const chartData = createMemo(() => {
    const points = chartSeries()
      .slice()
      .sort((a, b) => a.time - b.time);
    const now = Date.now();
    const selected = periodFilter();
    const rangeMs = "rangeMs" in selected ? selected.rangeMs : undefined;
    const start = points[0]?.time ?? now - (rangeMs ?? DEFAULT_RANGE_MS);
    const end = points[points.length - 1]?.time ?? now;
    let min =
      points.length > 0 ? Math.min(...points.map((point) => point.value)) : 0;
    let max =
      points.length > 0 ? Math.max(...points.map((point) => point.value)) : 0;
    if (min === max) {
      const padding = Math.max(1, Math.abs(min) * 0.1);
      min -= padding;
      max += padding;
    } else {
      const padding = (max - min) * 0.1;
      min -= padding;
      max += padding;
    }
    return { points, start, end: Math.max(end, start + 1), min, max };
  });

  const plotPoints = createMemo(() => {
    const chart = chartData();
    const timeRange = Math.max(1, chart.end - chart.start);
    const valueRange = Math.max(0.000001, chart.max - chart.min);
    return chart.points.map((point) => ({
      ...point,
      x: clamp(((point.time - chart.start) / timeRange) * 100, 0, 100),
      y: clamp(100 - ((point.value - chart.min) / valueRange) * 100, 0, 100),
    }));
  });

  const linePath = createMemo(() => {
    const points = plotPoints();
    if (points.length === 0) return "";
    let path = `M${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      path += ` L${current.x} ${previous.y} L${current.x} ${current.y}`;
    }
    return path;
  });

  const yTicks = createMemo(() => {
    const { min, max } = chartData();
    const count = 4;
    const step = (max - min) / (count - 1);
    return Array.from({ length: count }, (_, index) => max - step * index);
  });

  const xTicks = createMemo(() => {
    const { start, end } = chartData();
    const count = 5;
    const step = (end - start) / (count - 1);
    return Array.from({ length: count }, (_, index) => start + step * index);
  });

  const overview = createMemo(() => {
    if (liveMode()) {
      const snapshot = combinedSnapshot();
      const accountHistory = snapshot?.accountValueHistory ?? [];
      const totalEquity = latestValue(accountHistory);
      return {
        pnl: latestValue(snapshot?.pnlHistory ?? []),
        volume: snapshot?.volume,
        drawdown: maxDrawdown(accountHistory),
        totalEquity: totalEquity ?? hyperliquidAccountValue(),
        tradingEquity: hyperliquidAccountValue(),
      };
    }
    return {
      pnl: metrics()?.pnl,
      volume: metrics()?.volume,
      drawdown: undefined,
      totalEquity: metrics()?.totalEquity,
      tradingEquity: metrics()?.perpsEquity,
    };
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
          <div class="grid gap-2">
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

          <div class="rounded-lg border border-brand-border bg-brand-surface">
            <div class="flex items-center justify-between border-b border-brand-border px-4 py-3 text-sm">
              <span class="font-medium text-slate-200">
                Account performance
              </span>
              <span class="text-brand-slate-400">{periodFilter().label}</span>
            </div>
            <div class="space-y-2.5 p-4">
              <MetricRow
                label="PNL"
                value={formatUsd(overview().pnl, true)}
                tone={
                  (overview().pnl ?? 0) > 0
                    ? "positive"
                    : (overview().pnl ?? 0) < 0
                      ? "negative"
                      : "default"
                }
              />
              <MetricRow label="Volume" value={formatUsd(overview().volume)} />
              <MetricRow
                label="Max Drawdown"
                value={formatPercent(overview().drawdown)}
              />
              <MetricRow
                label="Total Equity"
                value={formatUsd(overview().totalEquity)}
              />
              <MetricRow
                label="Trading Equity"
                value={formatUsd(overview().tradingEquity)}
              />
              <MetricRow label="Staking Account" value="--" />
            </div>
          </div>

          <div class="min-h-[310px] rounded-lg border border-brand-border bg-brand-surface">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border px-4">
              <div class="flex items-center gap-5 overflow-x-auto">
                <For each={CHART_OPTIONS}>
                  {(option) => (
                    <button
                      type="button"
                      class={`border-b-2 py-3 text-sm font-medium whitespace-nowrap ${
                        chartType() === option.id
                          ? "border-brand-accent text-slate-100"
                          : "border-transparent text-brand-slate-400 hover:text-slate-200"
                      }`}
                      onClick={() => setChartType(option.id)}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </div>
              <select
                aria-label="Portfolio chart period"
                class="bg-transparent py-2 text-sm text-brand-slate-300 outline-none"
                value={periodFilter().id}
                onInput={(event) => {
                  const selected = PERIOD_OPTIONS.find(
                    (option) => option.id === event.currentTarget.value,
                  );
                  if (selected) setPeriodFilter(selected);
                }}
              >
                <For each={PERIOD_OPTIONS}>
                  {(option) => (
                    <option value={option.id}>{option.label}</option>
                  )}
                </For>
              </select>
            </div>

            <div class="relative h-[248px] px-4 pb-7 pt-4">
              <Show when={chartData().points.length > 0}>
                <div class="absolute bottom-8 left-4 top-4 flex w-14 flex-col justify-between pr-2 text-right font-mono text-[11px] text-brand-slate-500">
                  <For each={yTicks()}>
                    {(tick) => <span>{formatAxisValue(tick)}</span>}
                  </For>
                </div>
              </Show>
              <div class="absolute bottom-8 left-[72px] right-4 top-4 overflow-hidden border-b border-l border-brand-border">
                <Show when={chartData().points.length > 0}>
                  <div class="absolute inset-0 flex flex-col justify-between">
                    <For each={yTicks()}>
                      {() => (
                        <div class="h-0 border-b border-brand-border/40" />
                      )}
                    </For>
                  </div>
                </Show>
                <svg
                  class="absolute inset-0 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-label={`${CHART_OPTIONS.find((item) => item.id === chartType())?.label} chart`}
                >
                  <Show when={linePath()}>
                    <path
                      d={linePath()}
                      fill="none"
                      stroke={CHART_LINE_COLOR}
                      stroke-width="1.15"
                      vector-effect="non-scaling-stroke"
                    />
                  </Show>
                </svg>
                <Show when={chartData().points.length === 0}>
                  <div class="absolute inset-0 flex items-center justify-center text-sm text-brand-slate-500">
                    {hyperliquidPortfolioRefreshPending()
                      ? "Loading portfolio history…"
                      : "No history for this period"}
                  </div>
                </Show>
              </div>
              <Show when={chartData().points.length > 0}>
                <div class="absolute bottom-2 left-[72px] right-4 flex justify-between font-mono text-[11px] text-brand-slate-500">
                  <For each={xTicks()}>
                    {(tick) => (
                      <span>{formatAxisDate(tick, periodFilter().id)}</span>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
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

const MetricRow: Component<{
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative";
}> = (props) => (
  <div class="flex items-center justify-between gap-4 text-sm">
    <span class="text-brand-slate-400">{props.label}</span>
    <span
      class={`font-mono ${
        props.tone === "positive"
          ? "text-brand-green-400"
          : props.tone === "negative"
            ? "text-brand-red-400"
            : "text-slate-100"
      }`}
    >
      {props.value}
    </span>
  </div>
);

export default Portfolio;
