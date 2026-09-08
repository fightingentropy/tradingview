import { Component, For, Show, createMemo } from "solid-js";
import { formatPrice } from "../lib/hyperliquid";
import {
  hyperliquidActivityRefreshError,
  hyperliquidActivityRefreshPending,
  hyperliquidFundingPayments,
  hyperliquidHistoricalOrders,
  hyperliquidTwapOrders,
  isHyperliquidExecution,
} from "../stores/hyperliquidExecution";
import {
  type AccountSideFilter,
  annualizeHourlyFundingRate,
  downloadAccountCsv,
  formatAnnualizedFundingRate,
  formatAccountMarket,
  formatAccountSize,
  formatAccountStatus,
  formatAccountTime,
  formatAccountUsd,
} from "./accountDock";

type ActivityTableProps = {
  compact?: boolean;
  sideFilter?: AccountSideFilter;
  marketFilter?: string;
};

const tableLayout = (compact?: boolean) => ({
  header: compact ? "px-3 py-2" : "px-3 py-2.5",
  cell: compact ? "px-3 py-1.5" : "px-3 py-2",
  text: compact ? "text-xs" : "text-sm",
});

const sideMatches = (
  selected: AccountSideFilter | undefined,
  side: "buy" | "sell" | "long" | "short",
) => !selected || selected === "all" || selected === side;

const marketMatches = (selected: string | undefined, symbol: string) =>
  !selected ||
  selected === "all" ||
  selected === formatAccountMarket(symbol);

const emptyMessage = (label: string) => {
  if (!isHyperliquidExecution()) return `No ${label.toLowerCase()} yet`;
  if (hyperliquidActivityRefreshPending()) return `Loading ${label.toLowerCase()}…`;
  return hyperliquidActivityRefreshError() ?? `No ${label.toLowerCase()}`;
};

const ActivityNotice: Component = () => (
  <Show when={hyperliquidActivityRefreshError()}>
    {(message) => (
      <div class="border-t border-brand-border px-3 py-2 text-xs text-brand-red-400">
        {message()}
      </div>
    )}
  </Show>
);

const TableEmptyRow: Component<{
  columns: number;
  label: string;
  cellClass: string;
  textClass: string;
}> = (props) => (
  <tr>
    <td
      class={`${props.cellClass} ${props.textClass} text-brand-slate-400`}
      colSpan={props.columns}
    >
      {emptyMessage(props.label)}
    </td>
  </tr>
);

const TwapTable: Component<ActivityTableProps> = (props) => {
  const layout = tableLayout(props.compact);
  const columns = [
    "Market",
    "Size",
    "Executed Size",
    "Average Price",
    "Running Time / Total",
    "Trigger Price",
    "Max/Min Price",
    "Reduce Only",
    "Creation Time",
    "Terminate",
  ];
  const rows = createMemo(() =>
    hyperliquidTwapOrders().filter(
      (order) =>
        sideMatches(props.sideFilter, order.side) &&
        marketMatches(props.marketFilter, order.symbol),
    ),
  );

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[1260px]">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(column) => (
                <th
                  class={`${layout.header} whitespace-nowrap text-left text-xs font-medium text-brand-slate-400`}
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
              <TableEmptyRow
                columns={columns.length}
                label="TWAP orders"
                cellClass={layout.cell}
                textClass={layout.text}
              />
            }
          >
            <For each={rows()}>
              {(order) => {
                const elapsedMinutes = Math.max(
                  0,
                  Math.min(
                    order.totalMinutes,
                    Math.floor((Date.now() - order.createdAt) / 60_000),
                  ),
                );
                const market = formatAccountMarket(order.symbol);
                return (
                  <tr class="border-b border-brand-border/40">
                    <td class={`${layout.cell} ${layout.text}`}>
                      <span
                        class={`font-semibold ${order.side === "buy" ? "text-brand-green-400" : "text-brand-red-400"}`}
                      >
                        {market}
                      </span>
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {formatAccountSize(order.size)} {market}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {formatAccountSize(order.executedSize)} {market}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {order.averagePrice === undefined
                        ? "--"
                        : formatPrice(order.averagePrice)}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {elapsedMinutes}m / {order.totalMinutes}m
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {order.triggerPrice === undefined
                        ? "--"
                        : formatPrice(order.triggerPrice)}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {order.stopPrice === undefined
                        ? "--"
                        : formatPrice(order.stopPrice)}
                    </td>
                    <td class={`${layout.cell} ${layout.text}`}>
                      {order.reduceOnly ? "Yes" : "No"}
                    </td>
                    <td
                      class={`${layout.cell} ${layout.text} whitespace-nowrap font-mono text-brand-slate-400`}
                    >
                      {formatAccountTime(order.createdAt)}
                    </td>
                    <td class={`${layout.cell} ${layout.text} text-brand-slate-500`}>
                      --
                    </td>
                  </tr>
                );
              }}
            </For>
          </Show>
        </tbody>
      </table>
      <Show when={rows().length > 0}>
        <ActivityNotice />
      </Show>
    </div>
  );
};

const ChaseTable: Component<ActivityTableProps> = (props) => {
  const layout = tableLayout(props.compact);
  const columns = [
    "Market",
    "Size",
    "Executed Size",
    "Average Price",
    "Max Distance",
    "% Completed",
    "Reduce Only",
    "Creation Time",
    "Terminate",
  ];
  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[1040px]">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(column) => (
                <th
                  class={`${layout.header} whitespace-nowrap text-left text-xs font-medium text-brand-slate-400`}
                >
                  {column}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <TableEmptyRow
            columns={columns.length}
            label="Chase orders"
            cellClass={layout.cell}
            textClass={layout.text}
          />
        </tbody>
      </table>
    </div>
  );
};

