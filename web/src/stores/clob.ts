import {
  createEffect,
  createMemo,
  createRoot,
  batch,
  untrack,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { convex, createConvexQuery } from "../lib/convex";
import { resolveHyperliquidMarketCoin } from "../lib/hyperliquid";
import { isAuthenticated } from "./auth";
import { currentMarketType, currentSymbol, markPrice, MARKETS } from "./market";
import type { L2Book as OrderBook } from "../lib/format";
import { normalizeSymbol } from "../lib/format";
import {
  cancelHyperliquidOrder,
  closeHyperliquidPosition,
  hyperliquidAccountMode,
  hyperliquidAccountValue,
  hyperliquidOpenOrders,
  hyperliquidPositions,
  hyperliquidSpotAvailableBalances,
  hyperliquidSpotBalances,
  hyperliquidWithdrawable,
  isHyperliquidExecution,
  placeHyperliquidOrder,
  setHyperliquidAccountMode,
  updateHyperliquidPositionTpsl,
} from "./hyperliquidExecution";
import {
  hyperliquidDataNetwork,
  hyperliquidWsUrl,
} from "../lib/hyperliquidNetwork";

export type Collateral = "USDC" | "USDT";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type MarginType = "isolated" | "cross";

export type ClobActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

export type { OrderBook };

type SimulationOrder = Doc<"orders"> & {
  source?: "simulation";
  exchangeOrderId?: never;
};

type HyperliquidOrder = {
  _id: string;
  _creationTime: number;
  source: "hyperliquid";
  exchangeOrderId: number;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: number;
  size: number;
  filledSize: number;
  leverage: number;
  collateral: Collateral;
  marginType: MarginType;
  status: "open";
  createdAt: number;
  updatedAt: number;
  reduceOnly: boolean;
  orderTypeLabel: string;
  isTrigger: boolean;
  isPositionTpsl: boolean;
  triggerPrice?: number;
};

export type Order = SimulationOrder | HyperliquidOrder;

type SimulationPosition = Doc<"positions"> & {
  source?: "simulation";
};

type HyperliquidPosition = {
  _id: string;
  _creationTime: number;
  source: "hyperliquid";
  symbol: string;
  size: number;
  entryPrice: number;
  markPriceLive: number;
  leverage: number;
  collateral: Collateral;
  marginType: MarginType;
  realizedPnl: number;
  cumulativeFunding: number;
  updatedAt: number;
  liquidationPrice?: number;
  marginUsedLive: number;
  unrealizedPnlLive: number;
  returnOnEquityLive: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
};

export type Position = SimulationPosition | HyperliquidPosition;

// Portfolio Margin Status type
export type PortfolioMarginStatus = {
  enabled: boolean;
  collateral: {
    spot: Array<{
      asset: string;
      balance: number;
      price: number;
      weight: number;
      weightedValue: number;
    }>;
    weightedSpotEquity: number;
  };
} | null;

type PerpsBalance = {
  asset: string;
  balance: number;
};

const isCollateral = (asset: string): asset is Collateral =>
  asset === "USDC" || asset === "USDT";

const {
  simulationOpenOrders,
  simulationPositions,
  simulationPerpsBalances,
  simulationPortfolioMarginStatus,
} = createRoot(() => {
  const openOrdersQuery = createConvexQuery(
    api.orders.listOpenOrders,
    () => {
      return isAuthenticated() ? {} : null;
    },
    [],
  );

  const positionsQuery = createConvexQuery(
    api.orders.listPositions,
    () => {
      return isAuthenticated() ? {} : null;
    },
    [],
  );

  const balancesQuery = createConvexQuery(
    api.orders.listPerpsBalances,
    () => {
      return isAuthenticated() ? {} : null;
    },
    [],
  );

  const portfolioMarginQuery = createConvexQuery(
    api.portfolioMargin.getPortfolioMarginStatus,
    () => {
      return isAuthenticated() ? {} : null;
    },
  );

  const perpsBalances = createMemo<Record<Collateral, number>>(() => {
    const next: Record<Collateral, number> = { USDC: 0, USDT: 0 };
    const balances = (balancesQuery() ?? []) as PerpsBalance[];
    for (const balance of balances) {
      if (isCollateral(balance.asset)) {
        next[balance.asset] = balance.balance;
      }
    }
    return next;
  });

  const positionsAccessor = () => (positionsQuery() ?? []) as Position[];

  const openOrdersAccessor = () => (openOrdersQuery() ?? []) as Order[];

  return {
    simulationOpenOrders: openOrdersAccessor,
    simulationPositions: positionsAccessor,
    simulationPerpsBalances: perpsBalances,
    simulationPortfolioMarginStatus: () =>
      portfolioMarginQuery() as PortfolioMarginStatus,
  };
});

const { openOrders, positions, perpsBalances, portfolioMarginStatus } =
  createRoot(() => {
    const openOrders = createMemo<Order[]>(() => {
      if (!isHyperliquidExecution()) return simulationOpenOrders();
      return hyperliquidOpenOrders().map((order) => ({
        _id: `hyperliquid:${order.oid}`,
        _creationTime: order.createdAt,
        source: "hyperliquid" as const,
        exchangeOrderId: order.oid,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        price: order.price,
        size: order.originalSize,
        filledSize: Math.max(0, order.originalSize - order.size),
        leverage: 1,
        collateral: "USDC" as const,
        marginType: "cross" as const,
        status: "open" as const,
        createdAt: order.createdAt,
        updatedAt: order.createdAt,
        reduceOnly: order.reduceOnly,
        orderTypeLabel: order.orderType,
        isTrigger: order.isTrigger,
        isPositionTpsl: order.isPositionTpsl,
        triggerPrice: order.triggerPrice,
      }));
    });

    const positions = createMemo<Position[]>(() => {
      if (!isHyperliquidExecution()) return simulationPositions();
      const orders = hyperliquidOpenOrders();
      return hyperliquidPositions().map((position) => {
        const tpOrder = orders.find(
          (order) =>
            order.symbol === position.symbol &&
            order.isTrigger &&
            order.orderType.includes("Take Profit"),
        );
        const slOrder = orders.find(
          (order) =>
            order.symbol === position.symbol &&
            order.isTrigger &&
            order.orderType.includes("Stop"),
        );
        return {
          _id: `hyperliquid:${position.symbol}`,
          _creationTime: Date.now(),
          source: "hyperliquid" as const,
          symbol: position.symbol,
          size: position.size,
          entryPrice: position.entryPrice,
          markPriceLive: position.markPrice,
          leverage: position.leverage,
          collateral: "USDC" as const,
          marginType: position.marginType,
          realizedPnl: 0,
          cumulativeFunding: position.cumulativeFunding,
          updatedAt: Date.now(),
          liquidationPrice: position.liquidationPrice,
          marginUsedLive: position.marginUsed,
          unrealizedPnlLive: position.unrealizedPnl,
          returnOnEquityLive: position.returnOnEquity,
          takeProfit: tpOrder?.triggerPrice ?? null,
          stopLoss: slOrder?.triggerPrice ?? null,
        };
      });
    });

    const perpsBalances = createMemo<Record<Collateral, number>>(() => {
      if (!isHyperliquidExecution()) return simulationPerpsBalances();
      const usdc =
        hyperliquidAccountMode() === "portfolioMargin" ||
        hyperliquidAccountMode() === "unifiedAccount"
          ? (hyperliquidSpotBalances().USDC ?? 0)
          : hyperliquidAccountValue();
      return { USDC: usdc, USDT: hyperliquidSpotBalances().USDT ?? 0 };
    });

    const portfolioMarginStatus = createMemo<PortfolioMarginStatus>(() => {
      if (!isHyperliquidExecution()) return simulationPortfolioMarginStatus();
      return {
        enabled: hyperliquidAccountMode() === "portfolioMargin",
        collateral: { spot: [], weightedSpotEquity: 0 },
      };
    });

    return { openOrders, positions, perpsBalances, portfolioMarginStatus };
  });
const [orderBooks, setOrderBooks] = createStore<Record<string, OrderBook>>({});
const EMPTY_BOOK: OrderBook = { asks: [], bids: [] };

// Maximum number of price levels to keep per side in the order book.
const ORDER_BOOK_DEPTH = 15;

const parseNumber = (value: string | number): number => {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeAssetSymbol = (symbol: string) => {
  const trimmed = String(symbol ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("xyz:")) {
    return trimmed.slice(trimmed.indexOf(":") + 1).toUpperCase();
  }
  return trimmed.toUpperCase();
};

const getSpotPriceForAsset = (asset: string, markets = MARKETS()) => {
  const normalized = normalizeAssetSymbol(asset);
  if (normalized === "USDC" || normalized === "USDT") return 1;
  const spotMarket = markets.find(
    (market) =>
      market.type === "spot" &&
      normalizeAssetSymbol(market.symbol) === normalized,
  );
  const spotPrice = parseNumber(spotMarket?.price ?? 0);
  if (spotPrice > 0) return spotPrice;

  const perpMarket = markets.find(
    (market) =>
      market.type === "perps" &&
      normalizeAssetSymbol(market.symbol) === normalized,
  );
  const perpPrice = parseNumber(perpMarket?.price ?? 0);
  return perpPrice > 0 ? perpPrice : 0;
};

// Per spec "No symbol-scoped hedging": spot does NOT reduce a perp position's
// size for liquidation / ADL / margin denominators. Always return the raw size.
export const getHedgedSpotSize = (_position: Position) => 0;

export const getEffectivePositionSize = (position: Position) => {
  return Math.abs(position.size);
};

const getErrorText = (error: unknown): string => {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "string") return `${error.message} ${data}`;
    if (data && typeof data === "object") {
      const dataMessage = (data as { message?: unknown }).message;
      if (typeof dataMessage === "string") {
        return `${error.message} ${dataMessage}`;
      }
      try {
        return `${error.message} ${JSON.stringify(data)}`;
      } catch {
        return error.message;
      }
    }
    return error.message;
  }
  if (typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return "";
    }
  }
  return String(error);
};

