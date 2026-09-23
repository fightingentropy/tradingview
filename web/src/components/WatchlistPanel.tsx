import { type Component, For, Show, createMemo, createSignal, createUniqueId, onMount, onCleanup } from "solid-js";
import {
  MARKETS, activeWatchlistId, activeWatchlistSymbols, currentSymbol, getUrlSymbol,
  selectMarket, setActiveWatchlist, watchlistNames, watchlistSymbols, createWatchlist, deleteWatchlist,
  removeFromWatchlist, addToWatchlist, marketsLoading, type Market,
} from "../stores/market";
import { isDefaultWatchlist, watchlistLabel } from "../lib/watchlists";
import { instrumentDisplayName } from "../../../src/domain/instrumentDisplay";
import Spinner from "./Spinner";
import MarketAvatar from "./MarketAvatar";
import WatchlistThemeIcon from "./WatchlistThemeIcon";
import "./WatchlistPanel.css";

const marketName = (market: Market) => instrumentDisplayName({
  symbol: market.symbol.split(":").pop()!, name: market.name,
  assetClass: market.type === "equities" ? "equity-perp" : "crypto-perp",
});
const dailyMove = (market: Market) => {
  const move = (market.prevDayPrice ?? NaN) * market.change24h / 100;
  if (!Number.isFinite(move)) return "";
  return `${move < 0 ? "−" : "+"}${Math.abs(move).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: Math.abs(move) < 1 ? 4 : 2,
  })}`;
};

