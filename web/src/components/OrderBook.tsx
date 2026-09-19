import { Component, For, Show, createMemo } from "solid-js";
import { getOrderBook } from "../stores/clob";
import { currentSymbol, markPrice } from "../stores/market";
import Spinner from "./Spinner";

const MAX_DEPTH = 15;

const OrderBook: Component = () => {
  const book = createMemo(() => getOrderBook(currentSymbol()));
  // Cap rendered depth to the top levels nearest the spread.
  const bids = createMemo(() => book().bids.slice(0, MAX_DEPTH));
  const asks = createMemo(() => book().asks.slice(0, MAX_DEPTH));
  const isEmpty = createMemo(() => bids().length === 0 && asks().length === 0);
  // Render asks high-to-low so the best ask sits closest to the spread.
  const asksForDisplay = createMemo(() => [...asks()].reverse());

  const formatSize = (size: number) => size.toFixed(2);

  // Compute maxTotal incrementally over the (already capped) rendered levels.
  const maxTotal = createMemo(() => {
    let max = 1;
    const askList = asks();
    const bidList = bids();
    for (let i = 0; i < askList.length; i += 1) {
      const total = askList[i].total;
      if (total > max) max = total;
    }
    for (let i = 0; i < bidList.length; i += 1) {
      const total = bidList[i].total;
      if (total > max) max = total;
    }
    return max;
  });

  // Determine decimal places based on price
  const priceDecimals = createMemo(() => {
    const price = bids()[0]?.price || asks()[0]?.price || 0;
    if (price >= 1000) return 2;
    if (price >= 100) return 2;
    if (price >= 1) return 3;
    return 5;
  });

  const spread = createMemo(() => {
    const bestAsk = asks()[0]?.price || 0;
    const bestBid = bids()[0]?.price || 0;
    return bestAsk - bestBid;
  });

  const spreadPercent = createMemo(() => {
    const bestBid = bids()[0]?.price || 0;
    if (bestBid <= 0) return 0;
    return (spread() / bestBid) * 100;
  });

  return (
    <div class="order-book flex flex-col h-full">
      {/* Header */}
      <div class="book-heading flex items-center justify-between px-3 border-b border-brand-border">
        <span class="text-xs font-medium text-slate-200">Order book</span>
      </div>

      {/* Column Headers */}
      <div class="grid grid-cols-3 gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-brand-slate-500">
        <div>Price</div>
        <div class="text-right">Size</div>
        <div class="text-right">Total</div>
      </div>

      <Show
        when={!isEmpty()}
        fallback={
          <div class="flex-1 flex items-center justify-center px-3 text-xs text-brand-slate-500">
            <Spinner label="Loading order book" />
          </div>
        }
      >
        {/* Asks */}
        <div class="flex-1 overflow-hidden flex flex-col justify-end">
          <For each={asksForDisplay()}>
            {(level) => (
              <div class="book-level grid grid-cols-3 gap-2 px-3 text-xs relative">
                <div
                  class="absolute inset-0 bg-brand-red-400/7"
                  style={{
                    width: `${(level.total / maxTotal()) * 100}%`,
                    right: 0,
                    left: "auto",
                  }}
                />
                <div class="text-brand-red-400 font-mono relative z-10">
                  {level.price.toFixed(priceDecimals())}
                </div>
                <div class="text-right text-slate-300 font-mono relative z-10">
                  {formatSize(level.size)}
                </div>
                <div class="text-right text-brand-slate-400 font-mono relative z-10">
                  {formatSize(level.total)}
                </div>
              </div>
            )}
          </For>
        </div>

        {/* Spread */}
        <div class="px-3 py-2 border-y border-brand-border bg-brand-screen/50">
          <div class="flex items-center justify-between text-xs">
            <span class="text-brand-green-400 font-mono font-semibold">
              {markPrice()}
            </span>
            <span class="text-brand-slate-500">
              Spread: {spreadPercent().toFixed(3)}%
            </span>
          </div>
        </div>

        {/* Bids */}
        <div class="flex-1 overflow-hidden">
          <For each={bids()}>
            {(level) => (
              <div class="book-level grid grid-cols-3 gap-2 px-3 text-xs relative">
                <div
                  class="absolute inset-0 bg-brand-green-400/7"
                  style={{
                    width: `${(level.total / maxTotal()) * 100}%`,
                    right: 0,
                    left: "auto",
                  }}
                />
                <div class="text-brand-green-400 font-mono relative z-10">
                  {level.price.toFixed(priceDecimals())}
                </div>
                <div class="text-right text-slate-300 font-mono relative z-10">
                  {formatSize(level.size)}
                </div>
                <div class="text-right text-brand-slate-400 font-mono relative z-10">
                  {formatSize(level.total)}
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default OrderBook;
