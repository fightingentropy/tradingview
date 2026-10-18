import { Component, For, Show, createMemo } from "solid-js";
import "./AccountTables.css";
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

const numericColumns = new Set([
  "Price",
  "Size",
  "Trade Value",
  "Fee",
  "Closed PNL",
]);

const TradeHistoryTable: Component<{
  compact?: boolean;
  sideFilter?: AccountSideFilter;
  marketFilter?: string;
}> = (props) => {
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
      <table
        class={`account-table min-w-[1080px] ${props.compact ? "is-compact" : ""}`}
      >
        <thead>
          <tr>
            <For each={columns}>
              {(column) => (
                <th class={numericColumns.has(column) ? "num" : undefined}>
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
                <td class="account-empty" colSpan={columns.length}>
                  {emptyText()}
                </td>
              </tr>
            }
          >
            <For each={rows()}>
              {(trade) => {
                const market = formatAccountMarket(trade.symbol);
                return (
                  <tr>
                    <td class="whitespace-nowrap font-mono text-brand-slate-400">
                      {formatAccountTime(trade.time)}
                    </td>
                    <td>
                      <span class="font-semibold">{market}</span>
                    </td>
                    <td>
                      <span
                        class={`font-semibold ${trade.side === "buy" ? "text-brand-green-400" : "text-brand-red-400"}`}
                      >
                        {trade.direction}
                      </span>
                    </td>
                    <td class="num font-mono">
                      {formatPrice(trade.price)}
                    </td>
                    <td class="num font-mono">
                      {formatAccountSize(trade.size)} {market}
                    </td>
                    <td class="num font-mono">
                      {formatAccountUsd(trade.tradeValue)}
                    </td>
                    <td class="num font-mono">
                      {formatAccountUsd(trade.fee)} {trade.feeToken}
                    </td>
                    <td
                      class={`num font-mono ${trade.closedPnl >= 0 ? "text-brand-green-400" : "text-brand-red-400"}`}
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
      <div class="account-table-footer">
        <button
          type="button"
          class="account-link-button"
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
        <div class="account-notice">
          {hyperliquidActivityRefreshError()}
        </div>
      </Show>
    </div>
  );
};

export default TradeHistoryTable;
