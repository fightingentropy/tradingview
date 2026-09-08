import { Component, For, Show, createMemo, createSignal } from "solid-js";
import { formatPrice } from "../lib/hyperliquid";
import {
  type Order,
  cancelOrder,
  fillOpenOrder,
  openOrders,
} from "../stores/clob";
import {
  type AccountSideFilter,
  formatAccountMarket,
  formatAccountSize,
  formatAccountTime,
  formatAccountUsd,
} from "./accountDock";

const columns = [
  "Time",
  "Type",
  "Market",
  "Direction",
  "Size",
  "Original Size",
  "Order Value",
  "Price",
  "Reduce Only",
  "Trigger Conditions",
  "TP/SL",
  "Cancel All",
];

const OpenOrdersTable: Component<{
  compact?: boolean;
  sideFilter?: AccountSideFilter;
  marketFilter?: string;
}> = (props) => {
  const rowPadding = props.compact ? "py-1.5" : "py-2";
  const headerPadding = props.compact ? "py-2" : "py-2.5";
  const textSize = props.compact ? "text-xs" : "text-sm";
  const [cancelingOrderId, setCancelingOrderId] = createSignal<string | null>(
    null,
  );
  const [cancelError, setCancelError] = createSignal<{
    orderId: string;
    message: string;
  } | null>(null);
  const activeOrders = createMemo(() =>
    openOrders().filter((order) => {
      if (order.status !== "open") return false;
      const sideMatches =
        !props.sideFilter ||
        props.sideFilter === "all" ||
        props.sideFilter === order.side;
      const marketMatches =
        !props.marketFilter ||
        props.marketFilter === "all" ||
        props.marketFilter === formatAccountMarket(order.symbol);
      return sideMatches && marketMatches;
    }),
  );

  const handleCancelOrder = async (order: Order) => {
    if (order.source !== "hyperliquid") {
      void cancelOrder(order._id);
      return;
    }
    if (cancelingOrderId() !== null) return;

    const orderId = String(order._id);
    setCancelingOrderId(orderId);
    setCancelError(null);
    try {
      const result = await cancelOrder(order._id);
      if (!result.ok) {
        setCancelError({ orderId, message: result.error });
      }
    } catch (error) {
      setCancelError({
        orderId,
        message:
          error instanceof Error ? error.message : "Failed to cancel order.",
      });
    } finally {
      setCancelingOrderId(null);
    }
  };

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[1500px]">
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
            when={activeOrders().length > 0}
            fallback={
              <tr>
                <td
                  class={`px-3 ${rowPadding} ${textSize} text-brand-slate-400`}
                  colSpan={columns.length}
                >
                  No open orders
                </td>
              </tr>
            }
          >
            <For each={activeOrders()}>
              {(order) => {
                const isLive = order.source === "hyperliquid";
                const market = formatAccountMarket(order.symbol);
                const remainingSize = Math.max(0, order.size - order.filledSize);
                const price = order.price ?? 0;
                const typeLabel = isLive
                  ? order.orderTypeLabel
                  : order.type === "limit"
                    ? "Limit"
                    : "Market";
                return (
                  <tr class="border-b border-brand-border/40">
                    <td
                      class={`px-3 ${rowPadding} ${textSize} whitespace-nowrap font-mono text-brand-slate-400`}
                    >
                      {formatAccountTime(order.createdAt)}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize}`}>
                      {typeLabel}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize}`}>
                      <span class="font-semibold">{market}</span>
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize}`}>
                      <span
                        class={`font-semibold ${order.side === "buy" ? "text-brand-green-400" : "text-brand-red-400"}`}
                      >
                        {order.side === "buy" ? "Buy" : "Sell"}
                      </span>
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize} font-mono`}>
                      {formatAccountSize(remainingSize)} {market}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize} font-mono`}>
                      {formatAccountSize(order.size)} {market}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize} font-mono`}>
                      {price > 0 ? formatAccountUsd(order.size * price) : "--"}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize} font-mono`}>
                      {price > 0 ? formatPrice(price) : "--"}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize}`}>
                      {isLive && order.reduceOnly ? "Yes" : "No"}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize} font-mono`}>
                      {isLive && order.isTrigger && order.triggerPrice
                        ? `@ ${formatPrice(order.triggerPrice)}`
                        : "--"}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize}`}>
                      {isLive && order.isPositionTpsl ? typeLabel : "--"}
                    </td>
                    <td class={`px-3 ${rowPadding} ${textSize}`}>
                      <div class="max-w-64 space-y-1">
                        <div class="flex items-center gap-3">
                          <Show when={!isLive}>
                            <button
                              class="text-brand-accent hover:underline"
                              onClick={() => void fillOpenOrder(order._id)}
                            >
                              Fill
                            </button>
                          </Show>
                          <button
                            class="text-brand-red-400 hover:underline disabled:cursor-wait disabled:opacity-60"
                            disabled={isLive && cancelingOrderId() !== null}
                            aria-busy={
                              isLive &&
                              cancelingOrderId() === String(order._id)
                                ? "true"
                                : undefined
                            }
                            onClick={() => void handleCancelOrder(order)}
                          >
                            {isLive &&
                            cancelingOrderId() === String(order._id)
                              ? "Canceling…"
                              : "Cancel"}
                          </button>
                        </div>
                        <Show
                          when={
                            isLive &&
                            cancelError()?.orderId === String(order._id)
                              ? cancelError()?.message
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

export default OpenOrdersTable;
