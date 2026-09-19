import type { InfoClient } from "@nktkas/hyperliquid";
import type { SymbolConverter } from "@nktkas/hyperliquid/utils";
import type { HyperliquidAccountMode, HyperliquidAccountTransfer, HyperliquidFeeSummary, HyperliquidFundingPayment, HyperliquidHistoricalOrder, HyperliquidInterestPayment, HyperliquidPortfolioMarginSummary, HyperliquidPortfolioPeriod, HyperliquidPortfolioSnapshot, HyperliquidTradeFill, HyperliquidTwapOrder } from "./hyperliquidExecutionTypes";

export const parseNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeCumulativeFunding = (value: unknown): number => {
  // Hyperliquid reports cumulative funding from the payment perspective:
  // positive means the trader paid, while negative means they received.
  // The account UI displays cash flow, so invert that convention here.
  const payment = parseNumber(value);
  return payment === 0 ? 0 : -payment;
};

export const parseOptionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseCollateralLtv = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : undefined;
};

export const availableSpotBalance = (
  total: unknown,
  hold: unknown,
  availableAfterMaintenance?: unknown,
  requireMaintenanceAvailability = false,
) =>
  Math.max(
    availableAfterMaintenance === undefined
      ? requireMaintenanceAvailability
        ? 0
        : parseNumber(total) - parseNumber(hold)
      : parseNumber(availableAfterMaintenance),
    0,
  );

export const borrowedSpotBalance = (borrowed: unknown, total: unknown) => {
  const reportedBorrowed = parseOptionalNumber(borrowed);
  if (reportedBorrowed !== undefined) return Math.max(reportedBorrowed, 0);
  return Math.max(-parseNumber(total), 0);
};

export const requiresMaintenanceAvailability = (mode: HyperliquidAccountMode) =>
  mode === "unifiedAccount" || mode === "portfolioMargin";

export type PortfolioMarginSpotStateInput = {
  portfolioMarginRatio?: unknown;
  tokenToPortfolioBorrowRatio?: Array<readonly [number, unknown]>;
  balances: Array<{
    coin: string;
    total: unknown;
    ltv?: unknown;
  }>;
};

export type PortfolioMarginPerpStateInput = {
  marginSummary: { totalNtlPos: unknown };
  crossMaintenanceMarginUsed: unknown;
  assetPositions: Array<{
    position: { unrealizedPnl: unknown };
  }>;
};

