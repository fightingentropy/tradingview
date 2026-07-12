import type { HlOrderBook } from '@/lib/hyperliquid/info';

export interface ExecutionEstimate {
  averagePrice: number;
  bestPrice: number;
  filledSize: number;
  requestedSize: number;
  priceImpactPct: number;
  sufficientDepth: boolean;
  spreadPct: number | null;
}

/** Walk visible L2 depth to estimate the average fill for a market-sized IOC order. */
export function estimateExecution(
  book: HlOrderBook | undefined,
  isBuy: boolean,
  requestedSize: number,
): ExecutionEstimate | null {
  if (!book || !(requestedSize > 0)) return null;
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  const levels = isBuy ? book.asks : book.bids;
  const bestPrice = levels[0]?.price;
  if (!(bestPrice > 0)) return null;

  let remaining = requestedSize;
  let filledSize = 0;
  let notional = 0;
  for (const level of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, level.size);
    filledSize += take;
    notional += take * level.price;
    remaining -= take;
  }
  if (!(filledSize > 0)) return null;
  const averagePrice = notional / filledSize;
  const priceImpactPct = Math.abs((averagePrice - bestPrice) / bestPrice) * 100;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  const spreadPct = mid && bestAsk && bestBid ? ((bestAsk - bestBid) / mid) * 100 : null;
  return {
    averagePrice,
    bestPrice,
    filledSize,
    requestedSize,
    priceImpactPct,
    sufficientDepth: filledSize >= requestedSize * 0.999999,
    spreadPct,
  };
}
