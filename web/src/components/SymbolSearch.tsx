import {
  Component,
  createSignal,
  createMemo,
  For,
  createEffect,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import {
  MARKETS,
  searchOpen,
  setSearchOpen,
  selectMarket,
  toggleTickerWatchlist,
  isTickerWatchlisted,
  marketsLoading,
} from "../stores/market";
import { formatVolume, formatPercent } from "../lib/hyperliquid";

type FilterType = "all" | "perps-xyz" | "perps-hl" | "spot" | "watchlist";
type SortColumn = "volume" | "openInterest" | "funding" | "change";
type SortDirection = "asc" | "desc";

const SearchIcon: Component<{ class?: string }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class ?? "w-4 h-4"}
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const StarIcon: Component<{ active?: boolean }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    class={`w-4 h-4 transition-colors duration-150 ${
      props.active
        ? "fill-brand-slate-400 text-brand-slate-400"
        : "fill-transparent text-brand-slate-600 stroke-current stroke-[1.5]"
    }`}
  >
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.77 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const ChevronDownIcon: Component<{ class?: string }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class ?? "w-3 h-3"}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const TrendingUpIcon: Component<{ class?: string }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    class={props.class ?? "w-3.5 h-3.5"}
  >
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const TrendingDownIcon: Component<{ class?: string }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    class={props.class ?? "w-3.5 h-3.5"}
  >
    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
    <polyline points="17 18 23 18 23 12" />
  </svg>
);

const getDisplaySymbol = (symbol: string): string =>
  symbol.toLowerCase().startsWith("xyz:")
    ? symbol.slice(symbol.indexOf(":") + 1)
    : symbol;

const getIconLabel = (symbol: string): string => {
  if (symbol === "BTC") return "₿";
  if (symbol === "ETH") return "◆";
  if (symbol === "ZEC") return "Ⓩ";
  if (symbol === "XRP") return "✕";
  if (symbol.length <= 3) return symbol;
  return symbol.slice(0, 3);
};

const ICON_SOURCES: Record<string, string> = {
  NATGAS: "https://s3-symbol-logo.tradingview.com/natural-gas.svg",
};

const ICON_SYMBOLS = new Set([
  "BTC",
  "ETH",
  "HYPE",
  "SOL",
  "ZEC",
  "XYZ100",
  "TSLA",
  "NVDA",
  "HOOD",
  "PLTR",
  "MSTR",
  "BABA",
  "GOOGL",
  "AMZN",
  "INTC",
  "CRCL",
  "COIN",
  "AMD",
  "META",
  "MU",
  "NFLX",
  "MSFT",
  "AAPL",
  "SNDK",
  "ORCL",
  "SILVER",
  "GOLD",
  "COPPER",
  "NATGAS",
  "PLATINUM",
]);

