import { Component, For, Show, createMemo, createSignal } from "solid-js";
import { formatPrice } from "../lib/hyperliquid";
import {
  Collateral,
  Position,
  closePosition,
  getTotalMarginUsed,
  getTotalPerpsBalance,
  getTotalUnrealizedPnl,
  getWeightedSpotEquity,
  getBalance,
  getEffectivePositionSize,
  getMarkPriceForSymbol,
  isPortfolioMarginEnabled,
  positions,
  updatePositionTpsl,
} from "../stores/clob";
import { setCurrentSymbol } from "../stores/market";
import { setCurrentPage } from "../stores/page";
import {
  type AccountSideFilter,
  formatAccountMarket,
} from "./accountDock";

const columns = [
  "Market",
  "Size",
  "Position Value",
  "Entry Price",
  "Mark Price",
  "PNL (ROE %)",
  "Liq. Price",
  "Margin",
  "Funding",
  "Close",
  "TP/SL",
];

const formatTpslValue = (value?: number | null) => {
  if (!Number.isFinite(value ?? NaN) || (value ?? 0) <= 0) return "--";
  return formatPrice(value);
};

const formatTpslInput = (value?: number | null) =>
  Number.isFinite(value ?? NaN) && (value ?? 0) > 0 ? String(value) : "";

const formatSize = (size: number) => {
  const abs = Math.abs(size);
  if (abs >= 100) return abs.toFixed(2);
  if (abs >= 1) return abs.toFixed(3);
  return abs.toFixed(4);
};

const formatUsd = (value: number) =>
  `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatSignedUsd = (value: number) => {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatUsd(Math.abs(value))}`;
};

const formatPositionSymbol = (symbol: string) => {
  if (!symbol) return "";
  const trimmed = symbol.trim();
  return trimmed.toLowerCase().startsWith("xyz:")
    ? trimmed.slice(trimmed.indexOf(":") + 1)
    : trimmed;
};