export const buildSpotUsdPriceMap = (referencePrices: Record<string, number>) => {
  const usdPrices = new Map<string, number>([["USDC", 1]]);
  const spotPairs = Object.entries(referencePrices).flatMap(
    ([symbol, rawPrice]) => {
      const [base, quote, extra] = symbol.toUpperCase().split("/");
      const price = Number(rawPrice);
      return !extra && base && quote && Number.isFinite(price) && price > 0
        ? [{ base, quote, price }]
        : [];
    },
  );

  // Resolve quoted spot pairs into USDC, including reverse and multi-hop pairs.
  for (let pass = 0; pass <= spotPairs.length; pass += 1) {
    let changed = false;
    for (const { base, quote, price } of spotPairs) {
      const baseUsd = usdPrices.get(base);
      const quoteUsd = usdPrices.get(quote);
      if (quoteUsd !== undefined && baseUsd === undefined) {
        usdPrices.set(base, price * quoteUsd);
        changed = true;
      }
      if (baseUsd !== undefined && quoteUsd === undefined) {
        usdPrices.set(quote, baseUsd / price);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // A perp mark is a real exchange price and is a safe fallback when an asset
  // has no direct spot/USDC midpoint in the current response.
  for (const [symbol, rawPrice] of Object.entries(referencePrices)) {
    if (symbol.includes("/")) continue;
    const normalized = symbol.toUpperCase();
    const price = Number(rawPrice);
    if (!usdPrices.has(normalized) && Number.isFinite(price) && price > 0) {
      usdPrices.set(normalized, price);
    }
  }
  return usdPrices;
};

export const derivePortfolioMarginSummary = (
  spotState: PortfolioMarginSpotStateInput,
  perpStates: PortfolioMarginPerpStateInput[],
  referencePrices: Record<string, number>,
): HyperliquidPortfolioMarginSummary => {
  const usdPrices = buildSpotUsdPriceMap(referencePrices);
  let portfolioValue = 0;
  let grossCollateralExposure = 0;
  let fullyPriced = true;

  for (const balance of spotState.balances) {
    const total = parseNumber(balance.total);
    if (total === 0) continue;
    const price = usdPrices.get(balance.coin.toUpperCase());
    if (price === undefined) {
      fullyPriced = false;
      continue;
    }
    const marketValue = total * price;
    portfolioValue += marketValue;
    const collateralLtv = parseCollateralLtv(balance.ltv);
    if (total > 0 && collateralLtv !== undefined && collateralLtv > 0) {
      grossCollateralExposure += marketValue;
    }
  }

  const totalPerpsNotional = perpStates.reduce(
    (total, state) =>
      total + Math.abs(parseNumber(state.marginSummary.totalNtlPos)),
    0,
  );
  const perpsMaintenanceMargin = perpStates.reduce(
    (total, state) => total + parseNumber(state.crossMaintenanceMarginUsed),
    0,
  );
  const unrealizedPnl = perpStates.reduce(
    (total, state) =>
      total +
      state.assetPositions.reduce(
        (stateTotal, entry) =>
          stateTotal + parseNumber(entry.position.unrealizedPnl),
        0,
      ),
    0,
  );
  const borrowRatios = spotState.tokenToPortfolioBorrowRatio?.map(([, ratio]) =>
    Math.max(0, parseNumber(ratio)),
  );
  const resolvedPortfolioValue = fullyPriced ? portfolioValue : undefined;

  return {
    marginRatio: parseOptionalNumber(spotState.portfolioMarginRatio),
    portfolioValue: resolvedPortfolioValue,
    unrealizedPnl,
    borrowCapUsed:
      borrowRatios === undefined
        ? undefined
        : borrowRatios.length === 0
          ? 0
          : Math.max(...borrowRatios),
    perpsMaintenanceMargin,
    accountLeverage:
      resolvedPortfolioValue !== undefined && resolvedPortfolioValue > 0
        ? (grossCollateralExposure + totalPerpsNotional) /
          resolvedPortfolioValue
        : undefined,
  };
};

export const marketSymbol = (symbol: string, marketType: "perp" | "spot") => {
  const trimmed = symbol.trim();
  if (marketType === "spot") {
    const [base, quote = "USDC"] = trimmed.split("/", 2);
    return `${base.toUpperCase()}/${quote.toUpperCase()}`;
  }
  const separator = trimmed.indexOf(":");
  if (separator > 0) {
    return `${trimmed.slice(0, separator).toLowerCase()}:${trimmed
      .slice(separator + 1)
      .toUpperCase()}`;
  }
  return trimmed.toUpperCase();
};

export type RawUserFill = Awaited<ReturnType<InfoClient["userFills"]>>[number];
export type RawUserFunding = Awaited<ReturnType<InfoClient["userFunding"]>>[number];
export type RawHistoricalOrder = Awaited<
  ReturnType<InfoClient["historicalOrders"]>
>[number];
export type RawTwapHistory = Awaited<ReturnType<InfoClient["twapHistory"]>>[number];
export type RawPortfolio = Awaited<ReturnType<InfoClient["portfolio"]>>;
export type RawUserFees = Awaited<ReturnType<InfoClient["userFees"]>>;
export type RawUserInterest = Awaited<
  ReturnType<InfoClient["userBorrowLendInterest"]>
>[number];
export type RawLedgerUpdate = Awaited<
  ReturnType<InfoClient["userNonFundingLedgerUpdates"]>
>[number];

export const accountDisplaySymbol = (
  symbol: string,
  converter: SymbolConverter | null = null,
) =>
  symbol.startsWith("@")
    ? converter?.getSymbolBySpotPairId(symbol) ?? symbol
    : symbol;

export const normalizeTradeFill = (
  fill: RawUserFill,
  converter: SymbolConverter | null = null,
): HyperliquidTradeFill => {
  const price = parseNumber(fill.px);
  const size = Math.abs(parseNumber(fill.sz));
  return {
    time: fill.time,
    symbol: accountDisplaySymbol(fill.coin, converter),
    direction: fill.dir,
    side: fill.side === "B" ? "buy" : "sell",
    price,
    size,
    tradeValue: price * size,
    fee: parseNumber(fill.fee),
    feeToken: fill.feeToken,
    closedPnl: parseNumber(fill.closedPnl),
    orderId: fill.oid,
  };
};

export const normalizeFundingPayment = (
  update: RawUserFunding,
  converter: SymbolConverter | null = null,
): HyperliquidFundingPayment => {
  const signedSize = parseNumber(update.delta.szi);
  return {
    time: update.time,
    symbol: accountDisplaySymbol(update.delta.coin, converter),
    size: Math.abs(signedSize),
    side: signedSize < 0 ? "short" : "long",
    payment: parseNumber(update.delta.usdc),
    rate: parseNumber(update.delta.fundingRate),
  };
};

export const normalizeHistoricalOrder = (
  entry: RawHistoricalOrder,
  converter: SymbolConverter | null = null,
): HyperliquidHistoricalOrder => {
  const order = entry.order;
  const size = Math.abs(parseNumber(order.origSz));
  const remainingSize = Math.abs(parseNumber(order.sz));
  const price = parseNumber(order.limitPx);
  return {
    time: entry.statusTimestamp,
    createdAt: order.timestamp,
    orderId: order.oid,
    symbol: accountDisplaySymbol(order.coin, converter),
    side: order.side === "B" ? "buy" : "sell",
    type: order.orderType,
    size,
    filledSize: Math.max(0, size - remainingSize),
    orderValue: size * price,
    price,
    reduceOnly: order.reduceOnly,
    triggerCondition: order.isTrigger
      ? `${order.triggerCondition} @ ${order.triggerPx}`
      : "--",
    tpsl: order.isPositionTpsl ? order.orderType : "--",
    status: entry.status,
  };
};

export const normalizeTwapOrder = (
  entry: RawTwapHistory,
  converter: SymbolConverter | null = null,
): HyperliquidTwapOrder | null => {
  if (
    entry.status.status !== "activated" &&
    entry.status.status !== "waitingForTrigger"
  ) {
    return null;
  }
  const state = entry.state;
  const executedSize = Math.abs(parseNumber(state.executedSz));
  const executedNotional = Math.abs(parseNumber(state.executedNtl));
  return {
    twapId: entry.twapId,
    symbol: accountDisplaySymbol(state.coin, converter),
    side: state.side === "B" ? "buy" : "sell",
    size: Math.abs(parseNumber(state.sz)),
    executedSize,
    averagePrice:
      executedSize > 0 ? executedNotional / executedSize : undefined,
    totalMinutes: state.minutes,
    triggerPrice:
      state.trigger === null ? undefined : parseNumber(state.trigger.px),
    stopPrice: state.stopPx === null ? undefined : parseNumber(state.stopPx),
    reduceOnly: state.reduceOnly,
    createdAt:
      state.timestamp > 0
        ? state.timestamp
        : entry.time < 1_000_000_000_000
          ? entry.time * 1_000
          : entry.time,
    status: entry.status.status,
  };
};

export const normalizePortfolioSnapshots = (response: RawPortfolio) => {
  const snapshots: Partial<
    Record<HyperliquidPortfolioPeriod, HyperliquidPortfolioSnapshot>
  > = {};
  for (const [period, data] of response) {
    snapshots[period] = {
      accountValueHistory: data.accountValueHistory.map(([time, value]) => ({
        time,
        value: parseNumber(value),
      })),
      pnlHistory: data.pnlHistory.map(([time, value]) => ({
        time,
        value: parseNumber(value),
      })),
      volume: parseNumber(data.vlm),
    };
  }
  return snapshots;
};

export const normalizeFeeSummary = (response: RawUserFees): HyperliquidFeeSummary => {
  const volume14d = response.dailyUserVlm
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14)
    .reduce(
      (total, day) =>
        total + parseNumber(day.userCross) + parseNumber(day.userAdd),
      0,
    );
  return {
    volume14d,
    perpTakerRate: parseNumber(response.userCrossRate),
    perpMakerRate: parseNumber(response.userAddRate),
    spotTakerRate: parseNumber(response.userSpotCrossRate),
    spotMakerRate: parseNumber(response.userSpotAddRate),
  };
};

export const normalizeInterestPayment = (
  payment: RawUserInterest,
): HyperliquidInterestPayment => ({
  time: payment.time,
  asset: payment.token,
  paid: Math.abs(parseNumber(payment.borrow)),
  earned: Math.abs(parseNumber(payment.supply)),
});

export const shortLedgerAddress = (address: string) =>
  address.length > 10
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;

export const ledgerAccountLabel = (address: string, user: string) =>
  address.toLowerCase() === user.toLowerCase()
    ? "Trading Account"
    : shortLedgerAddress(address);

export const normalizeAccountTransfer = (
  update: RawLedgerUpdate,
  user: string,
): HyperliquidAccountTransfer | null => {
  const delta = update.delta;
  switch (delta.type) {
    case "deposit":
      return {
        time: update.time,
        status: "Complete",
        action: "Deposit",
        source: "Arbitrum",
        destination: "Trading Account",
        amount: parseNumber(delta.usdc),
        asset: "USDC",
      };
    case "withdraw":
      return {
        time: update.time,
        status: "Complete",
        action: "Withdraw",
        source: "Trading Account",
        destination: "Arbitrum",
        amount: -parseNumber(delta.usdc),
        asset: "USDC",
        fee: parseNumber(delta.fee),
        feeAsset: "USDC",
      };
    case "accountClassTransfer":
      return {
        time: update.time,
        status: "Complete",
        action: "Transfer",
        source: delta.toPerp ? "Spot" : "Perps",
        destination: delta.toPerp ? "Perps" : "Spot",
        amount: parseNumber(delta.usdc),
        asset: "USDC",
      };
    case "internalTransfer": {
      const outgoing = delta.user.toLowerCase() === user.toLowerCase();
      return {
        time: update.time,
        status: "Complete",
        action: "Transfer",
        source: ledgerAccountLabel(delta.user, user),
        destination: ledgerAccountLabel(delta.destination, user),
        amount: parseNumber(delta.usdc) * (outgoing ? -1 : 1),
        asset: "USDC",
        fee: parseNumber(delta.fee),
        feeAsset: "USDC",
      };
    }
    case "subAccountTransfer": {
      const outgoing = delta.user.toLowerCase() === user.toLowerCase();
      return {
        time: update.time,
        status: "Complete",
        action: "Transfer",
        source: ledgerAccountLabel(delta.user, user),
        destination: ledgerAccountLabel(delta.destination, user),
        amount: parseNumber(delta.usdc) * (outgoing ? -1 : 1),
        asset: "USDC",
      };
    }
    case "spotTransfer": {
      const outgoing = delta.user.toLowerCase() === user.toLowerCase();
      return {
        time: update.time,
        status: "Complete",
        action: "Transfer",
        source: ledgerAccountLabel(delta.user, user),
        destination: ledgerAccountLabel(delta.destination, user),
        amount: parseNumber(delta.amount) * (outgoing ? -1 : 1),
        asset: delta.token,
        fee: parseNumber(delta.nativeTokenFee || delta.fee),
        feeAsset: delta.feeToken,
      };
    }
    case "send": {
      const outgoing = delta.user.toLowerCase() === user.toLowerCase();
      return {
        time: update.time,
        status: "Complete",
        action: "Transfer",
        source: ledgerAccountLabel(delta.user, user),
        destination: ledgerAccountLabel(delta.destination, user),
        amount: parseNumber(delta.amount) * (outgoing ? -1 : 1),
        asset: delta.token,
        fee: parseNumber(delta.nativeTokenFee || delta.fee),
        feeAsset: delta.feeToken,
      };
    }
    case "vaultCreate":
    case "vaultDeposit":
      return {
        time: update.time,
        status: "Complete",
        action: delta.type === "vaultCreate" ? "Create Vault" : "Vault Deposit",
        source: "Trading Account",
        destination: "Vault",
        amount: -parseNumber(delta.usdc),
        asset: "USDC",
        fee: delta.type === "vaultCreate" ? parseNumber(delta.fee) : undefined,
        feeAsset: delta.type === "vaultCreate" ? "USDC" : undefined,
      };
    case "vaultWithdraw":
      return {
        time: update.time,
        status: "Complete",
        action: "Vault Withdraw",
        source: "Vault",
        destination: "Trading Account",
        amount: parseNumber(delta.netWithdrawnUsd),
        asset: "USDC",
        fee: parseNumber(delta.commission) + parseNumber(delta.closingCost),
        feeAsset: "USDC",
      };
    case "cStakingTransfer":
      return {
        time: update.time,
        status: "Complete",
        action: delta.isDeposit ? "Stake" : "Unstake",
        source: delta.isDeposit ? "Trading Account" : "Staking",
        destination: delta.isDeposit ? "Staking" : "Trading Account",
        amount: parseNumber(delta.amount) * (delta.isDeposit ? -1 : 1),
        asset: delta.token,
      };
    case "vaultDistribution":
      return {
        time: update.time,
        status: "Complete",
        action: "Vault Distribution",
        source: "Vault",
        destination: "Trading Account",
        amount: parseNumber(delta.usdc),
        asset: "USDC",
      };
    case "rewardsClaim":
      return {
        time: update.time,
        status: "Complete",
        action: "Rewards Claim",
        source: "Rewards",
        destination: "Trading Account",
        amount: parseNumber(delta.amount),
        asset: delta.token,
      };
    case "borrowLend": {
      const incoming =
        delta.operation === "borrow" || delta.operation === "withdraw";
      return {
        time: update.time,
        status: "Complete",
        action: delta.operation.replace(/^./u, (character) =>
          character.toUpperCase(),
        ),
        source: incoming ? "Lending" : "Trading Account",
        destination: incoming ? "Trading Account" : "Lending",
        amount: parseNumber(delta.amount) * (incoming ? 1 : -1),
        asset: delta.token,
      };
    }
    default:
      return null;
  }
};
