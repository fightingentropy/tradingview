import { Component, For, Show, createMemo } from "solid-js";
import { formatPrice } from "../lib/hyperliquid";
import {
  hyperliquidActivityRefreshError,
  hyperliquidActivityRefreshPending,
  hyperliquidTradeFills,
  isHyperliquidExecution,
} from "../stores/hyperliquidExecution";
import { tradeHistory } from "../stores/portfolio";
import {
  type AccountSideFilter,
  downloadAccountCsv,
  formatAccountMarket,
  formatAccountSize,
  formatAccountTime,
  formatAccountUsd,
} from "./accountDock";

const columns = [
  "Time",
  "Market",
  "Direction",
  "Price",
  "Size",
  "Trade Value",
  "Fee",
  "Closed PNL",
];

type TradeRow = {
  time: number;
  symbol: string;
  direction: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  tradeValue: number;
  fee: number;
  feeToken: string;
  closedPnl: number;
};

const TradeHistoryTable: Component<{
  compact?: boolean;
  sideFilter?: AccountSideFilter;
  marketFilter?: string;
}> = (props) => {
  const rowPadding = props.compact ? "py-1.5" : "py-2";
  const headerPadding = props.compact ? "py-2" : "py-2.5";
  const textSize = props.compact ? "text-xs" : "text-sm";
  const rows = createMemo<TradeRow[]>(() => {
    const source = isHyperliquidExecution()
      ? hyperliquidTradeFills()
      : tradeHistory().map((trade) => ({
          time: trade.createdAt,
          symbol: trade.symbol,
          direction: trade.side === "buy" ? "Buy" : "Sell",
          side: trade.side,
          price: trade.price,
          size: trade.size,
          tradeValue: trade.notional,
          fee: trade.fee,
          feeToken: "USDC",
          closedPnl: trade.pnl,
        }));
    return source.filter((trade) => {
      const sideMatches =
        !props.sideFilter ||
        props.sideFilter === "all" ||
        props.sideFilter === trade.side;
      const marketMatches =
        !props.marketFilter ||
        props.marketFilter === "all" ||
        props.marketFilter === formatAccountMarket(trade.symbol);
      return sideMatches && marketMatches;
    });
  });
  const emptyText = () => {
    if (
      isHyperliquidExecution() &&
      hyperliquidActivityRefreshPending() &&
      hyperliquidTradeFills().length === 0
    ) {
      return "Loading trade history…";
    }
    if (
      isHyperliquidExecution() &&
      hyperliquidActivityRefreshError() &&
      hyperliquidTradeFills().length === 0
    ) {
      return hyperliquidActivityRefreshError();
    }
    return "No trade history";
  };
  const exportCsv = () =>
    downloadAccountCsv(
      `trade-xyz-trades-${new Date().toISOString().slice(0, 10)}.csv`,
      columns,
      rows().map((trade) => [
        formatAccountTime(trade.time),
        formatAccountMarket(trade.symbol),
        trade.direction,
        trade.price,
        trade.size,
        trade.tradeValue,
        `${trade.fee} ${trade.feeToken}`,
        trade.closedPnl,
      ]),
    );

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[1080px]">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(column) => (
                <th
                  class={`px-3 ${headerPadding} whitespace-nowrap text-left text-xs font-medium text-brand-slate-400`}
                >
                  {column}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={rows().length > 0}
            fallback={
              <tr>
                <td
                  class={`px-3 ${rowPadding} ${textSize} text-brand-slate-400`}
                  colSpan={columns.length}
                >
                  {emptyText()}
                </td>
              </tr>
            }
          >
            <For each={rows()}>
              {(trade) => {
                const market = formatAccountMarket(trade.symbol);
                return (
                  <tr class="border-b border-brand-border/40">
                    <td
                      class={`px-3 ${rowPadding} ${textSize} whitespace-nowrap font-mono text-brand-slate-400`}
                    >
                      {formatAccountTime(trade.time)}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize}`}>
                      <span class="font-semibold">{market}</span>
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize}`}>
                      <span
                        class={`font-semibold ${trade.side === "buy" ? "text-brand-green-400" : "text-brand-red-400"}`}
                      >
                        {trade.direction}
                      </span>
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize} font-mono`}>
                      {formatPrice(trade.price)}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize} font-mono`}>
                      {formatAccountSize(trade.size)} {market}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize} font-mono`}>
                      {formatAccountUsd(trade.tradeValue)}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize} font-mono`}>
                      {formatAccountUsd(trade.fee)} {trade.feeToken}
                    </td>
                    <td
                      class={`px-3 ${rowPadding} ${textSize} font-mono ${trade.closedPnl >= 0 ? "text-brand-green-400" : "text-brand-red-400"}`}
                    >
                      {formatAccountUsd(trade.closedPnl, true)}
                    </td>
                  </tr>
                );
              }}
            </For>
          </Show>
        </tbody>
      </table>
      <div class="flex justify-end border-t border-brand-border px-3 py-2">
        <button
          type="button"
          class="text-xs font-medium text-brand-slate-300 hover:text-slate-100 disabled:opacity-50"
          disabled={rows().length === 0}
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>
      <Show
        when={
          isHyperliquidExecution() &&
          rows().length > 0 &&
          hyperliquidActivityRefreshError()
        }
      >
        <div class="border-t border-brand-border px-3 py-2 text-xs text-brand-red-400">
          {hyperliquidActivityRefreshError()}
        </div>
      </Show>
    </div>
  );
};

export default TradeHistoryTable;