const isMarkPricesValidationError = (error: unknown) => {
  const text = getErrorText(error).toLowerCase();
  if (!text) return false;
  return (
    text.includes("markprices") &&
    (text.includes("not in the validator") ||
      text.includes("extra field") ||
      text.includes("argumentvalidationerror"))
  );
};

const isSpotPricesValidationError = (error: unknown) => {
  const text = getErrorText(error).toLowerCase();
  if (!text) return false;
  return (
    text.includes("spotprices") &&
    (text.includes("not in the validator") ||
      text.includes("extra field") ||
      text.includes("argumentvalidationerror"))
  );
};

let markPricesSupported = true;
let spotPricesSupported = true;

const [lastPrices, setLastPrices] = createStore<Record<string, number>>({});

const ADL_COOLDOWN_MS = 4000;
const ADL_REDUCTION_FRACTION = 0.25;
const ADL_MIN_REDUCTION = 0.0001;

const adlCooldownBySymbol = new Map<string, number>();
const adlInFlight = new Set<string>();
const limitFillInFlight = new Set<Id<"orders">>();
const tpslCloseInFlight = new Set<string>();

export const getMarkPriceForSymbol = (symbol: string) => {
  if (!symbol) return 0;
  const last = lastPrices[symbol];
  if (Number.isFinite(last) && last > 0) return last;
  // Use untrack to prevent creating a subscription to MARKETS inside effects
  const fallback = untrack(() => MARKETS()).find(
    (market) => market.symbol === symbol,
  )?.price;
  return parseNumber(fallback ?? 0);
};

