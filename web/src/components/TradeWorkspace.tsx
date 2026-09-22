import { type Component, Show, createSignal, onCleanup, onMount } from "solid-js";
import MarketInfo from "./MarketInfo";
import DeferredTradingViewChart from "./DeferredTradingViewChart";
import OrderBook from "./OrderBook";
import OrderForm from "./OrderForm";
import TradePanel from "./TradePanel";
import WatchlistPanel from "./WatchlistPanel";
import {
  setShowWatchlist,
  showAccountPanel,
  showOrderBook,
  showWatchlist,
  useLivePrices,
} from "../stores/market";
import { useOrderBookFeed } from "../stores/clob";

const WATCHLIST_WIDTH_KEY = "trade-xyz-watchlist-width";
const DEFAULT_WATCHLIST_WIDTH = 260;
const MIN_WATCHLIST_WIDTH = 200;

const TradeWorkspace: Component = () => {
  const [isTabVisible, setIsTabVisible] = createSignal(!document.hidden);
  const [mobileTradePane, setMobileTradePane] = createSignal<
    "chart" | "book" | "order"
  >("chart");
  const [watchlistWidth, setWatchlistWidth] = createSignal(
    DEFAULT_WATCHLIST_WIDTH,
  );
  let watchlistMoveHandler: ((event: MouseEvent) => void) | null = null;
  let watchlistUpHandler: (() => void) | null = null;
  const clampWatchlistWidth = (value: number) => {
    const maxWidth = Math.max(
      MIN_WATCHLIST_WIDTH,
      Math.round(window.innerWidth * 0.4),
    );
    return Math.min(maxWidth, Math.max(MIN_WATCHLIST_WIDTH, value));
  };

  const loadWatchlistWidth = () => {
    try {
      const stored = localStorage.getItem(WATCHLIST_WIDTH_KEY);
      if (stored) {
        const parsed = Number(stored);
        if (Number.isFinite(parsed)) {
          return clampWatchlistWidth(parsed);
        }
      }
    } catch (error) {
      // Ignore storage errors
    }
    return clampWatchlistWidth(DEFAULT_WATCHLIST_WIDTH);
  };

  const persistWatchlistWidth = (value: number) => {
    try {
      localStorage.setItem(WATCHLIST_WIDTH_KEY, String(Math.round(value)));
    } catch (error) {
      // Ignore storage errors
    }
  };

  const handleVisibilityChange = () => {
    setIsTabVisible(!document.hidden);
  };

  const handleGlobalKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      setShowWatchlist((prev) => !prev);
    }
  };

  const stopWatchlistResize = () => {
    if (watchlistMoveHandler) {
      window.removeEventListener("mousemove", watchlistMoveHandler);
      watchlistMoveHandler = null;
    }
    if (watchlistUpHandler) {
      window.removeEventListener("mouseup", watchlistUpHandler);
      watchlistUpHandler = null;
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const startWatchlistResize = (event: MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = watchlistWidth();

    watchlistMoveHandler = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = clampWatchlistWidth(startWidth + delta);
      setWatchlistWidth(nextWidth);
      persistWatchlistWidth(nextWidth);
    };

    watchlistUpHandler = () => stopWatchlistResize();

    window.addEventListener("mousemove", watchlistMoveHandler);
    window.addEventListener("mouseup", watchlistUpHandler);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleWindowResize = () => {
    setWatchlistWidth((current) => clampWatchlistWidth(current));
  };

  onMount(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("resize", handleWindowResize);
    setWatchlistWidth(loadWatchlistWidth());
    onCleanup(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("resize", handleWindowResize);
      stopWatchlistResize();
    });
  });

  // Start live price polling
  useLivePrices({
    enabled: () => isTabVisible(),
  });

  useOrderBookFeed(isTabVisible);

  return (
    <>
      {/* Market Info Bar */}
      <MarketInfo />

      <nav class="mobile-trade-tabs md:hidden" aria-label="Trading panels">
        <button
          aria-pressed={mobileTradePane() === "chart"}
          onClick={() => setMobileTradePane("chart")}
        >
          Chart
        </button>
        <button
          aria-pressed={mobileTradePane() === "book"}
          onClick={() => setMobileTradePane("book")}
        >
          Order book
        </button>
        <button
          aria-pressed={mobileTradePane() === "order"}
          onClick={() => setMobileTradePane("order")}
        >
          Order
        </button>
      </nav>
      {/* Main Content */}
      <div
        class="trading-workspace flex flex-1 min-h-0 overflow-hidden"
        data-mobile-pane={mobileTradePane()}
      >
        <Show when={showWatchlist()}>
          <div
            class="relative hidden lg:flex shrink-0 border-r border-brand-border bg-brand-surface"
            style={{ width: `${watchlistWidth()}px` }}
          >
            <WatchlistPanel />
            <div
              class="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-brand-border/60"
              onMouseDown={startWatchlistResize}
            />
          </div>
        </Show>
        {/* Chart Area */}
        <div class="trade-chart-column flex-1 flex flex-col min-w-0 min-h-0">
          <DeferredTradingViewChart />

          {/* Bottom Panel - Positions/Orders */}
          <Show when={showAccountPanel()}>
            <TradePanel />
          </Show>
        </div>

        {/* Order Book */}
        <Show when={showOrderBook() || mobileTradePane() === "book"}>
          <div
            class="trade-book-column"
            classList={{ "desktop-book-hidden": !showOrderBook() }}
          >
            <OrderBook />
          </div>
        </Show>

        {/* Order Form */}
        <div class="trade-ticket-column">
          <OrderForm />
        </div>
      </div>
    </>
  );
};
export default TradeWorkspace;
