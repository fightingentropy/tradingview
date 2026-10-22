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
import Header, { WordmarkIcon } from "./components/Header";
import PageView from "./components/PageView";
import Spinner from "./components/Spinner";
import ModalHost from "./components/ModalHost";
import "./components/Chrome.css";
import AccountConnectionControl from "./components/AccountConnectionControl";
import { reduceMotion, searchOpen, setSearchOpen } from "./stores/market";
import { currentPage, setCurrentPage } from "./stores/page";
import { openSettings, settingsOpen } from "./stores/settings";
import { isAdmin, isAuthenticated, logout } from "./stores/auth";
import { disconnectHyperliquid } from "./stores/hyperliquidExecution";
import { apiWalletVaultRevocationEpoch } from "./stores/apiWalletVault";
import { clearApiWalletSession } from "./stores/apiWalletSession";
import { restoreSavedApiWalletOnStartup } from "./stores/apiWalletConnection";
import {
  loadTrade,
  loadAdminDashboard,
  loadBrief,
  loadNews,
  loadChartsGrid,
  loadEconomicCalendar,
  loadEarningsCalendar,
  loadPortfolio,
  loadStats,
  prefetchPage,
} from "./lib/routeModules";

const TradeWorkspace = lazy(loadTrade);
const SymbolSearch = lazy(() => import("./components/SymbolSearch"));
const Portfolio = lazy(loadPortfolio);
const Stats = lazy(loadStats);
const ChartsGrid = lazy(loadChartsGrid);
const AdminDashboard = lazy(loadAdminDashboard);
const Brief = lazy(loadBrief);
const News = lazy(loadNews);
const EconomicCalendar = lazy(loadEconomicCalendar);
const EarningsCalendar = lazy(loadEarningsCalendar);

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
        class={`fixed inset-x-0 top-0 z-50 hidden bg-brand-screen shadow-[0_16px_32px_rgba(0,0,0,0.4)] transition-[transform,opacity] duration-200 ease-out md:block ${
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
  const [mobileProfileOpen, setMobileProfileOpen] = createSignal(false);
  const [searchLoaded, setSearchLoaded] = createSignal(false);
  createEffect(() => { if (searchOpen()) setSearchLoaded(true); });
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

  onMount(() => {
    void restoreSavedApiWalletOnStartup();
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", openSearch);
    onCleanup(() => document.removeEventListener("keydown", openSearch));
  });

  return (
    <div class="app-shell flex w-full flex-col bg-brand-screen text-brand-slate-100">
      {/* Header */}
      <Show when={currentPage() !== "charts"}>
        <Header />
      </Show>

      <Show when={currentPage() === "charts"}>
        <ChartsHeaderOverlay />
      </Show>

      {/* Mobile Header */}
      <Show when={currentPage() !== "charts"}>
        <header class="mobile-header flex md:hidden items-center justify-between">
          <button type="button" class="app-wordmark" onClick={() => setCurrentPage("trade")}>
            <WordmarkIcon />
            <span>TradingView</span>
          </button>
          <div class="flex min-w-0 items-center gap-1">
            <AccountConnectionControl
              compact
              onBeforeOpen={() => setMobileProfileOpen(false)}
            />
            <Show when={isAuthenticated()}>
              <div class="relative">
                <button
                  type="button"
                  class="icon-btn"
                  aria-expanded={mobileProfileOpen()}
                  onClick={() => setMobileProfileOpen(!mobileProfileOpen())}
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
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span class="sr-only">Profile</span>
                </button>

                {mobileProfileOpen() && (
                  <>
                    <div
                      class="fixed inset-0 z-40"
                      onClick={() => setMobileProfileOpen(false)}
                    />
                    <div class="menu">
                      <button
                        class="menu-item menu-item-danger"
                        onClick={() => {
                          setMobileProfileOpen(false);
                          logout();
                        }}
                      >
                        <svg
                          aria-hidden="true"
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
              class="icon-btn"
              onClick={() => {
                setMobileProfileOpen(false);
                openSettings();
              }}
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
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </header>
      </Show>

      {/* Trade View */}
      <PageView name="trade" active={currentPage() === "trade"}>
        <Suspense fallback={<div class="flex flex-1 items-center justify-center"><Spinner label="Loading trading view" /></div>}>
          <TradeWorkspace />
        </Suspense>
      </PageView>

      {/* Portfolio View */}
      <PageView name="portfolio" active={currentPage() === "portfolio"}>
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
      </PageView>

      <PageView name="stats" active={currentPage() === "stats"}>
        <Suspense fallback={<div class="flex flex-1 items-center justify-center"><Spinner label="Loading stats" /></div>}>
          <Stats />
        </Suspense>
      </PageView>

      {/* Brief View */}
      <PageView name="brief" active={currentPage() === "brief"}>
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
      </PageView>

      {/* News View */}
      <PageView name="news" active={currentPage() === "news"}>
        <Suspense fallback={<div class="flex flex-1 items-center justify-center"><Spinner label="Loading news" /></div>}>
          <News />
        </Suspense>
      </PageView>

      {/* Calendar View */}
      <PageView name="calendar" active={currentPage() === "calendar"}>
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
      </PageView>

      <PageView name="earnings" active={currentPage() === "earnings"}>
        <Suspense fallback={<div class="flex flex-1 items-center justify-center"><Spinner label="Loading earnings" /></div>}>
          <EarningsCalendar />
        </Suspense>
      </PageView>

      {/* Charts View */}
      <PageView name="charts" active={currentPage() === "charts"}>
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
      </PageView>

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
        class="mobile-nav flex md:hidden"
        aria-label="Main navigation"
      >
        <button
          type="button"
          aria-current={currentPage() === "trade" ? "page" : undefined}
          onClick={() => setCurrentPage("trade")}
        >
          <svg
            aria-hidden="true"
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
          <span>Trade</span>
        </button>

        <button
          type="button"
          aria-current={currentPage() === "portfolio" ? "page" : undefined}
          onPointerEnter={() => prefetchPage("portfolio")}
          onFocus={() => prefetchPage("portfolio")}
          onClick={() => setCurrentPage("portfolio")}
        >
          <svg
            aria-hidden="true"
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
          <span>Portfolio</span>
        </button>
        <button
          type="button"
          aria-current={currentPage() === "stats" ? "page" : undefined}
          onPointerEnter={() => prefetchPage("stats")} onFocus={() => prefetchPage("stats")}
          onClick={() => setCurrentPage("stats")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 20h16M7 16v-5M12 16V5M17 16V8" /></svg>
          <span>Stats</span>
        </button>

        <button
          type="button"
          aria-current={currentPage() === "brief" ? "page" : undefined}
          onPointerEnter={() => prefetchPage("brief")}
          onFocus={() => prefetchPage("brief")}
          onClick={() => setCurrentPage("brief")}
        >
          <svg
            aria-hidden="true"
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
          <span>Brief</span>
        </button>
        <button
          type="button"
          aria-current={currentPage() === "news" ? "page" : undefined}
          onPointerEnter={() => prefetchPage("news")}
          onFocus={() => prefetchPage("news")}
          onClick={() => setCurrentPage("news")}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h16v16H4zM8 8h8M8 12h3M8 16h3M15 12h1M15 16h1" />
          </svg>
          <span>News</span>
        </button>
        <button
          type="button"
          aria-current={currentPage() === "calendar" ? "page" : undefined}
          onPointerEnter={() => prefetchPage("calendar")}
          onFocus={() => prefetchPage("calendar")}
          onClick={() => setCurrentPage("calendar")}
        >
          <svg
            aria-hidden="true"
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
          <span>Calendar</span>
        </button>
        <button
          type="button"
          aria-current={currentPage() === "earnings" ? "page" : undefined}
          onPointerEnter={() => prefetchPage("earnings")}
          onFocus={() => prefetchPage("earnings")}
          onClick={() => setCurrentPage("earnings")}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 20h16M7 16v-3M12 16V8M17 16V4" />
            <path d="m4 9 4-4 3 3" />
          </svg>
          <span>Earnings</span>
        </button>
        <button
          type="button"
          aria-current={currentPage() === "charts" ? "page" : undefined}
          onPointerEnter={() => prefetchPage("charts")}
          onFocus={() => prefetchPage("charts")}
          onClick={() => setCurrentPage("charts")}
        >
          <svg
            aria-hidden="true"
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
          <span>Charts</span>
        </button>
        <Show when={isAdmin()}>
          <button
            type="button"
          aria-current={currentPage() === "admin" ? "page" : undefined}
            onPointerEnter={() => prefetchPage("admin")}
            onFocus={() => prefetchPage("admin")}
            onClick={() => setCurrentPage("admin")}
          >
            <svg
              aria-hidden="true"
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
            <span>Admin</span>
          </button>
        </Show>
      </nav>

      <ModalHost />

      {/* Symbol Search Modal */}
      <Show when={searchLoaded()}><Suspense><SymbolSearch /></Suspense></Show>
    </div>
  );
};

export default App;
