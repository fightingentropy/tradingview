import { Component, For, Show, createMemo, createSignal, onMount, onCleanup } from "solid-js";
import {
  MARKETS,
  activeWatchlistId,
  currentSymbol,
  getUrlSymbol,
  selectMarket,
  setActiveWatchlist,
  watchlistNames,
  createWatchlist,
  deleteWatchlist,
  removeFromWatchlist,
  addToWatchlist,
  setSearchOpen,
  normalizeUrlSymbol,
} from "../stores/market";
import type { Market } from "../stores/market";

const WATCHLIST_COLUMN_WIDTHS_KEY = "watchlist_column_widths";

interface ColumnWidths {
  symbol: number;
  last: number;
  chg: number;
  chgPercent: number;
}

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  symbol: 120,
  last: 80,
  chg: 80,
  chgPercent: 85,
};

const loadColumnWidths = (): ColumnWidths => {
  try {
    const stored = localStorage.getItem(WATCHLIST_COLUMN_WIDTHS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ColumnWidths>;
      return {
        symbol: parsed.symbol ?? DEFAULT_COLUMN_WIDTHS.symbol,
        last: parsed.last ?? DEFAULT_COLUMN_WIDTHS.last,
        chg: parsed.chg ?? DEFAULT_COLUMN_WIDTHS.chg,
        chgPercent: parsed.chgPercent ?? DEFAULT_COLUMN_WIDTHS.chgPercent,
      };
    }
  } catch (e) {
    // Ignore parse errors
  }
  return { ...DEFAULT_COLUMN_WIDTHS };
};

