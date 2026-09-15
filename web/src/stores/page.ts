import { createSignal } from "solid-js";
import {
  currentSymbol,
  formatMarketName,
  getUrlSymbol,
  normalizeUrlSymbol,
  setCurrentMarket,
  setCurrentSymbol,
} from "./market";

export const MAIN_PAGES = [
  { id: "trade", label: "Trade" },
  { id: "portfolio", label: "Portfolio" },
  { id: "brief", label: "Brief" },
  { id: "calendar", label: "Calendar" },
  { id: "charts", label: "Charts" },
] as const;

export type Page = (typeof MAIN_PAGES)[number]["id"] | "admin";

const parseUrl = (): { page: Page; symbol?: string } => {
  const [segment, rawSymbol] = window.location.pathname
    .split("/")
    .filter(Boolean);
  if (segment === "trade") {
    return {
      page: "trade",
      symbol: normalizeUrlSymbol(rawSymbol || "") || undefined,
    };
  }
  const page = MAIN_PAGES.find((item) => item.id === segment)?.id;
  // Retired and unknown routes return to the terminal, including old history entries.
  return { page: page ?? (segment === "admin" ? "admin" : "trade") };
};

const [currentPage, setCurrentPageInternal] = createSignal<Page>("trade");

const applyRoute = ({ page, symbol }: ReturnType<typeof parseUrl>) => {
  setCurrentPageInternal(page);
  if (symbol) {
    setCurrentSymbol(symbol);
    setCurrentMarket(formatMarketName(symbol));
  }
  const label = MAIN_PAGES.find((item) => item.id === page)?.label ?? "Admin";
  document.title =
    page === "trade"
      ? `${getUrlSymbol(currentSymbol())} | TradingView`
      : `${label} | TradingView`;
};

const pathForPage = (page: Page) =>
  page === "trade" ? `/trade/${getUrlSymbol(currentSymbol())}` : `/${page}`;

export const setCurrentPage = (page: Page) => {
  applyRoute({ page });
  if (window.location.pathname !== pathForPage(page)) {
    window.history.pushState(
      { page, symbol: currentSymbol() },
      "",
      pathForPage(page),
    );
  }
};

const restoreRoute = () => {
  const route = parseUrl();
  applyRoute(route);
  window.history.replaceState(
    { page: route.page, symbol: currentSymbol() },
    "",
    pathForPage(route.page),
  );
};

window.addEventListener("popstate", restoreRoute);
restoreRoute();

export { currentPage };