const FundingHistoryTable: Component<ActivityTableProps> = (props) => {
  const layout = tableLayout(props.compact);
  const columns = [
    "Time",
    "Market",
    "Size",
    "Side",
    "Payment",
    "Rate (Annualized)",
  ];
  const rows = createMemo(() =>
    hyperliquidFundingPayments().filter(
      (payment) =>
        sideMatches(props.sideFilter, payment.side) &&
        marketMatches(props.marketFilter, payment.symbol),
    ),
  );
  const exportCsv = () =>
    downloadAccountCsv(
      `trade-xyz-funding-${new Date().toISOString().slice(0, 10)}.csv`,
      columns,
      rows().map((payment) => [
        formatAccountTime(payment.time),
        formatAccountMarket(payment.symbol),
        payment.size,
        payment.side,
        payment.payment,
        annualizeHourlyFundingRate(payment.rate) * 100,
      ]),
    );

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[820px]">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(column) => (
                <th
                  class={`${layout.header} whitespace-nowrap text-left text-xs font-medium text-brand-slate-400`}
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
              <TableEmptyRow
                columns={columns.length}
                label="Funding history"
                cellClass={layout.cell}
                textClass={layout.text}
              />
            }
          >
            <For each={rows()}>
              {(payment) => {
                const market = formatAccountMarket(payment.symbol);
                return (
                  <tr class="border-b border-brand-border/40">
                    <td
                      class={`${layout.cell} ${layout.text} whitespace-nowrap font-mono text-brand-slate-400`}
                    >
                      {formatAccountTime(payment.time)}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-semibold`}>
                      {market}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {formatAccountSize(payment.size)} {market}
                    </td>
                    <td
                      class={`${layout.cell} ${layout.text} font-semibold ${payment.side === "long" ? "text-brand-green-400" : "text-brand-red-400"}`}
                    >
                      {payment.side === "long" ? "Long" : "Short"}
                    </td>
                    <td
                      class={`${layout.cell} ${layout.text} font-mono ${payment.payment >= 0 ? "text-brand-green-400" : "text-brand-red-400"}`}
                    >
                      {formatAccountUsd(payment.payment, true)}
                    </td>
                    <td
                      class={`${layout.cell} ${layout.text} font-mono`}
                      title={`Hourly rate ${(payment.rate * 100).toFixed(6)}%`}
                    >
                      {formatAnnualizedFundingRate(payment.rate)}
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
      <Show when={rows().length > 0}>
        <ActivityNotice />
      </Show>
    </div>
  );
};

const OrderHistoryTable: Component<ActivityTableProps> = (props) => {
  const layout = tableLayout(props.compact);
  const columns = [
    "Time",
    "Type",
    "Market",
    "Direction",
    "Size",
    "Filled Size",
    "Order Value",
    "Price",
    "Reduce Only",
    "Trigger Conditions",
    "TP/SL",
    "Status",
    "Order ID",
  ];
  const rows = createMemo(() =>
    hyperliquidHistoricalOrders().filter(
      (order) =>
        sideMatches(props.sideFilter, order.side) &&
        marketMatches(props.marketFilter, order.symbol),
    ),
  );

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[1540px]">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(column) => (
                <th
                  class={`${layout.header} whitespace-nowrap text-left text-xs font-medium text-brand-slate-400`}
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
              <TableEmptyRow
                columns={columns.length}
                label="Order history"
                cellClass={layout.cell}
                textClass={layout.text}
              />
            }
          >
            <For each={rows()}>
              {(order) => {
                const market = formatAccountMarket(order.symbol);
                return (
                  <tr class="border-b border-brand-border/40">
                    <td
                      class={`${layout.cell} ${layout.text} whitespace-nowrap font-mono text-brand-slate-400`}
                    >
                      {formatAccountTime(order.time)}
                    </td>
                    <td class={`${layout.cell} ${layout.text}`}>
                      {order.type}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-semibold`}>
                      {market}
                    </td>
                    <td
                      class={`${layout.cell} ${layout.text} font-semibold ${order.side === "buy" ? "text-brand-green-400" : "text-brand-red-400"}`}
                    >
                      {order.side === "buy" ? "Buy" : "Sell"}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {formatAccountSize(order.size)} {market}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {formatAccountSize(order.filledSize)} {market}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {formatAccountUsd(order.orderValue)}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {order.price > 0 ? formatPrice(order.price) : "--"}
                    </td>
                    <td class={`${layout.cell} ${layout.text}`}>
                      {order.reduceOnly ? "Yes" : "No"}
                    </td>
                    <td class={`${layout.cell} ${layout.text} font-mono`}>
                      {order.triggerCondition}
                    </td>
                    <td class={`${layout.cell} ${layout.text}`}>
                      {order.tpsl}
                    </td>
                    <td class={`${layout.cell} ${layout.text}`}>
                      {formatAccountStatus(order.status)}
                    </td>
                    <td
                      class={`${layout.cell} ${layout.text} font-mono text-brand-slate-400`}
                    >
                      {order.orderId}
                    </td>
                  </tr>
                );
              }}
            </For>
          </Show>
        </tbody>
      </table>
      <Show when={rows().length > 0}>
        <ActivityNotice />
      </Show>
    </div>
  );
};

export { ChaseTable, FundingHistoryTable, OrderHistoryTable, TwapTable };