const SymbolSearch: Component = () => {
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<FilterType>("all");
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [sortColumn, setSortColumn] = createSignal<SortColumn>("volume");
  const [sortDirection, setSortDirection] = createSignal<SortDirection>("desc");
  const [scrollTop, setScrollTop] = createSignal(0);
  const [listHeight, setListHeight] = createSignal(0);
  const [rowHeight, setRowHeight] = createSignal(72);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const overscan = 6;

  const normalizedQuery = createMemo(() => query().trim().toLowerCase());
  const isMarketStarred = (market: ReturnType<typeof MARKETS>[number]) =>
    isTickerWatchlisted(market.symbol, market.type);
  const toggleMarketStar = (market: ReturnType<typeof MARKETS>[number]) =>
    toggleTickerWatchlist(market.symbol, market.type);

  const sortedMarkets = createMemo(() => {
    if (!searchOpen()) return [];
    const col = sortColumn();
    const dir = sortDirection() === "desc" ? -1 : 1;
    const markets = MARKETS();
    const results = [...markets];
    results.sort((a, b) => {
      let aVal: number;
      let bVal: number;
      switch (col) {
        case "volume":
          aVal = a.volume24h;
          bVal = b.volume24h;
          break;
        case "openInterest":
          aVal = a.openInterest;
          bVal = b.openInterest;
          break;
        case "funding":
          aVal = a.funding;
          bVal = b.funding;
          break;
        case "change":
          aVal = a.change24h;
          bVal = b.change24h;
          break;
        default:
          aVal = a.volume24h;
          bVal = b.volume24h;
      }
      return (aVal - bVal) * dir;
    });
    return results;
  });

  const filteredMarkets = createMemo(() => {
    if (!searchOpen()) return [];
    const q = normalizedQuery();
    const f = filter();
    const base = sortedMarkets();
    if (!q && f === "all") return base;
    const results: ReturnType<typeof MARKETS> = [];
    for (const market of base) {
      if (
        q &&
        !market.name.toLowerCase().includes(q) &&
        !market.symbol.toLowerCase().includes(q)
      ) {
        continue;
      }
      if (
        f === "watchlist" &&
        !isTickerWatchlisted(market.symbol, market.type)
      ) {
        continue;
      }
      if (f === "perps-xyz" && market.type !== "equities") {
        continue;
      }
      if (f === "perps-hl" && market.type !== "perps") {
        continue;
      }
      if (f === "spot" && market.type !== "spot") {
        continue;
      }
      results.push(market);
    }
    return results;
  });

  const totalMarkets = createMemo(() => filteredMarkets().length);

  const startIndex = createMemo(() => {
    const height = rowHeight();
    if (height <= 0) return 0;
    return Math.max(0, Math.floor(scrollTop() / height) - overscan);
  });

  const endIndex = createMemo(() => {
    const height = rowHeight();
    if (height <= 0) return 0;
    const visibleCount = Math.ceil(listHeight() / height) + overscan * 2;
    return Math.min(totalMarkets(), startIndex() + visibleCount);
  });

  const visibleMarkets = createMemo(() =>
    filteredMarkets().slice(startIndex(), endIndex()),
  );

  const topSpacerHeight = createMemo(() => startIndex() * rowHeight());
  const bottomSpacerHeight = createMemo(
    () => (totalMarkets() - endIndex()) * rowHeight(),
  );

  const updateListMetrics = () => {
    if (!listRef) return;
    setListHeight(listRef.clientHeight);
    const row = listRef.querySelector<HTMLElement>(".market-row");
    if (row) {
      const nextHeight = Math.max(
        1,
        Math.round(row.getBoundingClientRect().height),
      );
      setRowHeight(nextHeight);
    }
  };

  const setListRef = (el: HTMLDivElement) => {
    listRef = el;
    updateListMetrics();
  };

  const handleScroll = () => {
    if (!listRef) return;
    setScrollTop(listRef.scrollTop);
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn() === column) {
      setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const scrollToSelected = () => {
    if (!listRef) return;
    const height = rowHeight();
    if (height <= 0) return;
    const viewHeight = listHeight() || listRef.clientHeight;
    const targetTop = selectedIdx() * height;
    const targetBottom = targetTop + height;
    const viewTop = listRef.scrollTop;
    const viewBottom = viewTop + viewHeight;
    if (targetTop < viewTop) {
      listRef.scrollTo({ top: targetTop, behavior: "smooth" });
    } else if (targetBottom > viewBottom) {
      listRef.scrollTo({
        top: targetBottom - viewHeight,
        behavior: "smooth",
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const markets = filteredMarkets();
    const maxIndex = Math.max(0, markets.length - 1);
    if (e.key === "Escape") {
      setSearchOpen(false);
    } else if ((e.metaKey || e.ctrlKey) && e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(0);
      requestAnimationFrame(scrollToSelected);
    } else if ((e.metaKey || e.ctrlKey) && e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(maxIndex);
      requestAnimationFrame(scrollToSelected);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, maxIndex));
      requestAnimationFrame(scrollToSelected);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      requestAnimationFrame(scrollToSelected);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const market = markets[selectedIdx()];
      if (market) {
        selectMarket(market);
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      const market = markets[selectedIdx()];
      if (market) toggleMarketStar(market);
    }
  };

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f" && searchOpen()) {
      e.preventDefault();
      inputRef?.focus();
      inputRef?.select();
    }
    if (searchOpen() && e.key === "Escape") {
      setSearchOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleGlobalKeyDown);
    updateListMetrics();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => updateListMetrics());
      if (listRef) {
        resizeObserver.observe(listRef);
      }
    } else {
      window.addEventListener("resize", updateListMetrics);
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleGlobalKeyDown);
    if (resizeObserver) {
      resizeObserver.disconnect();
    } else {
      window.removeEventListener("resize", updateListMetrics);
    }
  });

  // Focus input when modal opens
  createEffect(() => {
    if (!searchOpen()) return;
    requestAnimationFrame(() => {
      inputRef?.focus();
      inputRef?.select();
    });
  });

  createEffect(() => {
    if (!searchOpen()) return;
    if (totalMarkets() === 0) return;
    requestAnimationFrame(updateListMetrics);
  });

  createEffect(() => {
    const total = totalMarkets();
    if (total === 0) {
      if (selectedIdx() !== 0) {
        setSelectedIdx(0);
      }
      return;
    }
    if (selectedIdx() > total - 1) {
      setSelectedIdx(total - 1);
    }
  });

  createEffect(() => {
    if (!searchOpen() || !listRef) return;
    const maxScroll = Math.max(0, totalMarkets() * rowHeight() - listHeight());
    if (listRef.scrollTop > maxScroll) {
      listRef.scrollTop = maxScroll;
      setScrollTop(maxScroll);
    }
  });

  // Format price change with absolute value
  const formatPriceChange = (market: ReturnType<typeof MARKETS>[0]) => {
    const price = parseFloat(market.price.replace(/,/g, ""));
    const changePercent = market.change24h;
    const priceChange = (price * changePercent) / 100;

    const absChange = Math.abs(priceChange);
    let absFormatted: string;
    if (absChange >= 1000) {
      absFormatted = absChange.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
    } else if (absChange >= 1) {
      absFormatted = absChange.toFixed(2);
    } else if (absChange >= 0.01) {
      absFormatted = absChange.toFixed(4);
    } else {
      absFormatted = absChange.toFixed(6);
    }

    const sign = priceChange >= 0 ? "+" : "-";
    return { sign, absFormatted, percent: formatPercent(changePercent) };
  };

  const filterTabs = [
    { id: "all" as FilterType, label: "All" },
    { id: "perps-xyz" as FilterType, label: "Perps", badge: "XYZ" },
    { id: "perps-hl" as FilterType, label: "Perps", icon: "/hyperliquid.svg" },
    { id: "spot" as FilterType, label: "Spot" },
    { id: "watchlist" as FilterType, label: "Watchlist", emoji: "★" },
  ];

  return (
    <Show when={searchOpen()}>
      <div
        class="symbol-search-overlay market-search-overlay is-open"
        onClick={(e) => e.target === e.currentTarget && setSearchOpen(false)}
      >
        <div
          class="symbol-search-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Market search"
        >
          {/* Search Header */}
          <div class="search-header">
            <div class="search-input-wrapper">
              <SearchIcon class="search-icon" />
              <input
                ref={inputRef}
                type="text"
                aria-label="Search markets"
                placeholder={`Search ${MARKETS().length} markets...`}
                class="search-input"
                value={query()}
                onInput={(e) => {
                  setQuery(e.currentTarget.value);
                  setSelectedIdx(0);
                  if (listRef) {
                    listRef.scrollTo({ top: 0 });
                    setScrollTop(0);
                  }
                }}
                onKeyDown={handleKeyDown}
              />
              <button
                class="search-shortcut"
                aria-label="Close market search"
                onClick={() => setSearchOpen(false)}
              >
                <kbd class="hidden md:block">esc</kbd>
                <span class="md:hidden text-xl" aria-hidden="true">
                  ×
                </span>
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div class="filter-section">
            <div class="filter-tabs">
              <For each={filterTabs}>
                {(tab) => (
                  <button
                    class={`filter-tab ${filter() === tab.id ? "active" : ""}`}
                    onClick={() => setFilter(tab.id)}
                  >
                    {tab.emoji && <span class="tab-emoji">{tab.emoji}</span>}
                    <span>{tab.label}</span>
                    {tab.badge && <span class="tab-badge">{tab.badge}</span>}
                    {tab.icon && <img src={tab.icon} alt="" class="tab-icon" />}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Table Header */}
          <div class="table-header">
            <div class="th-cell th-market">Market</div>
            <button
              class={`th-cell th-sortable ${sortColumn() === "change" ? "active" : ""}`}
              onClick={() => handleSort("change")}
            >
              <span>24h Change</span>
              <Show when={sortColumn() === "change"}>
                <ChevronDownIcon
                  class={`th-sort-icon ${sortDirection() === "asc" ? "asc" : ""}`}
                />
              </Show>
            </button>
            <button
              class={`th-cell th-sortable th-volume ${sortColumn() === "volume" ? "active" : ""}`}
              onClick={() => handleSort("volume")}
            >
              <span>Volume</span>
              <Show when={sortColumn() === "volume"}>
                <ChevronDownIcon
                  class={`th-sort-icon ${sortDirection() === "asc" ? "asc" : ""}`}
                />
              </Show>
            </button>
            <button
              class={`th-cell th-sortable th-openInterest ${sortColumn() === "openInterest" ? "active" : ""}`}
              onClick={() => handleSort("openInterest")}
            >
              <span>Open Interest</span>
              <Show when={sortColumn() === "openInterest"}>
                <ChevronDownIcon
                  class={`th-sort-icon ${sortDirection() === "asc" ? "asc" : ""}`}
                />
              </Show>
            </button>
            <button
              class={`th-cell th-sortable th-funding ${sortColumn() === "funding" ? "active" : ""}`}
              onClick={() => handleSort("funding")}
            >
              <span>Funding</span>
              <Show when={sortColumn() === "funding"}>
                <ChevronDownIcon
                  class={`th-sort-icon ${sortDirection() === "asc" ? "asc" : ""}`}
                />
              </Show>
            </button>
            <div class="th-cell th-action"></div>
          </div>

          {/* Market Rows */}
          <div ref={setListRef} class="market-list" onScroll={handleScroll}>
            <Show when={marketsLoading()}>
              <div class="loading-state">
                <div class="loading-spinner" />
                <span>Loading markets...</span>
              </div>
            </Show>
            <Show when={!marketsLoading()}>
              <Show when={topSpacerHeight() > 0}>
                <div style={{ height: `${topSpacerHeight()}px` }} />
              </Show>
              <For each={visibleMarkets()}>
                {(market, idx) => {
                  const change = formatPriceChange(market);
                  const isPositive = market.change24h >= 0;
                  const displaySymbol = getDisplaySymbol(market.symbol);
                  const iconSrc =
                    ICON_SOURCES[displaySymbol] ??
                    `/${displaySymbol.toLowerCase()}.svg`;
                  const absoluteIdx = () => idx() + startIndex();

                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${market.name}`}
                      data-idx={absoluteIdx()}
                      class={`market-row ${absoluteIdx() === selectedIdx() ? "selected" : ""}`}
                      onClick={() => selectMarket(market)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectMarket(market);
                        }
                      }}
                    >
                      <div class="market-info">
                        <Show
                          when={ICON_SYMBOLS.has(displaySymbol)}
                          fallback={
                            <div class="market-icon market-icon-fallback">
                              <span>{getIconLabel(displaySymbol)}</span>
                            </div>
                          }
                        >
                          <div class="market-icon">
                            <img
                              src={iconSrc}
                              alt={displaySymbol}
                              class="coin-logo"
                            />
                          </div>
                        </Show>
                        <div class="market-details">
                          <div class="market-name-row">
                            <span class="market-name">
                              {market.type === "equities"
                                ? `[${market.name}]`
                                : market.name}
                            </span>
                            <span class="leverage-badge">
                              {market.type === "spot"
                                ? "Spot"
                                : market.leverage}
                            </span>
                            {market.type === "equities" && (
                              <span class="xyz-badge">XYZ</span>
                            )}
                          </div>
                          <span class="market-price">${market.price}</span>
                        </div>
                      </div>

                      <div
                        class={`change-cell ${isPositive ? "positive" : "negative"}`}
                      >
                        <div class="change-indicator">
                          {isPositive ? (
                            <TrendingUpIcon class="trend-icon" />
                          ) : (
                            <TrendingDownIcon class="trend-icon" />
                          )}
                        </div>
                        <div class="change-values">
                          <span class="change-absolute">
                            {change.sign}${change.absFormatted}
                          </span>
                          <span class="change-percent">{change.percent}</span>
                        </div>
                      </div>

                      <div class="volume-cell">
                        <span class="volume-value">
                          {formatVolume(market.volume24h)}
                        </span>
                      </div>

                      <div class="oi-cell">
                        <span class="oi-value">
                          {market.type === "spot"
                            ? "--"
                            : formatVolume(market.openInterest)}
                        </span>
                      </div>

                      <div
                        class={`funding-cell ${market.type === "spot" ? "" : market.funding >= 0 ? "positive" : "negative"}`}
                      >
                        <span class="funding-value">
                          {market.type === "spot"
                            ? "--"
                            : formatPercent(market.funding)}
                        </span>
                      </div>

                      <button
                        type="button"
                        class="star-cell"
                        aria-label={`${isMarketStarred(market) ? "Remove" : "Add"} ${market.name} ${isMarketStarred(market) ? "from" : "to"} watchlist`}
                        aria-pressed={isMarketStarred(market)}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMarketStar(market);
                        }}
                      >
                        <StarIcon active={isMarketStarred(market)} />
                      </button>
                    </div>
                  );
                }}
              </For>
              <Show when={bottomSpacerHeight() > 0}>
                <div style={{ height: `${bottomSpacerHeight()}px` }} />
              </Show>
            </Show>
          </div>

          {/* Footer */}
          <div class="search-footer">
            <div class="shortcuts">
              <div class="shortcut-group">
                <kbd>↑</kbd>
                <kbd>↓</kbd>
                <span>Navigate</span>
              </div>
              <div class="shortcut-group">
                <kbd>↵</kbd>
                <span>Select</span>
              </div>
              <div class="shortcut-group">
                <kbd>⌘</kbd>
                <kbd>F</kbd>
                <span>Search</span>
              </div>
              <div class="shortcut-group">
                <kbd>⌘</kbd>
                <kbd>S</kbd>
                <span>Watchlist</span>
              </div>
            </div>
            <div class="market-count">
              <span class="count-number">{totalMarkets()}</span>
              <span class="count-label">markets</span>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default SymbolSearch;