const saveColumnWidths = (widths: ColumnWidths) => {
  try {
    localStorage.setItem(WATCHLIST_COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  } catch (e) {
    // Ignore storage errors
  }
};

const formatPriceChange = (market: Market) => {
  const price = Number(String(market.price).replace(/,/g, ""));
  const changePercent = market.change24h;

  if (!Number.isFinite(price) || !Number.isFinite(changePercent)) {
    return { change: "--", percent: "--" };
  }

  const priceChange = (price * changePercent) / 100;
  const absChange = Math.abs(priceChange);

  // Always format to 2 decimal places with consistent width for alignment
  const absFormatted = absChange.toFixed(2);
  // Pad integer part to ensure decimal points align
  const [changeIntPart, changeDecPart] = absFormatted.split(".");
  // Determine padding based on value size for better alignment
  // For values < 100, pad to 2 digits; for larger values, keep as is
  const paddedChangeIntPart = absChange < 100 ? changeIntPart.padStart(2, "0") : changeIntPart;
  const formattedChange = `${paddedChangeIntPart}.${changeDecPart}`;

  const sign = priceChange >= 0 ? "+" : "-";

  // Format percentage with 2 decimal places
  const percentValue = Math.abs(changePercent);
  const percentFormatted = percentValue.toFixed(2);
  const percentSign = changePercent >= 0 ? "+" : "-";
  const percent = `${percentSign}${percentFormatted}%`;

  return {
    change: `${sign}${formattedChange}`,
    percent,
  };
};

const changeClass = (changePercent: number) => {
  if (!Number.isFinite(changePercent)) return "text-brand-slate-500";
  return changePercent >= 0 ? "text-brand-green-400" : "text-brand-red-400";
};

const WatchlistPanel: Component = () => {
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("desc");
  const watchlistMarkets = createMemo(() =>
    MARKETS()
      .filter((market) => market.watchlist && market.type !== "spot")
      .slice()
      .sort((a, b) => {
        const aChange = Number.isFinite(a.change24h) ? a.change24h : -Infinity;
        const bChange = Number.isFinite(b.change24h) ? b.change24h : -Infinity;
        const direction = sortDirection() === "desc" ? -1 : 1;
        return direction * (aChange - bChange);
      }),
  );

  const [columnWidths, setColumnWidths] = createSignal<ColumnWidths>(loadColumnWidths());
  const [showCreateInput, setShowCreateInput] = createSignal(false);
  const [newListName, setNewListName] = createSignal("");
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal<string | null>(null);
  const [addSymbolInput, setAddSymbolInput] = createSignal("");
  let containerRef: HTMLDivElement | undefined;
  let createInputRef: HTMLInputElement | undefined;
  let addSymbolInputRef: HTMLInputElement | undefined;
  let resizeHandlers: {
    moveHandler: ((event: MouseEvent) => void) | null;
    upHandler: (() => void) | null;
  }[] = [];

  const stopResize = (index: number) => {
    const handler = resizeHandlers[index];
    if (handler?.moveHandler) {
      window.removeEventListener("mousemove", handler.moveHandler);
      handler.moveHandler = null;
    }
    if (handler?.upHandler) {
      window.removeEventListener("mouseup", handler.upHandler);
      handler.upHandler = null;
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const startResize = (index: number, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidths = { ...columnWidths() };
    const columnKeys: (keyof ColumnWidths)[] = ["symbol", "last", "chg", "chgPercent"];
    const leftColumn = columnKeys[index];
    const rightColumn = columnKeys[index + 1];

    if (!leftColumn || !rightColumn) return;

    const moveHandler = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidths = { ...startWidths };

      const newLeftWidth = Math.max(60, startWidths[leftColumn] + delta);
      const newRightWidth = Math.max(60, startWidths[rightColumn] - delta);

      newWidths[leftColumn] = newLeftWidth;
      newWidths[rightColumn] = newRightWidth;

      setColumnWidths(newWidths);
      saveColumnWidths(newWidths);
    };

    const upHandler = () => stopResize(index);

    if (!resizeHandlers[index]) {
      resizeHandlers[index] = { moveHandler: null, upHandler: null };
    }
    resizeHandlers[index].moveHandler = moveHandler;
    resizeHandlers[index].upHandler = upHandler;

    window.addEventListener("mousemove", moveHandler);
    window.addEventListener("mouseup", upHandler);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  onMount(() => {
    // Initialize resize handlers array
    resizeHandlers = Array(3).fill(null).map(() => ({ moveHandler: null, upHandler: null }));
  });

  onCleanup(() => {
    resizeHandlers.forEach((_, index) => stopResize(index));
  });

  const handleCreateList = () => {
    const name = newListName().trim();
    if (name && createWatchlist(name)) {
      setNewListName("");
      setShowCreateInput(false);
    }
  };

  const handleDeleteList = (listId: string) => {
    if (showDeleteConfirm() === listId) {
      deleteWatchlist(listId);
      setShowDeleteConfirm(null);
    } else {
      setShowDeleteConfirm(listId);
    }
  };

  const handleAddSymbol = () => {
    // Focus the add symbol input field
    addSymbolInputRef?.focus();
  };

  const handleAddSymbolDirect = () => {
    const symbol = addSymbolInput().trim();
    if (!symbol) return;

    // Try to normalize and find the symbol in available markets
    const normalized = normalizeUrlSymbol(symbol);
    const allMarkets = MARKETS();
    const foundMarket = allMarkets.find(
      (m) => m.symbol === normalized ||
             m.symbol.toUpperCase() === symbol.toUpperCase() ||
             getUrlSymbol(m.symbol).toUpperCase() === symbol.toUpperCase()
    );

    if (foundMarket) {
      addToWatchlist(foundMarket.symbol);
      setAddSymbolInput("");
    } else {
      // Try adding the symbol as-is (might be a valid symbol not in current markets)
      addToWatchlist(normalized);
      setAddSymbolInput("");
    }
  };

  const handleRemoveSymbol = (symbol: string, e: MouseEvent) => {
    e.stopPropagation();
    removeFromWatchlist(symbol);
  };

  const widths = () => columnWidths();

  return (
    <div class="flex h-full w-full flex-col">
      <div class="flex items-center justify-between px-3 py-2 border-b border-brand-border gap-2">
        <div class="flex items-center gap-1 flex-1 min-w-0">
          <select
            value={activeWatchlistId()}
            onChange={(e) => {
              setActiveWatchlist(e.currentTarget.value);
              setShowDeleteConfirm(null);
            }}
            class="text-sm font-semibold text-slate-100 bg-transparent border-none outline-none cursor-pointer hover:text-slate-200 focus:text-slate-200 appearance-none pr-6 flex-1 min-w-0"
            style="background-image: url('data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22%3E%3Cpath fill=%22%2394a3b8%22 d=%22M6 9L1 4h10z%22/%3E%3C/svg%3E'); background-repeat: no-repeat; background-position: right 0 center;"
          >
            <For each={watchlistNames()}>
              {(name) => (
                <option value={name} class="bg-brand-slate-900 text-slate-100">
                  {name}
                </option>
              )}
            </For>
          </select>
          <Show when={!showCreateInput()}>
            <button
              type="button"
              onClick={() => {
                setShowCreateInput(true);
                setTimeout(() => createInputRef?.focus(), 0);
              }}
              class="text-brand-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
              title="Create new list"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-4 h-4"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <Show
              when={
                watchlistNames().some(
                  (name) => !["crypto", "commodities", "indices", "stocks"].includes(name),
                )
              }
            >
              <button
                type="button"
                onClick={() => handleDeleteList(activeWatchlistId())}
                class="text-brand-slate-400 hover:text-brand-red-400 transition-colors flex-shrink-0"
                title={
                  showDeleteConfirm() === activeWatchlistId()
                    ? "Confirm delete"
                    : "Delete list"
                }
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-4 h-4"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            </Show>
          </Show>
          <Show when={showCreateInput()}>
            <input
              ref={createInputRef}
              type="text"
              value={newListName()}
              onInput={(e) => setNewListName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateList();
                } else if (e.key === "Escape") {
                  setShowCreateInput(false);
                  setNewListName("");
                }
              }}
              onBlur={() => {
                if (!newListName().trim()) {
                  setShowCreateInput(false);
                }
              }}
              placeholder="List name"
              class="text-sm text-slate-100 bg-brand-slate-800 border border-brand-border rounded-md px-3 py-1 outline-none focus:border-brand-accent flex-1 min-w-0"
              autofocus
            />
            <button
              type="button"
              onClick={handleCreateList}
              class="text-brand-green-400 hover:text-brand-green-300 transition-colors flex-shrink-0"
              title="Create"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-4 h-4"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateInput(false);
                setNewListName("");
              }}
              class="text-brand-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
              title="Cancel"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-4 h-4"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>
        <button
          type="button"
          onClick={handleAddSymbol}
          class="text-[11px] text-brand-slate-500 hover:text-slate-200 transition-colors flex-shrink-0"
          title="Focus add symbol input"
        >
          +
        </button>
      </div>

      <div
        ref={containerRef}
        class="flex-1 overflow-hidden flex flex-col"
      >
        {/* Header Row */}
        <div
          class="flex border-b border-brand-border"
          style={{
            "user-select": "none",
          }}
        >
          <div
            class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-brand-slate-500 flex-shrink-0"
            style={{ width: `${widths().symbol}px` }}
          >
            Symbol
          </div>
          <div
            class="group relative flex-shrink-0 cursor-col-resize"
            style={{ width: "4px", "margin-left": "-2px", "margin-right": "-2px" }}
            onMouseDown={(e) => startResize(0, e)}
          >
            <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-transparent group-hover:bg-brand-accent/50 transition-colors" />
          </div>
          <div
            class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-brand-slate-500 text-right font-mono tabular-nums flex-shrink-0"
            style={{ width: `${widths().last}px` }}
          >
            Last
          </div>
          <div
            class="group relative flex-shrink-0 cursor-col-resize"
            style={{ width: "4px", "margin-left": "-2px", "margin-right": "-2px" }}
            onMouseDown={(e) => startResize(1, e)}
          >
            <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-transparent group-hover:bg-brand-accent/50 transition-colors" />
          </div>
          <div
            class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-brand-slate-500 text-right font-mono tabular-nums flex-shrink-0"
            style={{ width: `${widths().chg}px` }}
          >
            Chg
          </div>
          <div
            class="group relative flex-shrink-0 cursor-col-resize"
            style={{ width: "4px", "margin-left": "-2px", "margin-right": "-2px" }}
            onMouseDown={(e) => startResize(2, e)}
          >
            <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-transparent group-hover:bg-brand-accent/50 transition-colors" />
          </div>
          <button
            type="button"
            onClick={() =>
              setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"))
            }
            class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-brand-slate-500 text-right font-mono tabular-nums flex-shrink-0 hover:text-slate-200 transition-colors"
            style={{ width: `${widths().chgPercent}px` }}
            title="Toggle sort by change percent"
          >
            Chg%
            <span class="ml-1 text-[9px]">
              {sortDirection() === "desc" ? "v" : "^"}
            </span>
          </button>
          <div class="flex-1" />
        </div>

        {/* Data Rows */}
        <div class="flex-1 overflow-y-auto">
          <Show
            when={watchlistMarkets().length > 0}
            fallback={
              <div class="px-3 py-3 text-xs text-brand-slate-500">
                No watchlist items yet.
              </div>
            }
          >
            <For each={watchlistMarkets()}>
              {(market) => {
                const change = formatPriceChange(market);
                const isActive = () => market.symbol === currentSymbol();

                return (
                  <div
                    class={`flex hover:bg-brand-border/30 transition-colors group ${
                      isActive() ? "bg-brand-border/30" : ""
                    }`}
                  >
                    <button
                      type="button"
                      class="flex flex-1 min-w-0"
                      onClick={() => selectMarket(market)}
                    >
                      <div
                        class="px-3 py-1.5 text-xs text-slate-200 truncate flex-shrink-0"
                        style={{ width: `${widths().symbol}px` }}
                      >
                        {getUrlSymbol(market.symbol)}
                      </div>
                      <div
                        class="px-3 py-1.5 text-xs text-right font-mono tabular-nums text-slate-200 flex-shrink-0"
                        style={{ width: `${widths().last}px` }}
                      >
                        {market.price}
                      </div>
                      <div
                        class={`px-3 py-1.5 text-xs text-right font-mono tabular-nums flex-shrink-0 ${changeClass(market.change24h)}`}
                        style={{ width: `${widths().chg}px` }}
                      >
                        {change.change}
                      </div>
                      <div
                        class={`px-3 py-1.5 text-xs text-right font-mono tabular-nums flex-shrink-0 ${changeClass(market.change24h)}`}
                        style={{ width: `${widths().chgPercent}px` }}
                      >
                        {change.percent}
                      </div>
                      <div class="flex-1" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveSymbol(market.symbol, e)}
                      class="px-2 py-1.5 text-brand-slate-500 hover:text-brand-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                      title="Remove from watchlist"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-3.5 h-3.5"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </div>

      {/* Add Symbol Input */}
      <div class="px-3 py-2 border-t border-brand-border flex items-center gap-2">
        <input
          ref={addSymbolInputRef}
          type="text"
          value={addSymbolInput()}
          onInput={(e) => setAddSymbolInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddSymbolDirect();
            } else if (e.key === "Escape") {
              setAddSymbolInput("");
            }
          }}
          placeholder="Add symbol (e.g. BTC, TSLA, NVDA)"
          class="flex-1 text-xs text-slate-100 bg-brand-slate-800 border border-brand-border rounded-md px-3 py-1.5 outline-none focus:border-brand-accent placeholder:text-brand-slate-500"
        />
        <button
          type="button"
          onClick={handleAddSymbolDirect}
          disabled={!addSymbolInput().trim()}
          class="px-3 py-1.5 text-xs font-medium text-slate-100 bg-brand-accent hover:bg-brand-accent/80 disabled:bg-brand-slate-700 disabled:text-brand-slate-500 disabled:cursor-not-allowed rounded-full transition-colors flex-shrink-0"
          title="Add symbol to watchlist"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          class="px-2 py-1.5 text-xs text-brand-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
          title="Open symbol search (Cmd+K)"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-4 h-4"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default WatchlistPanel;
