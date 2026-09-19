import {
  Component,
  For,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  untrack,
} from "solid-js";
import { openOrders, positions } from "../stores/clob";
import {
  hyperliquidFundingPayments,
  hyperliquidHistoricalOrders,
  hyperliquidTradeFills,
  hyperliquidTwapOrders,
  isHyperliquidExecution,
  refreshHyperliquidActivity,
} from "../stores/hyperliquidExecution";
import { tradeHistory } from "../stores/portfolio";
import AccountDockFilters from "./AccountDockFilters";
import BalancesPanel from "./BalancesPanel";
import OpenOrdersTable from "./OpenOrdersTable";
import PositionsTable from "./PositionsTable";
import Spinner from "./Spinner";
import {
  ACCOUNT_TABS,
  type AccountSideFilter,
  type AccountTab,
  formatAccountMarket,
  isAccountActivityTab,
} from "./accountDock";

const TwapTable = lazy(() =>
  import("./AccountActivityTables").then((module) => ({
    default: module.TwapTable,
  })),
);
const ChaseTable = lazy(() =>
  import("./AccountActivityTables").then((module) => ({
    default: module.ChaseTable,
  })),
);
const FundingHistoryTable = lazy(() =>
  import("./AccountActivityTables").then((module) => ({
    default: module.FundingHistoryTable,
  })),
);
const OrderHistoryTable = lazy(() =>
  import("./AccountActivityTables").then((module) => ({
    default: module.OrderHistoryTable,
  })),
);
const TradeHistoryTable = lazy(() => import("./TradeHistoryTable"));

const PRIMARY_TABS = new Set<AccountTab>(["positions", "openOrders", "balances", "tradeHistory"]);
const TAB_STORAGE_KEY = "trade-xyz-account-tab";
const loadTab = (): AccountTab => {
  try { const saved = localStorage.getItem(TAB_STORAGE_KEY); return ACCOUNT_TABS.find(tab => tab.id === saved)?.id ?? "positions"; } catch { return "positions"; }
};

const HEIGHT_STORAGE_KEY = "trade-xyz-trade-panel-height";
const DEFAULT_HEIGHT = 200;
const MIN_HEIGHT = 160;
const ACTIVITY_POLL_MS = 60_000;

const clampHeight = (value: number) => {
  const maxHeight = Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.75));
  return Math.min(maxHeight, Math.max(MIN_HEIGHT, value));
};

const loadHeight = () => {
  try {
    const stored = localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) return clampHeight(parsed);
    }
  } catch {
    // Local storage is optional; the default height remains usable.
  }
  return clampHeight(DEFAULT_HEIGHT);
};