const shouldTriggerAdl = (
  position: Position,
  mark: number,
  totals: {
    portfolioMarginEnabled: boolean;
    totalUnrealized: number;
    totalMarginUsed: number;
    totalPerpsBalance: number;
    weightedSpotEquity: number;
    unrealizedByCollateral: Record<Collateral, number>;
    marginUsedByCollateral: Record<Collateral, number>;
  },
) => {
  if (!Number.isFinite(mark) || mark <= 0) return false;
  if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0) {
    return false;
  }
  if (!Number.isFinite(position.leverage) || position.leverage <= 0)
    return false;

  const isShort = position.size < 0;
  const absSize = Math.abs(position.size);
  if (absSize <= 0) return false;
  const effectiveAbsSize = getEffectivePositionSize(position);
  if (effectiveAbsSize <= 0) return false;

  const marginType = position.marginType ?? "cross";
  if (marginType === "isolated") {
    const liqFactor = 1 / position.leverage;
    const liqPrice = isShort
      ? position.entryPrice * (1 + liqFactor)
      : position.entryPrice * (1 - liqFactor);
    if (!Number.isFinite(liqPrice) || liqPrice <= 0) return false;
    return isShort ? mark >= liqPrice : mark <= liqPrice;
  }

  const currentUnrealized = (mark - position.entryPrice) * position.size;
  const positionMarginUsed =
    position.leverage > 0 ? (effectiveAbsSize * mark) / position.leverage : 0;
  let equity = 0;

  if (totals.portfolioMarginEnabled) {
    const otherMarginUsed = Math.max(
      0,
      totals.totalMarginUsed - positionMarginUsed,
    );
    equity =
      totals.totalPerpsBalance +
      totals.weightedSpotEquity +
      (totals.totalUnrealized - currentUnrealized) -
      otherMarginUsed;
  } else {
    const balance = perpsBalances()[position.collateral] ?? 0;
    const totalMarginUsed =
      totals.marginUsedByCollateral[position.collateral] ?? 0;
    const otherMarginUsed = Math.max(0, totalMarginUsed - positionMarginUsed);
    equity =
      balance +
      (totals.unrealizedByCollateral[position.collateral] - currentUnrealized) -
      otherMarginUsed;
  }
  if (!Number.isFinite(equity)) return false;
  if (equity <= 0) return true;

  const liqPrice = isShort
    ? position.entryPrice + equity / effectiveAbsSize
    : position.entryPrice - equity / effectiveAbsSize;
  if (!Number.isFinite(liqPrice) || liqPrice <= 0) return false;
  return isShort ? mark >= liqPrice : mark <= liqPrice;
};

const triggerAdlReduction = async (position: Position, mark: number) => {
  if (!isAuthenticated()) return;
  const symbol = position.symbol;
  if (adlInFlight.has(symbol)) return;
  const now = Date.now();
  const last = adlCooldownBySymbol.get(symbol) ?? 0;
  if (now - last < ADL_COOLDOWN_MS) return;

  const absSize = Math.abs(position.size);
  if (!Number.isFinite(absSize) || absSize <= 0) return;
  const reduceSize = Math.min(
    absSize,
    Math.max(absSize * ADL_REDUCTION_FRACTION, ADL_MIN_REDUCTION),
  );
  if (!Number.isFinite(reduceSize) || reduceSize <= 0) return;

  adlInFlight.add(symbol);
  adlCooldownBySymbol.set(symbol, now);
  try {
    await convex.mutation(api.orders.autoDeleveragePosition, {
      symbol,
      markPrice: mark,
      reduceSize,
      idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
    });
  } catch (error) {
    console.error("ADL reduction failed:", error);
  } finally {
    adlInFlight.delete(symbol);
  }
};

