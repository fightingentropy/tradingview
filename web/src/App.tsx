import {
  Component,
  Show,
  Suspense,
  createEffect,
  createSignal,
  lazy,
  onCleanup,
  onMount,
} from "solid-js";
import Header from "./components/Header";
import MarketInfo from "./components/MarketInfo";
import DeferredTradingViewChart from "./components/DeferredTradingViewChart";
import OrderBook from "./components/OrderBook";
import OrderForm from "./components/OrderForm";
import SymbolSearch from "./components/SymbolSearch";
import TradePanel from "./components/TradePanel";
import WatchlistPanel from "./components/WatchlistPanel";
import ModalHost from "./components/ModalHost";
import AccountConnectionControl from "./components/AccountConnectionControl";
import {
  reduceMotion,
  setShowWatchlist,
  showAccountPanel,
  showOrderBook,
  showWatchlist,
  useLivePrices,
} from "./stores/market";
import { currentPage, setCurrentPage } from "./stores/page";
import { openSettings, settingsOpen } from "./stores/settings";
import { isAdmin, isAuthenticated, logout } from "./stores/auth";
import { disconnectHyperliquid } from "./stores/hyperliquidExecution";
import { apiWalletVaultRevocationEpoch } from "./stores/apiWalletVault";
import { clearApiWalletSession } from "./stores/apiWalletSession";
import { restoreSavedApiWalletOnStartup } from "./stores/apiWalletConnection";
import {
  loadAdminDashboard,
  loadBrief,
  loadChartsGrid,
  loadEconomicCalendar,
  loadPortfolio,
  prefetchPage,
} from "./lib/routeModules";

const Portfolio = lazy(loadPortfolio);
const ChartsGrid = lazy(loadChartsGrid);
const AdminDashboard = lazy(loadAdminDashboard);
const Brief = lazy(loadBrief);
const EconomicCalendar = lazy(loadEconomicCalendar);

const WATCHLIST_WIDTH_KEY = "trade-xyz-watchlist-width";
const DEFAULT_WATCHLIST_WIDTH = 260;
const MIN_WATCHLIST_WIDTH = 200;
const CHARTS_NAV_HIDE_DELAY_MS = 2000;

const ChartsHeaderOverlay: Component = () => {
  const [isVisible, setIsVisible] = createSignal(false);
  let hideTimeout: number | undefined;

  const clearHideTimeout = () => {
    if (hideTimeout !== undefined) {
      window.clearTimeout(hideTimeout);
      hideTimeout = undefined;
    }
  };

  const revealNavigation = () => {
    clearHideTimeout();
    setIsVisible(true);
  };

  const hideNavigation = () => {
    clearHideTimeout();
    setIsVisible(false);
  };

  const hideNavigationAfterDelay = () => {
    clearHideTimeout();
    hideTimeout = window.setTimeout(hideNavigation, CHARTS_NAV_HIDE_DELAY_MS);
  };

  const revealNavigationBriefly = () => {
    revealNavigation();
    hideNavigationAfterDelay();
  };

  onCleanup(clearHideTimeout);

  return (
    <>
      <button
        type="button"
        aria-label="Show navigation"
        aria-controls="charts-navigation-overlay"
        aria-expanded={isVisible()}
        data-testid="charts-nav-hot-zone"
        class="fixed inset-x-0 top-0 z-40 hidden h-3 cursor-default border-0 bg-transparent p-0 md:block"
        onPointerEnter={revealNavigationBriefly}
        onFocus={revealNavigation}
        onBlur={hideNavigationAfterDelay}
        onClick={revealNavigationBriefly}
      />
      <div
        id="charts-navigation-overlay"
        data-testid="charts-nav-overlay"
        data-visible={isVisible() ? "true" : "false"}
        aria-hidden={!isVisible()}
        inert={!isVisible()}
        class={`fixed inset-x-0 top-0 z-50 hidden border-b border-brand-border bg-brand-screen shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-[transform,opacity] duration-200 ease-out md:block ${
          isVisible()
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-full opacity-0"
        }`}
        onPointerEnter={revealNavigation}
        onPointerLeave={hideNavigationAfterDelay}
        onFocusIn={revealNavigation}
        onFocusOut={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            hideNavigationAfterDelay();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            hideNavigation();
          }
        }}
      >
        <Header />
      </div>
    </>
  );
};

