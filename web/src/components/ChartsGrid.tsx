import { type Component, Index, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import SymbolChart from "./SymbolChart";
import WatchlistPanel from "./WatchlistPanel";
import MarketAvatar from "./MarketAvatar";
import ChartControls from "./ChartControls";
import { MARKETS, getUrlSymbol, useLivePrices } from "../stores/market";
import { chartLayout, setChartLayout, setChartCount, setChartSymbol, removeChart } from "../stores/chartLayout";
import { CHART_COUNTS, type ChartCount } from "../lib/chartLayout";
import "./ChartsGrid.css";

const ChartsGrid: Component = () => {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [watchlistOpen, setWatchlistOpen] = createSignal(false);
  const [desktop, setDesktop] = createSignal(window.matchMedia("(min-width: 900px)").matches);
  const [visible, setVisible] = createSignal(!document.hidden);
  const pinned = () => chartLayout().count === 1 && desktop();
  const sidebarVisible = () => pinned() || watchlistOpen();
  let panel: HTMLElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let edge: HTMLButtonElement | undefined;
  let layoutMenu: HTMLDivElement | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const clearHide = () => { if (hideTimer) clearTimeout(hideTimer); hideTimer = undefined; };
  const reveal = () => { clearHide(); setWatchlistOpen(true); };
  const hide = () => {
    clearHide();
    if (pinned()) return;
    setWatchlistOpen(false);
  };
  const hideLater = () => {
    clearHide();
    hideTimer = setTimeout(() => {
      if (edge?.matches(":hover") || panel?.matches(":hover") || panel?.querySelector(":focus-visible") || panel?.querySelector("details[open]")) return;
      if (panel?.contains(document.activeElement) && document.activeElement?.matches("input, select")) return;
      hide();
    }, 1200);
  };
  const closeSidebar = () => {
    if (pinned()) return;
    hide();
    trigger?.focus({ preventScroll: true });
  };
  const marketsBySymbol = createMemo(() => new Map(MARKETS().filter(market => market.type !== "spot").map(market => [market.symbol, market])));
  const options = createMemo(() => [...new Set([...marketsBySymbol().keys(), ...chartLayout().symbols])].sort());
  const symbols = createMemo(() => chartLayout().symbols.slice(0, chartLayout().count));
  const chartCount = createMemo(() => chartLayout().count);
  const resolution = createMemo(() => chartLayout().resolution);
  const removePane = (index: number) => {
    removeChart(index);
    const next = Math.min(index, chartLayout().count - 1);
    queueMicrotask(() => layoutMenu?.querySelector<HTMLSelectElement>(`[aria-label="Chart ${next + 1} symbol"]`)?.focus({ preventScroll: true }));
  };

  useLivePrices({ enabled: visible });
  onMount(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const resize = () => setDesktop(media.matches);
    const visibility = () => setVisible(!document.hidden);
    media.addEventListener("change", resize);
    document.addEventListener("visibilitychange", visibility);
    onCleanup(() => { media.removeEventListener("change", resize); document.removeEventListener("visibilitychange", visibility); });
  });
  createEffect(() => { chartCount(); clearHide(); setWatchlistOpen(false); });
  onCleanup(clearHide);

  return <div class="charts-workspace" classList={{ "watchlist-pinned": pinned() }} data-chart-count={chartLayout().count}>
    <div class="charts-stage">
      <div class="charts-controls">
        <button ref={trigger} class="charts-control charts-watchlist-toggle" aria-label={sidebarVisible() ? "Hide watchlist" : "Show watchlist"} title="Watchlist"
          aria-expanded={sidebarVisible()} aria-controls="charts-watchlist" onClick={() => sidebarVisible() ? hide() : reveal()}>
          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16M18 8h.01M18 12h.01M18 16h.01" /></svg>
        </button>
        <button class="charts-control" aria-label="Chart layout" aria-expanded={menuOpen()} onClick={() => setMenuOpen(!menuOpen())}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
          <span>Charts</span><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg>
        </button>
        <Show when={menuOpen()}>
          <div class="charts-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div ref={layoutMenu} class="charts-layout-menu" onKeyDown={event => { if (event.key === "Escape") setMenuOpen(false); }}>
            <label><span>Charts</span><select aria-label="Number of charts" value={chartLayout().count} onChange={event => setChartCount(Number(event.currentTarget.value) as ChartCount)}>
              <For each={CHART_COUNTS}>{count => <option value={count}>{count}</option>}</For>
            </select></label>
            <div class="charts-layout-items">
              <Index each={symbols()}>{(symbol, index) => <div class="charts-layout-item">
                <label><span>Chart {index + 1}</span><select aria-label={`Chart ${index + 1} symbol`} value={symbol()}
                  onChange={event => setChartSymbol(event.currentTarget.value, index)}>
                  <For each={options()}>{option => <option value={option}>{getUrlSymbol(option)}</option>}</For>
                </select></label>
                <button class="charts-remove" aria-label={`Remove chart ${index + 1}`} disabled={chartLayout().count === 1}
                  title={chartLayout().count === 1 ? "Keep at least one chart" : `Remove chart ${index + 1}`} onClick={() => removePane(index)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" /></svg>
                </button>
              </div>}</Index>
            </div>
            <Show when={chartLayout().count < 6}>
              <button class="charts-add" onClick={() => {
                const nextIndex = chartLayout().count;
                setChartCount((nextIndex + 1) as ChartCount);
                setChartLayout(state => ({ ...state, activeIndex: nextIndex }));
              }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg><span>Add chart</span></button>
            </Show>
          </div>
        </Show>
      </div>
      <div class="charts-grid" data-count={chartLayout().count}>
        <Index each={symbols()}>{(symbol, index) => {
          const market = () => marketsBySymbol().get(symbol());
          // Price ticks change the market object, but must not restart candles.
          const marketType = createMemo(() => market()?.type ?? "perps");
          const change = () => market()?.change24h;
          const active = () => chartLayout().activeIndex === index;
          const activate = () => setChartLayout(state => state.activeIndex === index ? state : { ...state, activeIndex: index });
          return <div class="charts-pane" classList={{ "is-active": active() && chartLayout().count > 1 }} data-chart-index={index}
            onPointerDown={activate} onFocusIn={activate}>
            <div class="charts-pane-heading">
              <button class="charts-symbol-label" aria-label={`Select chart ${index + 1}: ${getUrlSymbol(symbol())}`} aria-pressed={active()} onClick={activate}>
                <MarketAvatar symbol={symbol()} size={20} />
                <span>{getUrlSymbol(symbol())}</span>
                <Show when={Number.isFinite(change())}><span classList={{ up: (change() ?? 0) >= 0, down: (change() ?? 0) < 0 }}>{(change() ?? 0) >= 0 ? "+" : ""}{change()?.toFixed(2)}%</span></Show>
              </button>
              <Show when={index === 0}>
                <ChartControls resolution={resolution()} onResolutionChange={resolution => setChartLayout(state => ({ ...state, resolution }))} />
              </Show>
            </div>
            <SymbolChart symbol={symbol()} resolution={resolution()} marketType={marketType()} />
          </div>;
        }}</Index>
      </div>
    </div>
    <Show when={!pinned()}>
      <button ref={edge} class="charts-watchlist-edge" aria-label="Reveal watchlist" aria-controls="charts-watchlist" aria-expanded={sidebarVisible()}
        onPointerEnter={reveal} onPointerLeave={hideLater} onFocus={reveal} onBlur={hideLater} onClick={reveal} data-testid="charts-watchlist-edge">
        <span />
      </button>
    </Show>
    <aside ref={panel} id="charts-watchlist" class="charts-watchlist" data-visible={sidebarVisible()} aria-hidden={!sidebarVisible()} inert={!sidebarVisible()}
      onPointerEnter={clearHide} onPointerLeave={hideLater} onFocusIn={clearHide} onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideLater(); }}
      onKeyDown={event => { if (event.key === "Escape" && !pinned()) { event.stopPropagation(); closeSidebar(); } }}>
      <WatchlistPanel onSelectMarket={market => setChartSymbol(market.symbol)} selectedSymbol={chartLayout().symbols[chartLayout().activeIndex]} onClose={pinned() ? undefined : closeSidebar} />
    </aside>
  </div>;
};
export default ChartsGrid;