createRoot(() => {
  // Sync prices for the current symbol from live markPrice.
  // Use untrack to avoid stamping the new symbol with the previous symbol's price.
  createEffect(() => {
    const price = parseNumber(markPrice());
    if (Number.isFinite(price) && price > 0) {
      const symbol = untrack(() => currentSymbol());
      setLastPrices(symbol, price);
    }
  });

  // Sync prices for ALL symbols from MARKETS data (ensures position prices are accurate)
  createEffect(() => {
    const markets = MARKETS();
    // Batch all updates to prevent triggering effects mid-iteration
    batch(() => {
      for (const market of markets) {
        const price = parseNumber(market.price);
        if (Number.isFinite(price) && price > 0) {
          setLastPrices(market.symbol, price);
        }
      }
    });
  });

  createEffect(() => {
    if (isHyperliquidExecution()) return;
    if (!isAuthenticated()) return;
    const activePositions = positions();
    if (activePositions.length === 0) return;

    const unrealizedByCollateral: Record<Collateral, number> = {
      USDC: 0,
      USDT: 0,
    };
    const marginUsedByCollateral: Record<Collateral, number> = {
      USDC: 0,
      USDT: 0,
    };
    let totalUnrealized = 0;
    let totalMarginUsed = 0;

    for (const position of activePositions) {
      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      const pnl = (mark - position.entryPrice) * position.size;
      unrealizedByCollateral[position.collateral] += pnl;
      totalUnrealized += pnl;
      if (position.leverage <= 0) continue;
      const effectiveSize = getEffectivePositionSize(position);
      if (effectiveSize <= 0) continue;
      const marginUsed = (effectiveSize * mark) / position.leverage;
      marginUsedByCollateral[position.collateral] += marginUsed;
      totalMarginUsed += marginUsed;
    }

    const totalPerpsBalance =
      (perpsBalances().USDC ?? 0) + (perpsBalances().USDT ?? 0);
    const weightedSpotEquity = getWeightedSpotEquity();
    const totals = {
      portfolioMarginEnabled: isPortfolioMarginEnabled(),
      totalUnrealized,
      totalMarginUsed,
      totalPerpsBalance,
      weightedSpotEquity,
      unrealizedByCollateral,
      marginUsedByCollateral,
    };

    for (const position of activePositions) {
      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      if (!shouldTriggerAdl(position, mark, totals)) continue;
      void triggerAdlReduction(position, mark);
    }
  });

  createEffect(() => {
    if (isHyperliquidExecution()) return;
    if (!isAuthenticated()) return;
    const orders = openOrders();
    if (orders.length === 0) return;

    for (const order of orders) {
      if (order.source === "hyperliquid") continue;
      if (order.type !== "limit") continue;
      const limitPrice = typeof order.price === "number" ? order.price : null;
      if (
        limitPrice === null ||
        !Number.isFinite(limitPrice) ||
        limitPrice <= 0
      )
        continue;
      const mark = getMarkPriceForSymbol(order.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;

      const shouldFill =
        order.side === "buy" ? mark <= limitPrice : mark >= limitPrice;
      if (!shouldFill) continue;
      if (limitFillInFlight.has(order._id)) continue;

      limitFillInFlight.add(order._id);
      void convex
        .mutation(api.orders.fillOpenOrder, {
          orderId: order._id,
          markPrice: mark,
        })
        .catch((error) => {
          console.error("Failed to auto-fill limit order:", error);
        })
        .finally(() => {
          limitFillInFlight.delete(order._id);
        });
    }
  });

  createEffect(() => {
    if (isHyperliquidExecution()) return;
    if (!isAuthenticated()) return;
    const activePositions = positions();
    if (activePositions.length === 0) return;

    for (const position of activePositions) {
      if (position.size === 0) continue;
      if (tpslCloseInFlight.has(position.symbol)) continue;
      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;

      const takeProfit = position.takeProfit ?? null;
      const stopLoss = position.stopLoss ?? null;
      const isLong = position.size > 0;

      const tpHit =
        takeProfit != null &&
        Number.isFinite(takeProfit) &&
        (isLong ? mark >= takeProfit : mark <= takeProfit);
      const slHit =
        stopLoss != null &&
        Number.isFinite(stopLoss) &&
        (isLong ? mark <= stopLoss : mark >= stopLoss);

      if (!tpHit && !slHit) continue;
      tpslCloseInFlight.add(position.symbol);
      void convex
        .mutation(api.orders.closePosition, {
          symbol: position.symbol,
          markPrice: mark,
        })
        .catch((error) => {
          console.error("Failed to auto-close position:", error);
        })
        .finally(() => {
          tpslCloseInFlight.delete(position.symbol);
        });
    }
  });

  // Update funding for positions at the top of each hour.
  let fundingUpdateTimeout: number | undefined;

  /**
   * Calculate the next funding payment time.
   * Funding payments are hourly, so we align to the next top-of-hour.
   */
  const getNextFundingPaymentTime = (): number => {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.getTime();
  };

  const scheduleNextFundingUpdate = () => {
    if (fundingUpdateTimeout) {
      clearTimeout(fundingUpdateTimeout);
      fundingUpdateTimeout = undefined;
    }

    const nextPaymentTime = getNextFundingPaymentTime();
    const now = Date.now();
    const delay = Math.max(0, nextPaymentTime - now);

    fundingUpdateTimeout = setTimeout(() => {
      void updateFunding().then(() => {
        // After updating, schedule the next one (hourly).
        scheduleNextFundingUpdate();
      });
    }, delay) as unknown as number;
  };

  const updateFunding = async () => {
    if (isHyperliquidExecution()) return;
    if (!isAuthenticated()) return;
    const activePositions = positions();
    if (activePositions.length === 0) return;

    const markets = untrack(() => MARKETS());
    const fundingRates: Record<string, number> = {};
    const markPrices: Record<string, number> = {};

    for (const position of activePositions) {
      const market = markets.find(
        (m) => m.symbol === position.symbol && m.type === "perps",
      );
      if (!market) continue;

      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;

      // Convert funding from percentage to decimal (e.g., 0.01% -> 0.0001)
      const fundingRateDecimal = market.funding / 100;
      fundingRates[position.symbol] = fundingRateDecimal;
      markPrices[position.symbol] = mark;
    }

    if (Object.keys(fundingRates).length > 0) {
      const includeMarkPrices =
        markPricesSupported && Object.keys(markPrices).length > 0;
      try {
        await convex.mutation(api.orders.updateFundingForPositions, {
          fundingRates,
          ...(includeMarkPrices ? { markPrices } : {}),
        });
      } catch (error) {
        if (isMarkPricesValidationError(error)) {
          markPricesSupported = false;
          try {
            await convex.mutation(api.orders.updateFundingForPositions, {
              fundingRates,
            });
            return;
          } catch (retryError) {
            console.error("Failed to update funding:", retryError);
            return;
          }
        }
        console.error("Failed to update funding:", error);
      }
    }
  };

  // Update funding immediately when positions change, then at funding payment times
  createEffect(() => {
    if (isHyperliquidExecution()) {
      if (fundingUpdateTimeout) {
        clearTimeout(fundingUpdateTimeout);
        fundingUpdateTimeout = undefined;
      }
      return;
    }
    if (!isAuthenticated()) {
      if (fundingUpdateTimeout) {
        clearTimeout(fundingUpdateTimeout);
        fundingUpdateTimeout = undefined;
      }
      return;
    }

    const activePositions = positions();
    if (activePositions.length === 0) {
      if (fundingUpdateTimeout) {
        clearTimeout(fundingUpdateTimeout);
        fundingUpdateTimeout = undefined;
      }
      return;
    }

    // Update immediately
    void updateFunding();

    // Schedule next update at the next funding payment time
    scheduleNextFundingUpdate();

    onCleanup(() => {
      if (fundingUpdateTimeout) {
        clearTimeout(fundingUpdateTimeout);
        fundingUpdateTimeout = undefined;
      }
    });
  });
});

type HyperliquidL2Level = { px: string; sz: string; n?: number };

let orderBookSubscriptionEpoch = 0;
const ORDER_BOOK_RENDER_INTERVAL_MS = 50;

const orderBookKey = (network: string, marketType: string, symbol: string) =>
  `${network}:${marketType}:${normalizeSymbol(symbol)}`;

// Build a side ({price,size,total} levels with running cumulative total) from
// the raw Hyperliquid l2Book level array, capped to ORDER_BOOK_DEPTH.
const buildBookSide = (
  levels: HyperliquidL2Level[] | undefined,
): OrderBook["bids"] => {
  if (!Array.isArray(levels)) return [];
  const out: OrderBook["bids"] = [];
  let runningTotal = 0;
  for (let i = 0; i < levels.length && out.length < ORDER_BOOK_DEPTH; i += 1) {
    const level = levels[i];
    const price = parseNumber(level?.px ?? 0);
    const size = parseNumber(level?.sz ?? 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(size) || size <= 0) continue;
    runningTotal += size;
    out.push({ price, size, total: runningTotal });
  }
  return out;
};

// Subscribe to the live Hyperliquid L2 order book for the active symbol and
// populate the orderBooks store. Nothing else writes this store, so without
// this the OrderBook component renders empty.
createRoot(() => {
  createEffect(() => {
    const network = hyperliquidDataNetwork();
    const marketType = currentMarketType();
    const symbol = currentSymbol();
    if (!symbol) return;

    const subscriptionEpoch = ++orderBookSubscriptionEpoch;
    const bookKey = orderBookKey(network, marketType, symbol);
    setOrderBooks(bookKey, { bids: [], asks: [] });

    const abortController = new AbortController();
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempts = 0;
    let pendingLevels: [HyperliquidL2Level[], HyperliquidL2Level[]] | null =
      null;
    let renderTimer: number | undefined;
    let renderFrame: number | undefined;

    const clearReconnect = () => {
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const flushBook = () => {
      renderFrame = undefined;
      renderTimer = undefined;
      const levels = pendingLevels;
      pendingLevels = null;
      if (
        !levels ||
        closed ||
        subscriptionEpoch !== orderBookSubscriptionEpoch
      ) {
        return;
      }
      setOrderBooks(bookKey, {
        bids: buildBookSide(levels[0]),
        asks: buildBookSide(levels[1]),
      });
    };

    const scheduleBookRender = (
      levels: [HyperliquidL2Level[], HyperliquidL2Level[]],
    ) => {
      pendingLevels = levels;
      if (renderTimer !== undefined || renderFrame !== undefined) return;
      renderTimer = window.setTimeout(() => {
        renderTimer = undefined;
        renderFrame = requestAnimationFrame(flushBook);
      }, ORDER_BOOK_RENDER_INTERVAL_MS);
    };

    const connect = (coin: string) => {
      if (closed || subscriptionEpoch !== orderBookSubscriptionEpoch) return;
      const ws = new WebSocket(hyperliquidWsUrl());
      socket = ws;

      ws.onopen = () => {
        if (
          closed ||
          subscriptionEpoch !== orderBookSubscriptionEpoch ||
          socket !== ws
        ) {
          ws.close();
          return;
        }
        reconnectAttempts = 0;
        ws.send(
          JSON.stringify({
            method: "subscribe",
            subscription: { type: "l2Book", coin },
          }),
        );
      };

      ws.onmessage = (event) => {
        if (
          closed ||
          subscriptionEpoch !== orderBookSubscriptionEpoch ||
          socket !== ws
        ) {
          return;
        }
        try {
          const payload = JSON.parse(event.data);
          if (payload?.channel !== "l2Book") return;
          const data = payload?.data;
          if (
            !data ||
            String(data.coin ?? "")
              .trim()
              .toLowerCase() !== coin.toLowerCase()
          ) {
            return;
          }
          const levels = data.levels;
          if (
            !Array.isArray(levels) ||
            !Array.isArray(levels[0]) ||
            !Array.isArray(levels[1])
          ) {
            return;
          }
          scheduleBookRender([
            levels[0] as HyperliquidL2Level[],
            levels[1] as HyperliquidL2Level[],
          ]);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (
          closed ||
          subscriptionEpoch !== orderBookSubscriptionEpoch ||
          socket !== ws
        ) {
          return;
        }
        // Exponential backoff with cap + jitter; reset on successful open.
        reconnectAttempts += 1;
        const base = Math.min(1000 * 2 ** (reconnectAttempts - 1), 30000);
        const jitter = Math.random() * 0.3 * base;
        clearReconnect();
        reconnectTimer = setTimeout(
          () => connect(coin),
          base + jitter,
        ) as unknown as number;
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // no-op
        }
      };
    };

    void resolveHyperliquidMarketCoin({
      symbol,
      marketType,
      signal: abortController.signal,
    }).then((coin) => {
      if (!coin || closed || subscriptionEpoch !== orderBookSubscriptionEpoch) {
        return;
      }
      connect(coin);
    });

    onCleanup(() => {
      closed = true;
      abortController.abort();
      clearReconnect();
      if (renderTimer !== undefined) clearTimeout(renderTimer);
      if (renderFrame !== undefined) cancelAnimationFrame(renderFrame);
      pendingLevels = null;
      if (socket) {
        try {
          socket.onopen = null;
          socket.onmessage = null;
          socket.onclose = null;
          socket.onerror = null;
          socket.close();
        } catch {
          // no-op
        }
        socket = null;
      }
    });
  });
});

export const getOrderBook = (symbol: string) => {
  return (
    orderBooks[
      orderBookKey(hyperliquidDataNetwork(), currentMarketType(), symbol)
    ] ?? EMPTY_BOOK
  );
};

export const getPositionForSymbol = (symbol: string) =>
  positions().find((pos) => pos.symbol === symbol);

export const getAvailableBalance = (collateral: Collateral) => {
  if (isHyperliquidExecution()) {
    if (collateral === "USDC") {
      const sharedCollateral =
        hyperliquidAccountMode() === "portfolioMargin" ||
        hyperliquidAccountMode() === "unifiedAccount";
      return Math.max(
        sharedCollateral
          ? (hyperliquidSpotAvailableBalances().USDC ?? 0)
          : hyperliquidWithdrawable(),
        0,
      );
    }
    return Math.max(hyperliquidSpotAvailableBalances().USDT ?? 0, 0);
  }
  if (isPortfolioMarginEnabled()) {
    const collateralPool =
      getTotalPerpsBalance() +
      getWeightedSpotEquity() +
      getTotalUnrealizedPnl();
    const marginUsed = getTotalMarginUsed();
    return Math.max(collateralPool - marginUsed, 0);
  }

  const balance = perpsBalances()[collateral] ?? 0;
  const marginUsed = positions()
    .filter((pos) => pos.collateral === collateral)
    .reduce((sum, pos) => {
      const mark = getMarkPriceForSymbol(pos.symbol);
      if (!Number.isFinite(mark) || mark <= 0 || pos.leverage <= 0) return sum;
      const notional = Math.abs(pos.size) * mark;
      return sum + notional / pos.leverage;
    }, 0);
  return Math.max(balance - marginUsed, 0);
};

// Portfolio Margin helpers
export function isPortfolioMarginEnabled() {
  if (isHyperliquidExecution()) {
    return hyperliquidAccountMode() === "portfolioMargin";
  }
  const status = portfolioMarginStatus();
  return status?.enabled ?? false;
}

export function getWeightedSpotEquity() {
  if (isHyperliquidExecution()) return 0;
  if (!isPortfolioMarginEnabled()) return 0;
  const breakdown = portfolioMarginStatus()?.collateral?.spot ?? [];
  const markets = MARKETS();
  return breakdown.reduce((sum, item) => {
    const livePrice = getSpotPriceForAsset(item.asset, markets);
    const price =
      livePrice > 0 ? livePrice : Number.isFinite(item.price) ? item.price : 0;
    const weight = Number.isFinite(item.weight) ? item.weight : 0;
    return sum + item.balance * price * weight;
  }, 0);
}

export function getTotalPerpsBalance() {
  return (perpsBalances().USDC ?? 0) + (perpsBalances().USDT ?? 0);
}

export function getTotalUnrealizedPnl() {
  return positions().reduce((sum, position) => {
    if (position.source === "hyperliquid") {
      return sum + position.unrealizedPnlLive;
    }
    const mark = getMarkPriceForSymbol(position.symbol);
    if (!Number.isFinite(mark) || mark <= 0) return sum;
    return sum + (mark - position.entryPrice) * position.size;
  }, 0);
}

export function getTotalMarginUsed() {
  return positions().reduce((sum, position) => {
    if (position.source === "hyperliquid") {
      return sum + position.marginUsedLive;
    }
    const mark = getMarkPriceForSymbol(position.symbol);
    if (!Number.isFinite(mark) || mark <= 0 || position.leverage <= 0) {
      return sum;
    }
    const effectiveSize = getEffectivePositionSize(position);
    if (effectiveSize <= 0) return sum;
    return sum + (effectiveSize * mark) / position.leverage;
  }, 0);
}

export const togglePortfolioMargin = async (
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> => {
  if (isHyperliquidExecution()) {
    return await setHyperliquidAccountMode(
      enabled ? "portfolioMargin" : "unifiedAccount",
    );
  }
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to change settings." };
  }
  try {
    await convex.mutation(api.portfolioMargin.togglePortfolioMargin, {
      enabled,
    });
    // Clear legacy per-position spot collateral data
    await convex.mutation(api.portfolioMargin.recalculateSpotCollateral, {});
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update portfolio margin.";
    console.error("Failed to toggle portfolio margin:", error);
    return { ok: false, error: message };
  }
};

export const getBalance = (collateral: Collateral) =>
  perpsBalances()[collateral] ?? 0;

export const placeOrder = async ({
  symbol,
  side,
  type,
  size,
  price,
  leverage,
  collateral,
  marginType,
  reduceOnly,
}: {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  size: number;
  price?: number;
  leverage: number;
  collateral: Collateral;
  marginType: MarginType;
  reduceOnly?: boolean;
}): Promise<{ ok: boolean; error?: string; message?: string }> => {
  if (isHyperliquidExecution()) {
    return await placeHyperliquidOrder({
      symbol,
      side,
      type,
      size,
      price,
      leverage,
      marginType,
      reduceOnly,
      marketType: "perp",
    });
  }
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to place orders." };
  }
  if (!symbol || size <= 0) {
    return { ok: false, error: "Enter a valid size." };
  }

  const mark = getMarkPriceForSymbol(symbol);
  if (!Number.isFinite(mark) || mark <= 0) {
    return { ok: false, error: "Mark price unavailable." };
  }

  // Make sure the server oracle has a fresh price for this symbol before it
  // settles the order. The price cron only polls symbols that are already
  // held/open, so a brand-new symbol may have no fresh row yet. Best-effort and
  // cheap (no-op when already fresh); settlement derives the price server-side
  // regardless of this call.
  try {
    await convex.action(api.prices.ensureSymbolFresh, { symbol });
  } catch {
    // ignore; placePerpsOrder will fail closed if no fresh server price exists
  }

  const markPrices: Record<string, number> = {};
  for (const position of positions()) {
    const positionMark = getMarkPriceForSymbol(position.symbol);
    if (Number.isFinite(positionMark) && positionMark > 0) {
      markPrices[position.symbol] = positionMark;
    }
  }
  const spotPrices: Record<string, number> = {};
  if (isPortfolioMarginEnabled()) {
    const breakdown = portfolioMarginStatus()?.collateral?.spot ?? [];
    const markets = MARKETS();
    for (const item of breakdown) {
      const price = getSpotPriceForAsset(item.asset, markets);
      if (price > 0) {
        spotPrices[normalizeAssetSymbol(item.asset)] = price;
      }
    }
  }
  const includeSpotPrices =
    spotPricesSupported &&
    isPortfolioMarginEnabled() &&
    Object.keys(spotPrices).length > 0;
  const includeMarkPrices =
    markPricesSupported && Object.keys(markPrices).length > 0;
  // Reuse one key across Convex/network retries and compatibility retries so
  // an ambiguous response can never submit the economic operation twice.
  const idempotencyKey = crypto.randomUUID().replaceAll("-", "");

  const coreArgs = {
    symbol,
    side,
    type,
    size,
    price: Number.isFinite(price ?? NaN) ? price : undefined,
    leverage,
    collateral,
    marginType,
    markPrice: mark,
    maxSlippageBps: 100,
    idempotencyKey,
  };

  const buildArgs = (opts: { spots: boolean; marks: boolean }) => ({
    ...coreArgs,
    ...(opts.spots && includeSpotPrices ? { spotPrices } : {}),
    ...(opts.marks && includeMarkPrices ? { markPrices } : {}),
  });

  const tryOrder = async (opts: {
    spots: boolean;
    marks: boolean;
  }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      await convex.mutation(api.orders.placePerpsOrder, buildArgs(opts));
      return { ok: true };
    } catch (error) {
      if (opts.marks && isMarkPricesValidationError(error)) {
        markPricesSupported = false;
        return tryOrder({ ...opts, marks: false });
      }
      if (opts.spots && isSpotPricesValidationError(error)) {
        spotPricesSupported = false;
        return tryOrder({ ...opts, spots: false });
      }
      const message =
        error instanceof Error ? error.message : "Order submission failed.";
      console.error("Failed to place order:", error);
      return { ok: false, error: message };
    }
  };

  return tryOrder({ spots: includeSpotPrices, marks: includeMarkPrices });
};

