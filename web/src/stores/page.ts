import { createSignal } from "solid-js";
import {
  currentSymbol,
  formatMarketName,
  getUrlSymbol,
  normalizeUrlSymbol,
  setCurrentMarket,
  setCurrentSymbol,
} from "./market";

export type Page =
  | "trade"
  | "options"
  | "portfolio"
  | "brief"
  | "calendar"
  | "charts"
  | "admin"
  | "vaults";

// Parse URL to get initial state
const parseUrl = (): { page: Page; symbol?: string; vaultId?: string } => {
  const path = window.location.pathname;

  // /trade or /trade/SYMBOL
  if (path === "/trade" || path.startsWith("/trade/")) {
    const parts = path.split("/").filter(Boolean);
    const symbol = normalizeUrlSymbol(parts[1] || "");
    return { page: "trade", symbol: symbol || undefined };
  }

  // /portfolio
  if (path === "/portfolio") {
    return { page: "portfolio" };
  }

  // /options
  if (path === "/options") {
    return { page: "options" };
  }

  // /brief
  if (path === "/brief") {
    return { page: "brief" };
  }

  // /calendar
  if (path === "/calendar") {
    return { page: "calendar" };
  }

  // /vaults or /vaults/:id
  if (path === "/vaults" || path.startsWith("/vaults/")) {
    const parts = path.split("/").filter(Boolean);
    const vaultId = parts[1];
    return { page: "vaults", vaultId: vaultId || undefined };
  }

  // /charts
  if (path === "/charts") {
    return { page: "charts" };
  }

  // /admin
  if (path === "/admin") {
    return { page: "admin" };
  }

  // Default: / goes to trade
  return { page: "trade" };
};

const initialState = parseUrl();

const [currentPage, setCurrentPageInternal] = createSignal<Page>(
  initialState.page,
);
const [currentVaultId, setCurrentVaultIdInternal] = createSignal<
  string | undefined
>(initialState.vaultId);

const setPageTitle = (page: Page) => {
  if (page === "portfolio") {
    document.title = "Portfolio | TradingView";
  } else if (page === "options") {
    document.title = "Options | TradingView";
  } else if (page === "vaults") {
    document.title = "Vaults | TradingView";
  } else if (page === "brief") {
    document.title = "Brief | TradingView";
  } else if (page === "calendar") {
    document.title = "Calendar | TradingView";
  } else if (page === "charts") {
    document.title = "Charts | TradingView";
  } else if (page === "admin") {
    document.title = "Admin | TradingView";
  }
};

// Set initial symbol from URL if present
if (initialState.symbol) {
  setCurrentSymbol(initialState.symbol);
  setCurrentMarket(formatMarketName(initialState.symbol));
}

// Update URL when page changes
export const setCurrentPage = (
  page: Page,
  options: { vaultId?: string } = {},
) => {
  setCurrentPageInternal(page);
  if (page !== "vaults") {
    setCurrentVaultIdInternal(undefined);
  }

  if (page === "portfolio") {
    window.history.pushState({ page }, "", "/portfolio");
    setPageTitle(page);
  } else if (page === "options") {
    window.history.pushState({ page }, "", "/options");
    setPageTitle(page);
  } else if (page === "brief") {
    window.history.pushState({ page }, "", "/brief");
    setPageTitle(page);
  } else if (page === "calendar") {
    window.history.pushState({ page }, "", "/calendar");
    setPageTitle(page);
  } else if (page === "vaults") {
    const nextVaultId = options.vaultId;
    setCurrentVaultIdInternal(nextVaultId);
    const nextPath = nextVaultId ? `/vaults/${nextVaultId}` : "/vaults";
    window.history.pushState({ page, vaultId: nextVaultId }, "", nextPath);
    setPageTitle(page);
  } else if (page === "charts") {
    window.history.pushState({ page }, "", "/charts");
    setPageTitle(page);
  } else if (page === "admin") {
    window.history.pushState({ page }, "", "/admin");
    setPageTitle(page);
  } else {
    const symbol = currentSymbol();
    window.history.pushState(
      { page, symbol },
      "",
      `/trade/${getUrlSymbol(symbol)}`,
    );
  }
};

// Handle browser back/forward navigation
window.addEventListener("popstate", (event) => {
  const state = event.state;

  if (state?.page === "portfolio") {
    setCurrentPageInternal("portfolio");
    setPageTitle("portfolio");
  } else if (state?.page === "options") {
    setCurrentPageInternal("options");
    setPageTitle("options");
  } else if (state?.page === "brief") {
    setCurrentPageInternal("brief");
    setPageTitle("brief");
  } else if (state?.page === "calendar") {
    setCurrentPageInternal("calendar");
    setPageTitle("calendar");
  } else if (state?.page === "vaults") {
    setCurrentPageInternal("vaults");
    setCurrentVaultIdInternal(state.vaultId);
    setPageTitle("vaults");
  } else if (state?.page === "charts") {
    setCurrentPageInternal("charts");
    setPageTitle("charts");
  } else if (state?.page === "admin") {
    setCurrentPageInternal("admin");
    setPageTitle("admin");
  } else if (state?.page === "trade") {
    setCurrentPageInternal("trade");
    if (state.symbol) {
      const symbol = normalizeUrlSymbol(state.symbol);
      setCurrentSymbol(symbol);
      setCurrentMarket(formatMarketName(symbol));
    }
  } else {
    // Fallback: parse current URL
    const parsed = parseUrl();
    setCurrentPageInternal(parsed.page);
    if (parsed.page === "vaults") {
      setCurrentVaultIdInternal(parsed.vaultId);
    } else {
      setCurrentVaultIdInternal(undefined);
    }
    if (parsed.page !== "trade") {
      setPageTitle(parsed.page);
    }
    if (parsed.symbol) {
      setCurrentSymbol(parsed.symbol);
      setCurrentMarket(formatMarketName(parsed.symbol));
    }
  }
});

// Set initial URL state (replace, don't push)
if (initialState.page === "portfolio") {
  window.history.replaceState({ page: "portfolio" }, "", "/portfolio");
  setPageTitle("portfolio");
} else if (initialState.page === "options") {
  window.history.replaceState({ page: "options" }, "", "/options");
  setPageTitle("options");
} else if (initialState.page === "brief") {
  window.history.replaceState({ page: "brief" }, "", "/brief");
  setPageTitle("brief");
} else if (initialState.page === "calendar") {
  window.history.replaceState({ page: "calendar" }, "", "/calendar");
  setPageTitle("calendar");
} else if (initialState.page === "vaults") {
  const nextPath = initialState.vaultId
    ? `/vaults/${initialState.vaultId}`
    : "/vaults";
  window.history.replaceState(
    { page: "vaults", vaultId: initialState.vaultId },
    "",
    nextPath,
  );
  setPageTitle("vaults");
} else if (initialState.page === "charts") {
  window.history.replaceState({ page: "charts" }, "", "/charts");
  setPageTitle("charts");
} else if (initialState.page === "admin") {
  window.history.replaceState({ page: "admin" }, "", "/admin");
  setPageTitle("admin");
} else {
  const symbol = currentSymbol();
  window.history.replaceState(
    { page: "trade", symbol },
    "",
    `/trade/${getUrlSymbol(symbol)}`,
  );
}

export { currentPage, currentVaultId };
