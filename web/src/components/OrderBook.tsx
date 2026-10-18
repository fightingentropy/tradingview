import { Component, Index, Show, createMemo } from "solid-js";
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
      <div class="book-heading">
        <h2 class="panel-title">Order book</h2>
      </div>

      {/* Column Headers */}
      <div class="book-columns">
        <div>Price</div>
        <div class="text-right">Size</div>
        <div class="text-right">Total</div>
      </div>

      <Show
        when={!isEmpty()}
        fallback={
          <div class="flex-1 flex items-center justify-center px-4 text-sm text-brand-slate-500">
            <Spinner label="Loading order book" />
          </div>
        }
      >
        {/* Asks */}
        <div class="book-asks flex-1 overflow-hidden flex flex-col justify-end">
          <Index each={asksForDisplay()}>
            {(level) => (
              <div class="book-level">
                <div
                  class="book-depth bg-brand-red-400/10"
                  style={{ width: `${(level().total / maxTotal()) * 100}%` }}
                />
                <div class="text-brand-red-400 font-mono relative z-10">
                  {level().price.toFixed(priceDecimals())}
                </div>
                <div class="text-right text-brand-slate-100 font-mono relative z-10">
                  {formatSize(level().size)}
                </div>
                <div class="text-right text-brand-slate-400 font-mono relative z-10">
                  {formatSize(level().total)}
                </div>
              </div>
            )}
          </Index>
        </div>

        {/* Spread */}
        <div class="book-spread">
          <span class="book-spread-price font-mono">{markPrice()}</span>
          <span class="book-spread-label">
            Spread: {spreadPercent().toFixed(3)}%
          </span>
        </div>

        {/* Bids */}
        <div class="book-bids flex-1 overflow-hidden">
          <Index each={bids()}>
            {(level) => (
              <div class="book-level">
                <div
                  class="book-depth bg-brand-green-400/10"
                  style={{ width: `${(level().total / maxTotal()) * 100}%` }}
                />
                <div class="text-brand-green-400 font-mono relative z-10">
                  {level().price.toFixed(priceDecimals())}
                </div>
                <div class="text-right text-brand-slate-100 font-mono relative z-10">
                  {formatSize(level().size)}
                </div>
                <div class="text-right text-brand-slate-400 font-mono relative z-10">
                  {formatSize(level().total)}
                </div>
              </div>
            )}
          </Index>
        </div>
      </Show>
    </div>
  );
};

export default OrderBook;
