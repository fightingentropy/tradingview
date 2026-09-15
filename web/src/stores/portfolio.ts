import { createRoot } from "solid-js";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { createConvexQuery } from "../lib/convex";
import { isAuthenticated } from "./auth";

export type Trade = Doc<"trades">;
export type PortfolioMetrics = Doc<"portfolioMetrics"> | null | undefined;

const TRADE_HISTORY_LIMIT = 500;

const { tradeHistory, portfolioMetrics } = createRoot(() => {
  const tradesQuery = createConvexQuery(
    api.trades.listTrades,
    () => (isAuthenticated() ? { limit: TRADE_HISTORY_LIMIT } : null),
    [],
  );

  const metricsQuery = createConvexQuery(
    api.portfolio.getMetrics,
    () => (isAuthenticated() ? {} : null),
    null,
  );

  return {
    tradeHistory: () => tradesQuery() ?? [],
    portfolioMetrics: () => metricsQuery() ?? null,
  };
});

export { tradeHistory, portfolioMetrics };