export const updatePositionTpsl = async ({
  symbol,
  takeProfit,
  stopLoss,
}: {
  symbol: string;
  takeProfit?: number | null;
  stopLoss?: number | null;
}): Promise<{ ok: boolean; error?: string }> => {
  if (isHyperliquidExecution()) {
    return await updateHyperliquidPositionTpsl({
      symbol,
      takeProfit,
      stopLoss,
    });
  }
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to update TP/SL." };
  }
  if (takeProfit != null && (!Number.isFinite(takeProfit) || takeProfit <= 0)) {
    return { ok: false, error: "Enter a valid take profit price." };
  }
  if (stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) {
    return { ok: false, error: "Enter a valid stop loss price." };
  }

  try {
    await convex.mutation(api.orders.updatePositionTpsl, {
      symbol,
      takeProfit: takeProfit ?? null,
      stopLoss: stopLoss ?? null,
    });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update TP/SL.";
    console.error("Failed to update TP/SL:", error);
    return { ok: false, error: message };
  }
};

export const cancelOrder = async (
  orderId: Id<"orders"> | string,
): Promise<ClobActionResult> => {
  if (isHyperliquidExecution()) {
    const order = openOrders().find((item) => item._id === orderId);
    if (order?.source !== "hyperliquid") {
      return { ok: false, error: "Order is no longer open." };
    }
    return await cancelHyperliquidOrder(order.symbol, order.exchangeOrderId);
  }
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to cancel this order." };
  }
  if (typeof orderId !== "string" || orderId.startsWith("hyperliquid:")) {
    return { ok: false, error: "Order is no longer open." };
  }
  try {
    await convex.mutation(api.orders.cancelOrder, {
      orderId: orderId as Id<"orders">,
    });
    return { ok: true };
  } catch (error) {
    console.error("Failed to cancel order:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to cancel order.",
    };
  }
};