const PositionsTable: Component<{
  compact?: boolean;
  sideFilter?: AccountSideFilter;
  marketFilter?: string;
}> = (props) => {
  const cellPadding = props.compact ? "px-3 py-1.5" : "px-3 py-2";
  const headerPadding = props.compact ? "px-3 py-2" : "px-3 py-2.5";
  const textSize = props.compact ? "text-xs" : "text-sm";
  const [editingSymbol, setEditingSymbol] = createSignal<string | null>(null);
  const [tpInput, setTpInput] = createSignal("");
  const [slInput, setSlInput] = createSignal("");
  const [tpslError, setTpslError] = createSignal("");
  const [tpslSaving, setTpslSaving] = createSignal(false);
  const [closingSymbol, setClosingSymbol] = createSignal<string | null>(null);
  const [closeError, setCloseError] = createSignal<{
    symbol: string;
    message: string;
  } | null>(null);
  const filteredPositions = createMemo(() =>
    positions().filter((position) => {
      const side = position.size >= 0 ? "long" : "short";
      const sideMatches =
        !props.sideFilter ||
        props.sideFilter === "all" ||
        props.sideFilter === side;
      const marketMatches =
        !props.marketFilter ||
        props.marketFilter === "all" ||
        props.marketFilter === formatAccountMarket(position.symbol);
      return sideMatches && marketMatches;
    }),
  );
  const unrealizedByCollateral = createMemo(() => {
    const totals: Record<Collateral, number> = { USDC: 0, USDT: 0 };
    for (const position of positions()) {
      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      totals[position.collateral] +=
        (mark - position.entryPrice) * position.size;
    }
    return totals;
  });
  const marginUsedByCollateral = createMemo(() => {
    const totals: Record<Collateral, number> = { USDC: 0, USDT: 0 };
    for (const position of positions()) {
      if (position.leverage <= 0) continue;
      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      totals[position.collateral] +=
        (Math.abs(position.size) * mark) / position.leverage;
    }
    return totals;
  });
  const totalUnrealized = createMemo(() => getTotalUnrealizedPnl());
  const totalMarginUsed = createMemo(() => getTotalMarginUsed());
  const totalPerpsBalance = createMemo(() => getTotalPerpsBalance());
  const weightedSpotEquity = createMemo(() => getWeightedSpotEquity());
  const goToTrade = (symbol: string) => {
    setCurrentSymbol(symbol);
    setCurrentPage("trade");
  };

  const handleClosePosition = async (position: Position) => {
    if (position.source !== "hyperliquid") {
      void closePosition(position.symbol);
      return;
    }
    if (closingSymbol() !== null) return;

    const symbol = position.symbol;
    setClosingSymbol(symbol);
    setCloseError(null);
    try {
      const result = await closePosition(symbol);
      if (!result.ok) {
        setCloseError({ symbol, message: result.error });
      }
    } catch (error) {
      setCloseError({
        symbol,
        message:
          error instanceof Error ? error.message : "Failed to close position.",
      });
    } finally {
      setClosingSymbol(null);
    }
  };

  const openTpslEditor = (position: Position) => {
    setEditingSymbol(position.symbol);
    setTpInput(formatTpslInput(position.takeProfit));
    setSlInput(formatTpslInput(position.stopLoss));
    setTpslError("");
  };

  const closeTpslEditor = () => {
    setEditingSymbol(null);
    setTpInput("");
    setSlInput("");
    setTpslError("");
  };

  const parsePriceInput = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
  };

  const saveTpsl = async () => {
    const symbol = editingSymbol();
    if (!symbol || tpslSaving()) return;
    const tpValue = parsePriceInput(tpInput());
    const slValue = parsePriceInput(slInput());

    if (tpValue !== null && Number.isNaN(tpValue)) {
      setTpslError("Enter a valid take profit price.");
      return;
    }
    if (slValue !== null && Number.isNaN(slValue)) {
      setTpslError("Enter a valid stop loss price.");
      return;
    }

    setTpslSaving(true);
    const result = await updatePositionTpsl({
      symbol,
      takeProfit: tpValue,
      stopLoss: slValue,
    });
    setTpslSaving(false);

    if (!result.ok) {
      setTpslError(result.error ?? "Failed to update TP/SL.");
      return;
    }
    closeTpslEditor();
  };

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-300">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(col) => (
                <th
                  class={`${headerPadding} text-xs font-medium text-brand-slate-400 text-left`}
                >
                  {col}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={filteredPositions().length > 0}
            fallback={
              <tr>
                <td
                  class={`${cellPadding} text-brand-slate-400 ${textSize}`}
                  colSpan={columns.length}
                >
                  No open positions
                </td>
              </tr>
            }
          >
            <For each={filteredPositions()}>
              {(position) => {
                const isLive = position.source === "hyperliquid";
                const mark = () => {
                  if (isLive) return position.markPriceLive;
                  return getMarkPriceForSymbol(position.symbol);
                };
                const hasValidPrice = () => {
                  const m = mark();
                  return Number.isFinite(m) && m > 0;
                };
                const positionValue = () => Math.abs(position.size) * mark();

                const isShort = position.size < 0;
                const effectiveAbsSize = () =>
                  getEffectivePositionSize(position);

                // Margin calculation: notional / leverage
                const margin = () => {
                  if (isLive) return position.marginUsedLive;
                  if (position.leverage <= 0) return 0;
                  return (effectiveAbsSize() * mark()) / position.leverage;
                };

                const pnl = () =>
                  isLive
                    ? position.unrealizedPnlLive
                    : (mark() - position.entryPrice) * position.size;
                const roe = () =>
                  isLive
                    ? position.returnOnEquityLive
                    : margin() > 0
                      ? (pnl() / margin()) * 100
                      : 0;
                const marginType = position.marginType ?? "cross";
                const marginLabel =
                  marginType === "cross" ? "Cross" : "Isolated";
                const collateralUnrealized = () =>
                  unrealizedByCollateral()[position.collateral] ?? 0;
                const currentUnrealized = () => {
                  const m = mark();
                  return Number.isFinite(m) && m > 0
                    ? (m - position.entryPrice) * position.size
                    : 0;
                };
                const marginUsedExcludingCurrent = () => {
                  const total = isPortfolioMarginEnabled()
                    ? totalMarginUsed()
                    : (marginUsedByCollateral()[position.collateral] ?? 0);
                  const currentMargin = margin();
                  if (
                    !Number.isFinite(total) ||
                    !Number.isFinite(currentMargin)
                  ) {
                    return 0;
                  }
                  return Math.max(0, total - currentMargin);
                };
                const collateralPool = () => {
                  if (isPortfolioMarginEnabled()) {
                    return (
                      totalPerpsBalance() +
                      weightedSpotEquity() +
                      totalUnrealized()
                    );
                  }
                  return (
                    getBalance(position.collateral) + collateralUnrealized()
                  );
                };
                const baseEquity = () => collateralPool() - currentUnrealized();

                // Liquidation price calculation for cross/isolated margin
                const liqPrice = () => {
                  if (isLive) return position.liquidationPrice ?? NaN;
                  if (marginType === "cross") {
                    // Cross margin: use account equity for the position
                    const equity = baseEquity() - marginUsedExcludingCurrent();
                    const denom = effectiveAbsSize();
                    if (!Number.isFinite(equity) || denom === 0) return NaN;
                    // For shorts, liq price is entry + equity/size (price going up)
                    // For longs, liq price is entry - equity/size (price going down)
                    if (isShort) {
                      return position.entryPrice + equity / denom;
                    }
                    return position.entryPrice - equity / denom;
                  } else {
                    // Isolated margin: use leverage factor for the position
                    const liqFactor =
                      position.leverage > 0 ? 1 / position.leverage : 0;
                    if (isShort) {
                      // For shorts, liquidation happens when price goes up
                      return position.entryPrice * (1 + liqFactor);
                    }
                    // For longs, liquidation happens when price goes down
                    return position.entryPrice * (1 - liqFactor);
                  }
                };

                const isLong = position.size >= 0;

                // Funding display - show cumulative funding collected or paid
                const fundingDisplay = () => {
                  // Show cumulative funding (calculated hourly based on funding rates)
                  // Funding is calculated every hour based on the funding rate at that time
                  // For longs: positive funding rate means paying funding (negative), negative means receiving (positive)
                  // For shorts: opposite - positive funding rate means receiving funding (positive), negative means paying (negative)
                  const cumulativeFunding = position.cumulativeFunding ?? 0;

                  // Always show the stored cumulative funding value (even if 0)
                  // This is calculated properly in the backend based on hourly funding rates
                  const fundingColor =
                    cumulativeFunding >= 0
                      ? "text-brand-green-400"
                      : "text-brand-red-400";
                  return (
                    <span class={`font-mono ${fundingColor}`}>
                      {formatSignedUsd(cumulativeFunding)}
                    </span>
                  );
                };

                return (
                  <tr
                    class="border-b border-brand-border/40"
                    classList={{ "opacity-50 animate-pulse": !hasValidPrice() }}
                  >
                    <td class={`${cellPadding} ${textSize}`}>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          class={`font-semibold hover:underline ${isLong ? "text-brand-green-400" : "text-brand-red-400"}`}
                          onClick={() => goToTrade(position.symbol)}
                        >
                          {formatPositionSymbol(position.symbol)}
                        </button>
                        <span class="text-xs text-brand-slate-400">
                          {position.leverage}x
                        </span>
                      </div>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span
                        class={`font-mono ${isLong ? "text-brand-green-400" : "text-brand-red-400"}`}
                      >
                        {formatSize(position.size)}{" "}
                        {formatPositionSymbol(position.symbol)}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {hasValidPrice()
                          ? `${formatUsd(positionValue())} ${position.collateral}`
                          : "--"}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {formatPrice(position.entryPrice)}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {hasValidPrice() ? formatPrice(mark()) : "--"}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span
                        class={`font-mono ${hasValidPrice() ? (pnl() >= 0 ? "text-brand-green-400" : "text-brand-red-400") : "text-brand-slate-400"}`}
                      >
                        {hasValidPrice()
                          ? `${formatSignedUsd(pnl())} (${roe().toFixed(2)}%)`
                          : "--"}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {hasValidPrice() &&
                        Number.isFinite(liqPrice()) &&
                        (liqPrice() as number) > 0
                          ? formatPrice(liqPrice() as number)
                          : "--"}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {hasValidPrice()
                          ? `${formatUsd(margin())} (${marginLabel})`
                          : `-- (${marginLabel})`}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      {hasValidPrice() ? (
                        fundingDisplay()
                      ) : (
                        <span class="font-mono text-brand-slate-400">--</span>
                      )}
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <div class="max-w-64 space-y-1">
                        <button
                          class="text-brand-accent hover:underline disabled:cursor-wait disabled:opacity-60"
                          disabled={isLive && closingSymbol() !== null}
                          aria-busy={
                            isLive && closingSymbol() === position.symbol
                              ? "true"
                              : undefined
                          }
                          onClick={() => void handleClosePosition(position)}
                        >
                          {isLive && closingSymbol() === position.symbol
                            ? "Closing…"
                            : "Close"}
                        </button>
                        <Show
                          when={
                            isLive && closeError()?.symbol === position.symbol
                              ? closeError()?.message
                              : null
                          }
                        >
                          {(message) => (
                            <div
                              class="whitespace-normal text-[10px] leading-4 text-brand-red-400"
                              role="alert"
                            >
                              {message()}
                            </div>
                          )}
                        </Show>
                      </div>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <Show
                        when={editingSymbol() === position.symbol}
                        fallback={
                          <button
                            class="flex items-center gap-1 text-brand-slate-300 hover:text-slate-100"
                            onClick={() => openTpslEditor(position)}
                          >
                            <span class="font-mono">
                              {formatTpslValue(position.takeProfit)} /{" "}
                              {formatTpslValue(position.stopLoss)}
                            </span>
                            <svg
                              class="w-3.5 h-3.5 text-brand-slate-400"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
                            </svg>
                          </button>
                        }
                      >
                        <div class="flex items-center gap-2">
                          <div class="flex items-center gap-1 rounded-md border border-brand-border bg-brand-screen px-2 py-1">
                            <input
                              class="w-16 bg-transparent text-right font-mono text-xs text-slate-100 placeholder:text-brand-slate-500 outline-none"
                              value={tpInput()}
                              onInput={(e) => setTpInput(e.currentTarget.value)}
                              placeholder="TP"
                            />
                            <span class="text-brand-slate-500">/</span>
                            <input
                              class="w-16 bg-transparent text-right font-mono text-xs text-slate-100 placeholder:text-brand-slate-500 outline-none"
                              value={slInput()}
                              onInput={(e) => setSlInput(e.currentTarget.value)}
                              placeholder="SL"
                            />
                          </div>
                          <button
                            class="text-xs text-brand-accent hover:underline disabled:opacity-60"
                            disabled={tpslSaving()}
                            onClick={() => void saveTpsl()}
                          >
                            {tpslSaving() ? "Saving" : "Save"}
                          </button>
                          <button
                            class="text-xs text-brand-slate-400 hover:text-slate-200"
                            onClick={closeTpslEditor}
                          >
                            Cancel
                          </button>
                        </div>
                        <Show when={tpslError()}>
                          <div class="mt-1 text-[10px] text-brand-red-400">
                            {tpslError()}
                          </div>
                        </Show>
                      </Show>
                    </td>
                  </tr>
                );
              }}
            </For>
          </Show>
        </tbody>
      </table>
    </div>
  );
};

export default PositionsTable;