interface Props {
  onSelectMarket?: (market: Market) => void;
  selectedSymbol?: string;
  onClose?: () => void;
}
const WatchlistPanel: Component<Props> = (props) => {
  const [search, setSearch] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [name, setName] = createSignal("");
  const [sort, setSort] = createSignal<"saved" | "desc" | "asc">("saved");
  const [deleteConfirm, setDeleteConfirm] = createSignal(false);
  const pickerId = createUniqueId();
  let picker: HTMLDetailsElement | undefined;
  let manageMenu: HTMLDetailsElement | undefined;
  let modeButton: HTMLButtonElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  const bySymbol = createMemo(() => new Map(MARKETS().filter(market => market.type !== "spot").map(market => [market.symbol, market])));
  const listCount = (id: string) => new Set(watchlistSymbols(id).map(symbol =>
    bySymbol().has(symbol) ? symbol : bySymbol().has(`xyz:${symbol}`) ? `xyz:${symbol}` : null,
  ).filter(Boolean)).size;
  const rows = createMemo(() => {
    const query = search().trim().toLowerCase();
    const saved = activeWatchlistSymbols();
    const order = new Map(saved.map((symbol, index) => [symbol, index]));
    const rank = (symbol: string) => order.get(symbol) ?? order.get(symbol.replace(/^xyz:/, "")) ?? Infinity;
    const list = [...bySymbol().values()].filter(market => (adding() ? !market.watchlist : market.watchlist)
      && (!query || `${market.symbol} ${marketName(market)} ${getUrlSymbol(market.symbol)}`.toLowerCase().includes(query)));
    if (adding()) return list.sort((a, b) => b.volume24h - a.volume24h);
    if (sort() === "saved") return list.sort((a, b) => rank(a.symbol) - rank(b.symbol));
    return list.sort((a, b) => (sort() === "desc" ? -1 : 1) * (a.change24h - b.change24h));
  });
  const createList = (event: SubmitEvent) => {
    event.preventDefault();
    if (createWatchlist(name().trim())) { setCreating(false); setName(""); setEditing(false); setAdding(true); }
  };
  const select = (market: Market) => {
    if (adding()) addToWatchlist(market.symbol);
    else (props.onSelectMarket ?? selectMarket)(market);
  };
  const cycleSort = () => setSort(sort() === "saved" ? "desc" : sort() === "desc" ? "asc" : "saved");
  const closePicker = () => { if (picker) picker.open = false; };
  const chooseList = (id: string) => {
    setActiveWatchlist(id); setSearch(""); setDeleteConfirm(false); setAdding(false); setEditing(false);
    closePicker(); picker?.querySelector("summary")?.focus();
  };
  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!picker?.contains(event.target as Node)) closePicker();
      if (manageMenu && !manageMenu.contains(event.target as Node)) { manageMenu.open = false; setDeleteConfirm(false); }
    };
    document.addEventListener("pointerdown", outside);
    onCleanup(() => document.removeEventListener("pointerdown", outside));
  });

  return <section class="watchlist-panel" aria-label="Watchlist" onKeyDown={event => {
    if (event.key === "Escape" && editing()) {
      event.preventDefault(); event.stopPropagation(); setEditing(false); modeButton?.focus();
    }
  }}>
    <header class="watchlist-heading">
      <details ref={picker} class="watchlist-picker" onKeyDown={event => {
        if (event.key === "Escape" && picker?.open) {
          event.preventDefault(); event.stopPropagation(); closePicker(); picker.querySelector("summary")?.focus();
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (picker) picker.open = true;
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : current < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0)
          : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }}>
        <summary aria-label={`Choose watchlist: ${watchlistLabel(activeWatchlistId())}`} aria-haspopup="menu" aria-controls={pickerId}>
          <span class="watchlist-theme-avatar" data-theme={activeWatchlistId()}><WatchlistThemeIcon theme={activeWatchlistId()} /></span>
          <span class="watchlist-title">{watchlistLabel(activeWatchlistId())}</span>
          <svg class="watchlist-chevron" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg>
        </summary>
        <div class="watchlist-picker-menu" id={pickerId} role="menu" aria-label="Watchlists">
          <For each={watchlistNames()}>{id => <button role="menuitemradio" aria-label={watchlistLabel(id)} aria-checked={activeWatchlistId() === id} onClick={() => chooseList(id)}>
            <span class="watchlist-theme-avatar" data-theme={id}><WatchlistThemeIcon theme={id} /></span>
            <span>{watchlistLabel(id)}</span>
            <span class="watchlist-list-count">{listCount(id)}</span>
            <svg class="watchlist-list-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
          </button>}</For>
        </div>
      </details>
      <button ref={modeButton} class="watchlist-icon-button" aria-label={editing() ? "Done editing watchlist" : adding() ? "Done adding symbols" : "Add symbols"} title={adding() || editing() ? "Done" : "Add symbols"}
        aria-pressed={adding() || editing()} onClick={() => {
          if (editing()) { setEditing(false); return; }
          setAdding(!adding()); setSearch(""); searchInput?.focus();
        }}>
        <svg viewBox="0 0 24 24"><path d={adding() || editing() ? "m5 12 4 4L19 6" : "M12 5v14M5 12h14"} /></svg>
      </button>
      <details ref={manageMenu} class="watchlist-menu" onKeyDown={event => {
        if (event.key === "Escape" && manageMenu?.open) {
          event.preventDefault(); event.stopPropagation(); manageMenu.open = false; manageMenu.querySelector("summary")?.focus();
        }
      }}>
        <summary class="watchlist-icon-button" aria-label="Manage watchlists" title="Manage watchlists"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg></summary>
        <div>
          <button onClick={event => {
            setEditing(!editing()); setAdding(false); setCreating(false);
            event.currentTarget.closest("details")?.removeAttribute("open"); modeButton?.focus();
          }}>{editing() ? "Done editing" : "Edit watchlist"}</button>
          <button onClick={event => { setEditing(false); setAdding(false); setCreating(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}>New watchlist</button>
          <Show when={!isDefaultWatchlist(activeWatchlistId())}>
            <button onClick={event => {
              if (!deleteConfirm()) { setDeleteConfirm(true); return; }
              deleteWatchlist(activeWatchlistId()); setDeleteConfirm(false); setEditing(false); event.currentTarget.closest("details")?.removeAttribute("open");
            }}>{deleteConfirm() ? "Confirm delete" : "Delete watchlist"}</button>
          </Show>
        </div>
      </details>
      <Show when={props.onClose}><button class="watchlist-icon-button" aria-label="Close watchlist" onClick={() => props.onClose?.()}><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button></Show>
    </header>
    <Show when={creating()}>
      <form class="watchlist-create" onSubmit={createList}>
        <input aria-label="New watchlist name" placeholder="List name" value={name()} onInput={event => setName(event.currentTarget.value)} autofocus />
        <button type="submit" disabled={!name().trim()}>Create</button>
        <button type="button" aria-label="Cancel new watchlist" onClick={() => setCreating(false)}>×</button>
      </form>
    </Show>
    <div class="watchlist-search">
      <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
      <input ref={searchInput} aria-label={adding() ? "Find symbol to add" : "Search watchlist"} placeholder={adding() ? "Add symbol" : "Search"}
        value={search()} onInput={event => setSearch(event.currentTarget.value)} onKeyDown={event => {
          if (event.key === "Escape") { setSearch(""); setAdding(false); }
        }} />
      <Show when={search()}><button aria-label="Clear search" onClick={() => setSearch("")}>×</button></Show>
    </div>
    <div class="watchlist-columns"><span>Symbol</span><span>Last</span>
      <button onClick={cycleSort} title="Sort by daily change" aria-label={`Sort by daily change, ${sort() === "saved" ? "saved order" : sort() === "desc" ? "highest first" : "lowest first"}`}>24h % {sort() === "desc" ? "↓" : sort() === "asc" ? "↑" : ""}</button>
    </div>
    <div class="watchlist-rows">
      <Show when={rows().length} fallback={<div class="watchlist-empty">{marketsLoading() ? <Spinner /> : search() ? "No matches" : adding() ? "All symbols added" : "No symbols"}</div>}>
        <For each={rows().map(market => market.symbol)}>{symbol => {
          const market = () => bySymbol().get(symbol)!;
          const selected = () => symbol === (props.selectedSymbol ?? currentSymbol());
          return <div class="watchlist-row" classList={{ "is-selected": selected(), "is-editing": editing() }}>
            <Show when={editing()}><button class="watchlist-remove" title="Remove symbol" aria-label={`Remove ${getUrlSymbol(symbol)}`} onClick={event => {
              const row = event.currentTarget.parentElement;
              const next = row?.nextElementSibling?.querySelector<HTMLButtonElement>(".watchlist-remove")
                ?? row?.previousElementSibling?.querySelector<HTMLButtonElement>(".watchlist-remove");
              removeFromWatchlist(symbol); (next ?? modeButton)?.focus({ preventScroll: true });
            }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg></button></Show>
            <button class="watchlist-quote" aria-label={`${adding() ? "Add" : "Select"} ${getUrlSymbol(symbol)}`} aria-pressed={selected()}
              onClick={() => select(market())}>
              <span class="watchlist-instrument">
                <Show when={!editing()}><MarketAvatar symbol={symbol} /></Show>
                <span class="watchlist-instrument-text">
                  <span class="watchlist-symbol">{getUrlSymbol(symbol)}</span>
                  <span class="watchlist-name" title={marketName(market())}>{marketName(market())}</span>
                </span>
              </span>
              <span class="watchlist-values"><span class="watchlist-price">{market().price}</span>
                <span class="watchlist-move" classList={{ up: market().change24h >= 0, down: market().change24h < 0 }}>{dailyMove(market())}</span>
              </span>
              <span class="watchlist-change" classList={{ up: market().change24h >= 0, down: market().change24h < 0 }}>
                {Number.isFinite(market().change24h) ? `${market().change24h < 0 ? "−" : "+"}${Math.abs(market().change24h).toFixed(2)}%` : "—"}
              </span>
            </button>
          </div>;
        }}</For>
      </Show>
    </div>
    <footer class="watchlist-footer"><span>{rows().length} {rows().length === 1 ? "symbol" : "symbols"}</span><Show when={adding() || editing()}><button onClick={() => { setAdding(false); setEditing(false); setSearch(""); }}>Done</button></Show></footer>
  </section>;
};
export default WatchlistPanel;