const App: Component = () => {
  const [isTabVisible, setIsTabVisible] = createSignal(!document.hidden);
  const [mobileTradePane, setMobileTradePane] = createSignal<
    "chart" | "book" | "order"
  >("chart");
  const [mobileProfileOpen, setMobileProfileOpen] = createSignal(false);
  const [watchlistWidth, setWatchlistWidth] = createSignal(
    DEFAULT_WATCHLIST_WIDTH,
  );
  let watchlistMoveHandler: ((event: MouseEvent) => void) | null = null;
  let watchlistUpHandler: (() => void) | null = null;
  let observedApiWalletVaultRevocation = apiWalletVaultRevocationEpoch();

  createEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion()
      ? "true"
      : "false";
  });

  createEffect(() => {
    const revocation = apiWalletVaultRevocationEpoch();
    if (revocation === observedApiWalletVaultRevocation) return;
    observedApiWalletVaultRevocation = revocation;
    clearApiWalletSession();
    disconnectHyperliquid();
  });

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
    void restoreSavedApiWalletOnStartup();
    onCleanup(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("resize", handleWindowResize);
      stopWatchlistResize();
    });
  });

  // Start live price polling
  useLivePrices({
    enabled: () => currentPage() === "trade" && isTabVisible(),
  });

  return (
    <div class="app-shell flex w-full flex-col bg-brand-screen text-slate-200">
      {/* Header */}
      <Show when={currentPage() !== "charts"}>
        <Header />
      </Show>

      <Show when={currentPage() === "charts"}>
        <ChartsHeaderOverlay />
      </Show>

      {/* Mobile Header */}
      <Show when={currentPage() !== "charts"}>
        <header class="mobile-header flex md:hidden items-center justify-between px-4 py-3 border-b border-brand-border">
          <button onClick={() => setCurrentPage("trade")}>
            <span class="text-base font-semibold tracking-tight text-brand-slate-100">
              Trading<span class="text-brand-slate-100">View</span>
            </span>
          </button>
          <div class="flex items-center gap-2">
            <AccountConnectionControl
              compact
              onBeforeOpen={() => setMobileProfileOpen(false)}
            />
            <Show when={isAuthenticated()}>
              <div class="relative">
                <button
                  class="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-slate-100 border border-brand-border rounded-full hover:border-brand-accent hover:text-brand-accent transition-colors"
                  onClick={() => setMobileProfileOpen(!mobileProfileOpen())}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span>Profile</span>
                </button>

                {mobileProfileOpen() && (
                  <>
                    <div
                      class="fixed inset-0 z-40"
                      onClick={() => setMobileProfileOpen(false)}
                    />
                    <div class="absolute right-0 top-full mt-2 w-48 bg-brand-surface border border-brand-border rounded-lg shadow-xl z-50 py-2">
                      <button
                        class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-brand-red-400 hover:bg-brand-border/30 transition-colors"
                        onClick={() => {
                          setMobileProfileOpen(false);
                          logout();
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        <span>Sign out</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </Show>

            <button
              type="button"
              aria-label="Settings"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen()}
              aria-controls="settings-dialog"
              class="flex h-9 w-9 items-center justify-center rounded-full border border-brand-border bg-brand-surface text-brand-slate-400"
              onClick={() => {
                setMobileProfileOpen(false);
                openSettings();
              }}
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
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </header>
      </Show>

      {/* Trade View */}
      <Show when={currentPage() === "trade"}>
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
      </Show>

      {/* Portfolio View */}
      <Show when={currentPage() === "portfolio"}>
        <div class="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div class="h-full w-full flex items-center justify-center text-brand-slate-400">
                Loading...
              </div>
            }
          >
            <Portfolio />
          </Suspense>
        </div>
      </Show>

      {/* Brief View */}
      <Show when={currentPage() === "brief"}>
        <div class="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div class="h-full w-full flex items-center justify-center text-brand-slate-400">
                Loading brief...
              </div>
            }
          >
            <Brief />
          </Suspense>
        </div>
      </Show>

      {/* Calendar View */}
      <Show when={currentPage() === "calendar"}>
        <div class="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div class="h-full w-full flex items-center justify-center text-brand-slate-400">
                Loading calendar...
              </div>
            }
          >
            <EconomicCalendar />
          </Suspense>
        </div>
      </Show>

      {/* Charts View */}
      <Show when={currentPage() === "charts"}>
        <div class="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div class="h-full w-full flex items-center justify-center text-brand-slate-400">
                Loading...
              </div>
            }
          >
            <ChartsGrid />
          </Suspense>
        </div>
      </Show>

      {/* Admin View */}
      <Show when={currentPage() === "admin"}>
        <div class="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div class="h-full w-full flex items-center justify-center text-brand-slate-400">
                Loading...
              </div>
            }
          >
            <AdminDashboard />
          </Suspense>
        </div>
      </Show>

      {/* Mobile Bottom Nav */}
      <nav
        class="mobile-nav flex md:hidden items-center justify-around border-t border-brand-border"
        aria-label="Main navigation"
      >
        <button
          class={`flex flex-col items-center gap-1 ${currentPage() === "trade" ? "text-brand-accent" : "text-brand-slate-400"}`}
          onClick={() => setCurrentPage("trade")}
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
            <path d="m3 17 2.5-8.5L12 6l6.5 2.5L21 17" />
            <path d="m3 17 9 4 9-4" />
            <path d="M12 10v12" />
          </svg>
          <span class="text-xs">Trade</span>
        </button>

        <button
          class={`flex flex-col items-center gap-1 ${currentPage() === "portfolio" ? "text-brand-accent" : "text-brand-slate-400"}`}
          onPointerEnter={() => prefetchPage("portfolio")}
          onFocus={() => prefetchPage("portfolio")}
          onClick={() => setCurrentPage("portfolio")}
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
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
          </svg>
          <span class="text-xs">Portfolio</span>
        </button>

        <button
          class={`flex flex-col items-center gap-1 ${currentPage() === "brief" ? "text-brand-accent" : "text-brand-slate-400"}`}
          onPointerEnter={() => prefetchPage("brief")}
          onFocus={() => prefetchPage("brief")}
          onClick={() => setCurrentPage("brief")}
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
            <path d="M4 4h16v16H4z" />
            <path d="M8 8h8" />
            <path d="M8 12h8" />
            <path d="M8 16h5" />
          </svg>
          <span class="text-xs">Brief</span>
        </button>
        <button
          class={`flex flex-col items-center gap-1 ${currentPage() === "calendar" ? "text-brand-accent" : "text-brand-slate-400"}`}
          onPointerEnter={() => prefetchPage("calendar")}
          onFocus={() => prefetchPage("calendar")}
          onClick={() => setCurrentPage("calendar")}
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
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 10h18" />
            <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
          </svg>
          <span class="text-xs">Calendar</span>
        </button>
        <button
          class={`flex flex-col items-center gap-1 ${currentPage() === "charts" ? "text-brand-accent" : "text-brand-slate-400"}`}
          onPointerEnter={() => prefetchPage("charts")}
          onFocus={() => prefetchPage("charts")}
          onClick={() => setCurrentPage("charts")}
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
            <path d="M3 3v18h18" />
            <path d="m7 14 3-3 3 3 5-6" />
          </svg>
          <span class="text-xs">Charts</span>
        </button>
        <Show when={isAdmin()}>
          <button
            class={`flex flex-col items-center gap-1 ${currentPage() === "admin" ? "text-brand-accent" : "text-brand-slate-400"}`}
            onPointerEnter={() => prefetchPage("admin")}
            onFocus={() => prefetchPage("admin")}
            onClick={() => setCurrentPage("admin")}
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
              <path d="M12 3l8 4v4c0 5.55-3.84 10.74-8 12-4.16-1.26-8-6.45-8-12V7l8-4Z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <span class="text-xs">Admin</span>
          </button>
        </Show>
      </nav>

      <ModalHost />

      {/* Symbol Search Modal */}
      <SymbolSearch />
    </div>
  );
};

export default App;