const TradePanel: Component = () => {
  const [activeTab, setTab] = createSignal<AccountTab>(loadTab());
  const setActiveTab = (tab: AccountTab) => {
    setTab(tab);
    try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* Optional display preference. */ }
  };
  const [sideFilter, setSideFilter] = createSignal<AccountSideFilter>("all");
  const [marketFilter, setMarketFilter] = createSignal("all");
  const [panelHeight, setPanelHeight] = createSignal(loadHeight());
  let moveHandler: ((event: MouseEvent) => void) | null = null;
  let upHandler: (() => void) | null = null;

  const persistHeight = (value: number) => {
    try {
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(value)));
    } catch {
      // Local storage is optional; resizing still works for this session.
    }
  };

  const stopResize = () => {
    if (moveHandler) {
      window.removeEventListener("mousemove", moveHandler);
      moveHandler = null;
    }
    if (upHandler) {
      window.removeEventListener("mouseup", upHandler);
      upHandler = null;
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const startResize = (event: MouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelHeight();

    moveHandler = (moveEvent: MouseEvent) => {
      const nextHeight = clampHeight(
        startHeight + (startY - moveEvent.clientY),
      );
      setPanelHeight(nextHeight);
      persistHeight(nextHeight);
    };
    upHandler = stopResize;

    window.addEventListener("mousemove", moveHandler);
    window.addEventListener("mouseup", upHandler);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const handleWindowResize = () => {
    setPanelHeight((current) => clampHeight(current));
  };

  window.addEventListener("resize", handleWindowResize);
  onCleanup(() => {
    stopResize();
    window.removeEventListener("resize", handleWindowResize);
  });

  const positionsCount = createMemo(() => positions().length);
  const openOrdersCount = createMemo(() => openOrders().length);
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
    const tab = activeTab();
    setSideFilter("all");
    setMarketFilter("all");
    if (isHyperliquidExecution() && isAccountActivityTab(tab)) {
      untrack(() => void refreshHyperliquidActivity());
      const refreshTimer = window.setInterval(
        () => untrack(() => void refreshHyperliquidActivity()),
        ACTIVITY_POLL_MS,
      );
      onCleanup(() => window.clearInterval(refreshTimer));
    }
  });

  const tabCountFor = (tab: AccountTab) => {
    if (tab === "positions") return positionsCount();
    if (tab === "openOrders") return openOrdersCount();
    return 0;
  };

  return (
    <div
      class="account-dock flex shrink-0 flex-col border-t border-brand-border bg-brand-surface"
      style={{ height: `${panelHeight()}px` }}
    >
      <div
        class="group flex h-2 cursor-row-resize items-center justify-center"
        onMouseDown={startResize}
      >
        <div class="h-0.5 w-10 rounded-full bg-brand-border transition-colors group-hover:bg-brand-slate-500" />
      </div>
      <div class="flex min-h-10 items-stretch border-b border-brand-border">
        <div class="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          <For each={[...ACCOUNT_TABS].filter(tab => PRIMARY_TABS.has(tab.id)).sort((a, b) => ["positions", "openOrders", "balances", "tradeHistory"].indexOf(a.id) - ["positions", "openOrders", "balances", "tradeHistory"].indexOf(b.id))}>
            {(tab) => (
              <button
                type="button"
                class={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  activeTab() === tab.id
                    ? "border-brand-accent text-slate-100"
                    : "border-transparent text-brand-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                <Show when={tabCountFor(tab.id) > 0}>
                  <span class="ml-1 text-[10px] text-brand-slate-300">
                    ({tabCountFor(tab.id)})
                  </span>
                </Show>
              </button>
            )}
          </For>
          <select aria-label="More account sections" class="max-w-40 border-0 bg-brand-surface px-3 text-xs text-brand-slate-400" value={PRIMARY_TABS.has(activeTab()) ? '' : activeTab()} onChange={event => setActiveTab(event.currentTarget.value as AccountTab)}>
            <option value="" disabled>More</option>
            <For each={ACCOUNT_TABS.filter(tab => !PRIMARY_TABS.has(tab.id))}>{tab => <option value={tab.id}>{tab.label}</option>}</For>
          </select>
        </div>
        <AccountDockFilters
          tab={activeTab()}
          side={sideFilter()}
          market={marketFilter()}
          markets={availableMarkets()}
          onSideChange={setSideFilter}
          onMarketChange={setMarketFilter}
        />
      </div>
      <div class="flex-1 overflow-auto">
        <Suspense
          fallback={
            <div class="flex h-full items-center justify-center text-xs text-brand-slate-500">
              <Spinner label="Loading account activity" />
            </div>
          }
        >
          <Show when={activeTab() === "balances"}>
            <BalancesPanel compact />
          </Show>
          <Show when={activeTab() === "positions"}>
            <PositionsTable
              compact
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "openOrders"}>
            <OpenOrdersTable
              compact
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "twap"}>
            <TwapTable
              compact
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "chase"}>
            <ChaseTable compact marketFilter={marketFilter()} />
          </Show>
          <Show when={activeTab() === "tradeHistory"}>
            <TradeHistoryTable
              compact
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "fundingHistory"}>
            <FundingHistoryTable
              compact
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
          <Show when={activeTab() === "orderHistory"}>
            <OrderHistoryTable
              compact
              sideFilter={sideFilter()}
              marketFilter={marketFilter()}
            />
          </Show>
        </Suspense>
      </div>
    </div>
  );
};

export default TradePanel;