export const fillOpenOrder = async (orderId: Id<"orders"> | string) => {
  if (isHyperliquidExecution()) return;
  if (!isAuthenticated()) return;
  const order = openOrders().find((item) => item._id === orderId);
  if (!order || order.status !== "open" || order.source === "hyperliquid") {
    return;
  }
  const fillMark = getMarkPriceForSymbol(order.symbol);
  if (!Number.isFinite(fillMark) || fillMark <= 0) return;
  try {
    await convex.mutation(api.orders.fillOpenOrder, {
      orderId: orderId as Id<"orders">,
      markPrice: fillMark,
    });
  } catch (error) {
    console.error("Failed to fill order:", error);
  }
};

export const closePosition = async (
  symbol: string,
): Promise<ClobActionResult> => {
  if (isHyperliquidExecution()) {
    return await closeHyperliquidPosition(symbol);
  }
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to close this position." };
  }
  const position = positions().find((pos) => pos.symbol === symbol);
  if (!position) return { ok: false, error: "Position is no longer open." };
  const mark = getMarkPriceForSymbol(symbol);
  if (!Number.isFinite(mark) || mark <= 0) {
    return { ok: false, error: "A valid mark price is not available." };
  }
  try {
    await convex.mutation(api.orders.closePosition, {
      symbol,
      markPrice: mark,
    });
    return { ok: true };
  } catch (error) {
    console.error("Failed to close position:", error);
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to close position.",
    };
  }
};

export { openOrders, positions, portfolioMarginStatus };
