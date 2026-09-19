export type HyperliquidNetwork = "testnet" | "mainnet";
export type HyperliquidAccountMode =
  | "default"
  | "disabled"
  | "unifiedAccount"
  | "portfolioMargin";

export type HyperliquidLiveOrder = {
  oid: number;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  price: number;
  size: number;
  originalSize: number;
  createdAt: number;
  reduceOnly: boolean;
  isTrigger: boolean;
  isPositionTpsl: boolean;
  orderType: string;
  triggerPrice?: number;
};

export type HyperliquidLivePosition = {
  symbol: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  marginType: "isolated" | "cross";
  liquidationPrice?: number;
  marginUsed: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  cumulativeFunding: number;
};

export type HyperliquidTradeFill = {
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
  orderId: number;
};

export type HyperliquidFundingPayment = {
  time: number;
  symbol: string;
  size: number;
  side: "long" | "short";
  payment: number;
  rate: number;
};

export type HyperliquidHistoricalOrder = {
  time: number;
  createdAt: number;
  orderId: number;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  size: number;
  filledSize: number;
  orderValue: number;
  price: number;
  reduceOnly: boolean;
  triggerCondition: string;
  tpsl: string;
  status: string;
};

export type HyperliquidTwapOrder = {
  twapId?: number;
  symbol: string;
  side: "buy" | "sell";
  size: number;
  executedSize: number;
  averagePrice?: number;
  totalMinutes: number;
  triggerPrice?: number;
  stopPrice?: number;
  reduceOnly: boolean;
  createdAt: number;
  status: "activated" | "waitingForTrigger";
};

export type HyperliquidPortfolioPeriod =
  | "day"
  | "week"
  | "month"
  | "allTime"
  | "perpDay"
  | "perpWeek"
  | "perpMonth"
  | "perpAllTime";

export type HyperliquidPortfolioSnapshot = {
  accountValueHistory: Array<{ time: number; value: number }>;
  pnlHistory: Array<{ time: number; value: number }>;
  volume: number;
};

export type HyperliquidFeeSummary = {
  volume14d: number;
  perpTakerRate: number;
  perpMakerRate: number;
  spotTakerRate: number;
  spotMakerRate: number;
};

export type HyperliquidPortfolioMarginSummary = {
  marginRatio?: number;
  portfolioValue?: number;
  unrealizedPnl: number;
  borrowCapUsed?: number;
  perpsMaintenanceMargin: number;
  accountLeverage?: number;
};

export type HyperliquidInterestPayment = {
  time: number;
  asset: string;
  paid: number;
  earned: number;
};

export type HyperliquidAccountTransfer = {
  time: number;
  status: "Complete";
  action: string;
  source: string;
  destination: string;
  amount: number;
  asset: string;
  fee?: number;
  feeAsset?: string;
};

export type HyperliquidConnection = {
  network: HyperliquidNetwork;
  masterAddress: `0x${string}`;
  agentAddress: `0x${string}`;
  agentName?: string;
  agentValidUntil?: number;
};

export type ConnectInput = {
  network?: HyperliquidNetwork;
  masterAddress?: string;
  apiWalletPrivateKey: string;
};

export type PlaceOrderInput = {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  size: number;
  price?: number;
  leverage?: number;
  marginType?: "isolated" | "cross";
  reduceOnly?: boolean;
  marketType?: "perp" | "spot";
};

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };
