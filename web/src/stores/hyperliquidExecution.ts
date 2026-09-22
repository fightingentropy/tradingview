import { reconcileInBackground } from "../lib/backgroundReconcile";
import type {
  HttpTransport,
  InfoClient,
  WebSocketTransport,
} from "@nktkas/hyperliquid";
import type { ExchangeSingleWalletConfig } from "@nktkas/hyperliquid/api/exchange";
import type { SymbolConverter } from "@nktkas/hyperliquid/utils";
import { createMemo, createRoot, createSignal, onCleanup } from "solid-js";
import { resolveApiWalletAccount } from "../lib/apiWalletAccount";
import { availableSpotBalance, borrowedSpotBalance, derivePortfolioMarginSummary, marketSymbol, normalizeAccountTransfer, normalizeCumulativeFunding, normalizeFeeSummary, normalizeFundingPayment, normalizeHistoricalOrder, normalizeInterestPayment, normalizePortfolioSnapshots, normalizeTradeFill, normalizeTwapOrder, parseCollateralLtv, parseNumber, requiresMaintenanceAvailability } from "../lib/hyperliquidAccountData";
import { setHyperliquidDataNetwork } from "../lib/hyperliquidNetwork";

type HyperliquidExecutionSdk=
  typeof import("../lib/hyperliquidExecutionSdk");

let hyperliquidExecutionSdkPromise: Promise<HyperliquidExecutionSdk>|null=
  null;

const loadHyperliquidExecutionSdk=() => {
  hyperliquidExecutionSdkPromise??=import(
    "../lib/hyperliquidExecutionSdk"
  );
  return hyperliquidExecutionSdkPromise;
};

export const preloadHyperliquidExecutionSdk=() => {
  void loadHyperliquidExecutionSdk();
};

import type { ActionResult, ConnectInput, HyperliquidAccountMode, HyperliquidAccountTransfer, HyperliquidConnection, HyperliquidFeeSummary, HyperliquidFundingPayment, HyperliquidHistoricalOrder, HyperliquidInterestPayment, HyperliquidLiveOrder, HyperliquidLivePosition, HyperliquidNetwork, HyperliquidPortfolioMarginSummary, HyperliquidPortfolioPeriod, HyperliquidPortfolioSnapshot, HyperliquidTradeFill, HyperliquidTwapOrder, PlaceOrderInput } from "../lib/hyperliquidExecutionTypes";
export type * from "../lib/hyperliquidExecutionTypes";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;
const NONCE_STORAGE_PREFIX = "trade-xyz-hyperliquid-nonce-v1";
const ACCOUNT_REFRESH_MS = 15_000;
const ACTIVITY_REFRESH_MS = 60_000;
const PORTFOLIO_REFRESH_MS = 60_000;
const FUNDING_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
const PORTFOLIO_HISTORY_LOOKBACK_MS = 90 * 24 * 60 * 60_000;
const DEFAULT_MAX_SLIPPAGE_BPS = 100;
const REQUEST_EXPIRY_MS = 30_000;
const ORDER_RECONCILIATION_DELAYS_MS = [0, 300, 900] as const;

export const HYPERLIQUID_MARKET_SLIPPAGE_PERCENT =
  DEFAULT_MAX_SLIPPAGE_BPS / 100;

let exchangeConfig: ExchangeSingleWalletConfig<HttpTransport> | null = null;
let infoClient: InfoClient | null = null;
let symbolConverter: SymbolConverter | null = null;
let rawOpenOrders: HyperliquidLiveOrder[] = [];
let leverageCache = new Map<string, string>();
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let refreshEpoch = 0;
let refreshInFlight: { epoch: number; promise: Promise<void> } | null = null;
let activityRefreshInFlight: {
  epoch: number;
  promise: Promise<void>;
} | null = null;
let portfolioRefreshInFlight: {
  epoch: number;
  promise: Promise<void>;
} | null = null;
let connectionAttemptEpoch = 0;
let relevantPerpDexs = new Set<string>([""]);
let perpDexIndexByName = new Map<string, number>();
let namedPerpAssets = new Map<string, ResolvedAsset>();
let namedPerpMetadataLoads = new Map<string, Promise<void>>();
let loadedNamedPerpDexs = new Set<string>();
let referencePriceCache: Record<string, number> = {};
let dexAccountSnapshotCache = new Map<string, PerpDexAccountSnapshot>();
let dexDiscoveryTransport: WebSocketTransport | null = null;
let dexDiscoverySubscriptions: {
  unsubscribe: () => Promise<void>;
}[] = [];
let dexDiscoveryEpoch = 0;
let releaseExecutionSessionLock: (() => void) | null = null;
let executionSessionLockTask: Promise<void> | null = null;
let executionSessionLockEpoch = 0;

type PerpDexAccountSnapshot = {
  dex: string;
  state: Awaited<ReturnType<InfoClient["clearinghouseState"]>>;
  orders: Awaited<ReturnType<InfoClient["frontendOpenOrders"]>>;
};

const normalizeAddress = (value: string): `0x${string}` | null => {
  const trimmed = value.trim();
  return ADDRESS_PATTERN.test(trimmed)
    ? (trimmed.toLowerCase() as `0x${string}`)
    : null;
};

const normalizePrivateKey = (value: string): `0x${string}` | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("0x") || !PRIVATE_KEY_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed as `0x${string}`;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};

const orderStatusError = (response: unknown): string | null => {
  if (!response || typeof response !== "object") {
    return "Hyperliquid returned an invalid order response.";
  }
  const statuses = (
    response as {
      response?: { data?: { statuses?: unknown[] } };
    }
  ).response?.data?.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return "Hyperliquid did not return an order status.";
  }
  const errors = statuses.flatMap((status) => {
    if (!status || typeof status !== "object") return [];
    const message = (status as { error?: unknown }).error;
    return typeof message === "string" && message.trim() ? [message] : [];
  });
  return errors.length > 0 ? errors.join("; ") : null;
};

const createNonceManager = (network: HyperliquidNetwork) => {
  let lastNonce = 0;
  return async (address: string): Promise<number> => {
    const storageKey = `${NONCE_STORAGE_PREFIX}:${network}:${address.toLowerCase()}`;
    const allocate = () => {
      let storedNonce = 0;
      try {
        storedNonce = Number(globalThis.localStorage?.getItem(storageKey) ?? 0);
      } catch {
        // The in-memory value is still safe because a live API wallet session is
        // held by one tab at a time below. Persistence is only crash recovery.
      }
      const previous = Number.isSafeInteger(storedNonce)
        ? Math.max(storedNonce, lastNonce)
        : lastNonce;
      const next = Math.max(Date.now(), previous + 1);
      lastNonce = next;
      try {
        globalThis.localStorage?.setItem(storageKey, String(next));
      } catch {
        // See the note above: do not block trading solely because storage is
        // unavailable after the exclusive session lock has been acquired.
      }
      return next;
    };

    if (typeof navigator === "undefined" || !navigator.locks) {
      throw new Error(
        "This browser cannot safely connect for trading. Try another up-to-date browser.",
      );
    }
    return await navigator.locks.request(storageKey, allocate);
  };
};

const acquireExecutionSessionLock = async (
  network: HyperliquidNetwork,
  agentAddress: string,
): Promise<number> => {
  if (typeof navigator === "undefined" || !navigator.locks) {
    throw new Error(
      "This browser cannot safely connect for trading. Try another up-to-date browser.",
    );
  }
  if (releaseExecutionSessionLock || executionSessionLockTask) {
    throw new Error("Disconnect your current account first.");
  }

  const lockName = `${NONCE_STORAGE_PREFIX}:session:${network}:${agentAddress.toLowerCase()}`;
  const lockEpoch = ++executionSessionLockEpoch;
  let signalAcquired: (acquired: boolean) => void = () => undefined;
  const acquired = new Promise<boolean>((resolve) => {
    signalAcquired = resolve;
  });
  let signalRelease: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    signalRelease = resolve;
  });

  const lockTask = navigator.locks.request(
    lockName,
    { ifAvailable: true, mode: "exclusive" },
    async (lock) => {
      if (!lock || lockEpoch !== executionSessionLockEpoch) {
        signalAcquired(false);
        return;
      }
      releaseExecutionSessionLock = signalRelease;
      signalAcquired(true);
      await released;
    },
  );
  executionSessionLockTask = lockTask;
  void lockTask.catch(() => signalAcquired(false));

  if (!(await acquired)) {
    await lockTask.catch(() => undefined);
    if (executionSessionLockTask === lockTask) {
      executionSessionLockTask = null;
    }
    if (lockEpoch !== executionSessionLockEpoch) {
      throw new Error("Connection canceled. Please try again.");
    }
    throw new Error(
      "This API key is already connected in another tab. Disconnect it there first.",
    );
  }
  return lockEpoch;
};

const releaseSessionLock = (expectedEpoch?: number) => {
  if (
    expectedEpoch !== undefined &&
    expectedEpoch !== executionSessionLockEpoch
  ) {
    return;
  }
  executionSessionLockEpoch += 1;
  const release = releaseExecutionSessionLock;
  const task = executionSessionLockTask;
  releaseExecutionSessionLock = null;
  executionSessionLockTask = null;
  release?.();
  void task?.catch(() => undefined);
};

const stopDexDiscovery = () => {
  dexDiscoveryEpoch += 1;
  const subscriptions = dexDiscoverySubscriptions;
  const transport = dexDiscoveryTransport;
  dexDiscoverySubscriptions = [];
  dexDiscoveryTransport = null;
  for (const subscription of subscriptions) {
    void subscription.unsubscribe().catch(() => undefined);
  }
  transport?.close();
};

const perpDexForSymbol = (symbol: string): string => {
  const separator = symbol.indexOf(":");
  return separator > 0 ? symbol.slice(0, separator) : "";
};

const trackedPerpDexsForRefresh = (dexs: Iterable<string>) => [
  "",
  ...new Set([...dexs].filter(Boolean)),
];

const shouldUpdateLeverage = (input: PlaceOrderInput) =>
  (input.marketType ?? "perp") === "perp" &&
  input.reduceOnly !== true &&
  typeof input.leverage === "number" &&
  Number.isFinite(input.leverage) &&
  input.leverage > 0 &&
  input.marginType !== undefined;

const validTriggerPrice = (value: number | null | undefined) =>
  value == null || (Number.isFinite(value) && value > 0);

const positionTriggerDirectionError = (
  position: Pick<HyperliquidLivePosition, "size" | "markPrice">,
  takeProfit?: number | null,
  stopLoss?: number | null,
): string | null => {
  if (position.markPrice <= 0) return null;
  if (position.size > 0) {
    if (takeProfit != null && takeProfit <= position.markPrice) {
      return "A long-position take profit must be above the current mark price.";
    }
    if (stopLoss != null && stopLoss >= position.markPrice) {
      return "A long-position stop loss must be below the current mark price.";
    }
  } else {
    if (takeProfit != null && takeProfit >= position.markPrice) {
      return "A short-position take profit must be below the current mark price.";
    }
    if (stopLoss != null && stopLoss <= position.markPrice) {
      return "A short-position stop loss must be above the current mark price.";
    }
  }
  return null;
};

const positionTpslOrdersForSymbol = (
  orders: HyperliquidLiveOrder[],
  symbol: string,
) =>
  orders.filter(
    (item) =>
      item.symbol === symbol &&
      item.isTrigger &&
      item.reduceOnly &&
      item.isPositionTpsl,
  );

const wait = async (delayMs: number) => {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

const makeCloid = (): `0x${string}` =>
  `0x${crypto.randomUUID().replaceAll("-", "")}` as `0x${string}`;

const ensureClients = () => {
  if (!exchangeConfig || !infoClient || !symbolConverter) {
    throw new Error("Connect an approved Hyperliquid API wallet first.");
  }
  return { exchangeConfig, infoClient, symbolConverter };
};

const {
  connection,
  connectionStatus,
  connectionError,
  accountMode,
  accountRefreshError,
  lastAccountRefreshAt,
  liveOpenOrders,
  livePositions,
  liveReferencePrices,
  liveSpotBalances,
  liveSpotAvailableBalances,
  liveSpotBorrowedBalances,
  liveSpotCollateralLtvs,
  liveWithdrawable,
  liveAccountValue,
  livePortfolioMarginSummary,
  liveTradeFills,
  liveFundingPayments,
  liveHistoricalOrders,
  liveTwapOrders,
  activityRefreshPending,
  activityRefreshError,
  lastActivityRefreshAt,
  livePortfolioSnapshots,
  liveFeeSummary,
  liveInterestPayments,
  liveAccountTransfers,
  portfolioRefreshPending,
  portfolioRefreshError,
  lastPortfolioRefreshAt,
  isHyperliquidConnected,
  isHyperliquidExecution,
  setExecutionEnabled,
  connectHyperliquid,
  disconnectHyperliquid,
  refreshHyperliquidAccount,
  refreshHyperliquidActivity,
  refreshHyperliquidPortfolio,
  setHyperliquidAccountMode,
} = createRoot(() => {
  const [connection, setConnection] =
    createSignal<HyperliquidConnection | null>(null);
  const [connectionStatus, setConnectionStatus] = createSignal<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [connectionError, setConnectionError] = createSignal<string>();
  const [accountMode, setAccountMode] =
    createSignal<HyperliquidAccountMode>("default");
  const [accountRefreshError, setAccountRefreshError] = createSignal<string>();
  const [lastAccountRefreshAt, setLastAccountRefreshAt] = createSignal<number>();
  const [liveOpenOrders, setLiveOpenOrders] = createSignal<
    HyperliquidLiveOrder[]
  >([]);
  const [livePositions, setLivePositions] = createSignal<
    HyperliquidLivePosition[]
  >([]);
  const [liveReferencePrices, setLiveReferencePrices] = createSignal<
    Record<string, number>
  >({});
  const [liveSpotBalances, setLiveSpotBalances] = createSignal<
    Record<string, number>
  >({});
  const [liveSpotAvailableBalances, setLiveSpotAvailableBalances] =
    createSignal<Record<string, number>>({});
  const [liveSpotBorrowedBalances, setLiveSpotBorrowedBalances] = createSignal<
    Record<string, number>
  >({});
  const [liveSpotCollateralLtvs, setLiveSpotCollateralLtvs] = createSignal<
    Record<string, number>
  >({});
  const [liveWithdrawable, setLiveWithdrawable] = createSignal(0);
  const [liveAccountValue, setLiveAccountValue] = createSignal(0);
  const [livePortfolioMarginSummary, setLivePortfolioMarginSummary] =
    createSignal<HyperliquidPortfolioMarginSummary>();
  const [liveTradeFills, setLiveTradeFills] = createSignal<
    HyperliquidTradeFill[]
  >([]);
  const [liveFundingPayments, setLiveFundingPayments] = createSignal<
    HyperliquidFundingPayment[]
  >([]);
  const [liveHistoricalOrders, setLiveHistoricalOrders] = createSignal<
    HyperliquidHistoricalOrder[]
  >([]);
  const [liveTwapOrders, setLiveTwapOrders] = createSignal<
    HyperliquidTwapOrder[]
  >([]);
  const [activityRefreshPending, setActivityRefreshPending] =
    createSignal(false);
  const [activityRefreshError, setActivityRefreshError] =
    createSignal<string>();
  const [lastActivityRefreshAt, setLastActivityRefreshAt] =
    createSignal<number>();
  const [livePortfolioSnapshots, setLivePortfolioSnapshots] = createSignal<
    Partial<Record<HyperliquidPortfolioPeriod, HyperliquidPortfolioSnapshot>>
  >({});
  const [liveFeeSummary, setLiveFeeSummary] =
    createSignal<HyperliquidFeeSummary>();
  const [liveInterestPayments, setLiveInterestPayments] = createSignal<
    HyperliquidInterestPayment[]
  >([]);
  const [liveAccountTransfers, setLiveAccountTransfers] = createSignal<
    HyperliquidAccountTransfer[]
  >([]);
  const [portfolioRefreshPending, setPortfolioRefreshPending] =
    createSignal(false);
  const [portfolioRefreshError, setPortfolioRefreshError] =
    createSignal<string>();
  const [lastPortfolioRefreshAt, setLastPortfolioRefreshAt] =
    createSignal<number>();
  const [executionEnabled, setExecutionEnabledSignal] = createSignal(false);

  const isHyperliquidConnected = createMemo(
    () => connectionStatus() === "connected" && connection() !== null,
  );
  const isHyperliquidExecution = createMemo(
    () => isHyperliquidConnected() && executionEnabled(),
  );

  const setExecutionEnabled = (enabled: boolean) => {
    const activeConnection = connection();
    const nextEnabled = enabled && activeConnection !== null;
    setExecutionEnabledSignal(nextEnabled);
    setHyperliquidDataNetwork(
      nextEnabled ? activeConnection.network : "mainnet",
    );
  };

  const stopRefreshTimer = () => {
    if (refreshTimer !== undefined) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
  };

  const resetLiveState = () => {
    setAccountMode("default");
    setAccountRefreshError(undefined);
    setLastAccountRefreshAt(undefined);
    setLiveOpenOrders([]);
    setLivePositions([]);
    setLiveReferencePrices({});
    setLiveSpotBalances({});
    setLiveSpotAvailableBalances({});
    setLiveSpotBorrowedBalances({});
    setLiveSpotCollateralLtvs({});
    setLiveWithdrawable(0);
    setLiveAccountValue(0);
    setLivePortfolioMarginSummary(undefined);
    setLiveTradeFills([]);
    setLiveFundingPayments([]);
    setLiveHistoricalOrders([]);
    setLiveTwapOrders([]);
    setActivityRefreshPending(false);
    setActivityRefreshError(undefined);
    setLastActivityRefreshAt(undefined);
    activityRefreshInFlight = null;
    setLivePortfolioSnapshots({});
    setLiveFeeSummary(undefined);
    setLiveInterestPayments([]);
    setLiveAccountTransfers([]);
    setPortfolioRefreshPending(false);
    setPortfolioRefreshError(undefined);
    setLastPortfolioRefreshAt(undefined);
    portfolioRefreshInFlight = null;
    rawOpenOrders = [];
    leverageCache = new Map();
    relevantPerpDexs = new Set([""]);
    perpDexIndexByName = new Map();
    namedPerpAssets = new Map();
    namedPerpMetadataLoads = new Map();
    loadedNamedPerpDexs = new Set();
    referencePriceCache = {};
    dexAccountSnapshotCache = new Map();
  };

  const disconnectHyperliquid = () => {
    stopRefreshTimer();
    connectionAttemptEpoch += 1;
    refreshEpoch += 1;
    refreshInFlight = null;
    stopDexDiscovery();
    releaseSessionLock();
    setHyperliquidDataNetwork("mainnet");
    exchangeConfig = null;
    infoClient = null;
    symbolConverter = null;
    setConnection(null);
    setConnectionStatus("disconnected");
    setConnectionError(undefined);
    setExecutionEnabled(false);
    resetLiveState();
  };

  const fetchPerpDexAccountSnapshot = async (
    client: InfoClient,
    user: `0x${string}`,
    dex: string,
  ): Promise<PerpDexAccountSnapshot> => {
    const [state, orders] = await Promise.all([
      client.clearinghouseState({ user, dex }),
      client.frontendOpenOrders({ user, dex }),
    ]);
    return { dex, state, orders };
  };

  const startDexDiscovery = async (
    activeConnection: HyperliquidConnection,
  ) => {
    stopDexDiscovery();
    const discoveryEpoch = dexDiscoveryEpoch;
    const { SubscriptionClient, WebSocketTransport } =
      await loadHyperliquidExecutionSdk();
    if (
      dexDiscoveryEpoch !== discoveryEpoch ||
      connection() !== activeConnection
    ) {
      return;
    }
    const transport = new WebSocketTransport({
      isTestnet: activeConnection.network === "testnet",
    });
    dexDiscoveryTransport = transport;
    try {
      const client = new SubscriptionClient({ transport });
      const markRelevantDex = (dex: string) => {
        if (
          !dex ||
          dexDiscoveryEpoch !== discoveryEpoch ||
          connection() !== activeConnection ||
          relevantPerpDexs.has(dex)
        ) {
          return false;
        }
        relevantPerpDexs.add(dex);
        return true;
      };
      const subscriptions = (
        await Promise.allSettled([
          client.allDexsClearinghouseState(
            { user: activeConnection.masterAddress },
            (event) => {
              let foundNewDex = false;
              for (const [dex, state] of event.clearinghouseStates) {
                if (
                  state.assetPositions.some(
                    (entry) => parseNumber(entry.position.szi) !== 0,
                  )
                ) {
                  foundNewDex = markRelevantDex(dex) || foundNewDex;
                }
              }
              if (foundNewDex) void refreshHyperliquidAccount();
            },
            { onError: () => undefined },
          ),
          client.orderUpdates(
            { user: activeConnection.masterAddress },
            (events) => {
              let foundNewDex = false;
              for (const event of events) {
                if (event.status === "open" || event.status === "triggered") {
                  foundNewDex =
                    markRelevantDex(perpDexForSymbol(event.order.coin)) ||
                    foundNewDex;
                }
              }
              if (foundNewDex) void refreshHyperliquidAccount();
            },
            { onError: () => undefined },
          ),
        ])
      ).flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (
        dexDiscoveryEpoch !== discoveryEpoch ||
        connection() !== activeConnection
      ) {
        await Promise.all(
          subscriptions.map((subscription) =>
            subscription.unsubscribe().catch(() => undefined),
          ),
        );
        transport.close();
        return;
      }
      if (subscriptions.length === 0) {
        dexDiscoveryTransport = null;
        transport.close();
        return;
      }
      dexDiscoverySubscriptions = subscriptions;
    } catch {
      if (dexDiscoveryEpoch === discoveryEpoch) {
        dexDiscoveryTransport = null;
      }
      transport.close();
      // A blocked or unavailable WebSocket must not prevent the API-wallet
      // session from operating on the default and explicitly tracked DEXes.
    }
  };

  const refreshHyperliquidAccount = async (): Promise<void> => {
    const epoch = refreshEpoch;
    if (refreshInFlight?.epoch === epoch) {
      return await refreshInFlight.promise;
    }
    const activeConnection = connection();
    const activeInfoClient = infoClient;
    if (!activeConnection || !activeInfoClient) return;

    const inFlight = {
      epoch,
      promise: Promise.resolve(),
    };
    inFlight.promise = (async () => {
      try {
        const user = activeConnection.masterAddress;
        const trackedDexs = trackedPerpDexsForRefresh(relevantPerpDexs);
        const namedDexs = trackedDexs.filter(Boolean);

        const [required, namedSnapshotResults, midResults] = await Promise.all([
          Promise.all([
            activeInfoClient.userAbstraction({ user }),
            activeInfoClient.spotClearinghouseState({ user }),
            fetchPerpDexAccountSnapshot(activeInfoClient, user, ""),
          ]),
          Promise.allSettled(
            namedDexs.map((dex) =>
              fetchPerpDexAccountSnapshot(activeInfoClient, user, dex),
            ),
          ),
          Promise.allSettled(
            trackedDexs.map((dex) => activeInfoClient.allMids({ dex })),
          ),
        ]);
        const [mode, spotState, defaultSnapshot] = required;

        dexAccountSnapshotCache.set("", defaultSnapshot);
        namedSnapshotResults.forEach((result, index) => {
          if (result.status === "fulfilled") {
            dexAccountSnapshotCache.set(namedDexs[index], result.value);
          }
        });
        const temporarilyUnavailableDexs = namedSnapshotResults.flatMap(
          (result, index) =>
            result.status === "rejected" ? [namedDexs[index]] : [],
        );
        const dexSnapshots = trackedDexs.flatMap((dex) => {
          const snapshot = dexAccountSnapshotCache.get(dex);
          return snapshot ? [snapshot] : [];
        });
        const clearinghouseStates = dexSnapshots.map(
          (snapshot) => snapshot.state,
        );
        const frontendOrders = dexSnapshots.flatMap(
          (snapshot) => snapshot.orders,
        );

        const converter = symbolConverter;
        const nextReferencePrices: Record<string, number> = {
          ...referencePriceCache,
        };
        midResults.forEach((result) => {
          if (result.status !== "fulfilled") return;
          for (const [midSymbol, rawPrice] of Object.entries(result.value)) {
            const symbol =
              midSymbol.startsWith("@") && converter
                ? converter.getSymbolBySpotPairId(midSymbol) ?? midSymbol
                : midSymbol;
            const price = parseNumber(rawPrice);
            if (price > 0) nextReferencePrices[symbol] = price;
          }
        });
        referencePriceCache = nextReferencePrices;

        const nextPositions: HyperliquidLivePosition[] = [];
        for (const state of clearinghouseStates) {
          for (const entry of state.assetPositions) {
            const position = entry.position;
            const size = parseNumber(position.szi);
            if (size === 0) continue;
            const referenceMark = parseNumber(
              nextReferencePrices[position.coin],
            );
            const impliedMark = Math.abs(
              parseNumber(position.positionValue) / size,
            );
            nextPositions.push({
              symbol: position.coin,
              size,
              entryPrice: parseNumber(position.entryPx),
              markPrice: referenceMark > 0 ? referenceMark : impliedMark,
              leverage: position.leverage.value,
              marginType: position.leverage.type,
              liquidationPrice:
                position.liquidationPx == null
                  ? undefined
                  : parseNumber(position.liquidationPx),
              marginUsed: parseNumber(position.marginUsed),
              unrealizedPnl: parseNumber(position.unrealizedPnl),
              returnOnEquity: parseNumber(position.returnOnEquity) * 100,
              cumulativeFunding: normalizeCumulativeFunding(
                position.cumFunding.sinceOpen,
              ),
            });
          }
        }

        const nextOrders: HyperliquidLiveOrder[] = frontendOrders.map(
          (order) => ({
            oid: order.oid,
            symbol: order.coin,
            side: order.side === "B" ? "buy" : "sell",
            type: order.orderType === "Limit" ? "limit" : "market",
            price: parseNumber(order.limitPx),
            size: parseNumber(order.sz),
            originalSize: parseNumber(order.origSz),
            createdAt: order.timestamp,
            reduceOnly: order.reduceOnly,
            isTrigger: order.isTrigger,
            isPositionTpsl: order.isPositionTpsl,
            orderType: order.orderType,
            triggerPrice: order.isTrigger
              ? parseNumber(order.triggerPx)
              : undefined,
          }),
        );

        const nextSpotBalances: Record<string, number> = {};
        const nextSpotAvailableBalances: Record<string, number> = {};
        const nextSpotBorrowedBalances: Record<string, number> = {};
        const nextSpotCollateralLtvs: Record<string, number> = {};
        const availableAfterMaintenance = new Map(
          spotState.tokenToAvailableAfterMaintenance ?? [],
        );
        for (const balance of spotState.balances) {
          if (
            "token" in balance &&
            !balance.coin.startsWith("+") &&
            !balance.coin.startsWith("o")
          ) {
            const symbol = balance.coin.toUpperCase();
            const total = parseNumber(balance.total);
            const afterMaintenance = availableAfterMaintenance.get(
              balance.token,
            );
            nextSpotBalances[symbol] = total;
            nextSpotAvailableBalances[symbol] = availableSpotBalance(
              total,
              balance.hold,
              afterMaintenance,
              requiresMaintenanceAvailability(mode),
            );
            nextSpotBorrowedBalances[symbol] = borrowedSpotBalance(
              balance.borrowed,
              total,
            );
            const collateralLtv = parseCollateralLtv(balance.ltv);
            if (collateralLtv !== undefined) {
              nextSpotCollateralLtvs[symbol] = collateralLtv;
            }
          }
        }

        const primaryState = clearinghouseStates[0];
        const portfolioSummary =
          mode === "portfolioMargin"
            ? derivePortfolioMarginSummary(
                spotState,
                clearinghouseStates,
                nextReferencePrices,
              )
            : undefined;
        if (
          refreshEpoch !== epoch ||
          infoClient !== activeInfoClient ||
          connection() !== activeConnection
        ) {
          return;
        }
        setAccountMode(mode);
        setLivePositions(nextPositions);
        setLiveOpenOrders(nextOrders);
        setLiveReferencePrices(nextReferencePrices);
        rawOpenOrders = nextOrders;
        relevantPerpDexs = new Set([
          "",
          ...temporarilyUnavailableDexs,
          ...nextPositions.map((item) => perpDexForSymbol(item.symbol)),
          ...nextOrders.map((item) => perpDexForSymbol(item.symbol)),
        ]);
        setLiveSpotBalances(nextSpotBalances);
        setLiveSpotAvailableBalances(nextSpotAvailableBalances);
        setLiveSpotBorrowedBalances(nextSpotBorrowedBalances);
        setLiveSpotCollateralLtvs(nextSpotCollateralLtvs);
        setLiveWithdrawable(parseNumber(primaryState.withdrawable));
        setLiveAccountValue(
          mode === "portfolioMargin"
            ? (portfolioSummary?.portfolioValue ?? 0)
            : mode === "unifiedAccount"
              ? parseNumber(nextSpotBalances.USDC ?? 0)
            : parseNumber(primaryState.marginSummary.accountValue),
        );
        setLivePortfolioMarginSummary(portfolioSummary);
        setLastAccountRefreshAt(Date.now());
        setAccountRefreshError(undefined);
      } catch (error) {
        if (refreshEpoch !== epoch || infoClient !== activeInfoClient) return;
        setAccountRefreshError(
          getErrorMessage(error, "Could not refresh Hyperliquid account state."),
        );
      } finally {
        if (refreshInFlight === inFlight) refreshInFlight = null;
      }
    })();
    refreshInFlight = inFlight;
    return await inFlight.promise;
  };

  const refreshHyperliquidActivity = async (force = false): Promise<void> => {
    const epoch = refreshEpoch;
    const activeConnection = connection();
    const activeInfoClient = infoClient;
    if (!activeConnection || !activeInfoClient) return;
    const refreshedAt = lastActivityRefreshAt();
    if (
      !force &&
      refreshedAt !== undefined &&
      Date.now() - refreshedAt < ACTIVITY_REFRESH_MS
    ) {
      return;
    }
    if (activityRefreshInFlight?.epoch === epoch) {
      return await activityRefreshInFlight.promise;
    }

    const inFlight = { epoch, promise: Promise.resolve() };
    setActivityRefreshPending(true);
    setActivityRefreshError(undefined);
    inFlight.promise = (async () => {
      const user = activeConnection.masterAddress;
      const results = await Promise.allSettled([
        activeInfoClient.userFills({ user, aggregateByTime: true }),
        activeInfoClient.userFunding({
          user,
          startTime: Date.now() - FUNDING_LOOKBACK_MS,
        }),
        activeInfoClient.historicalOrders({ user }),
        activeInfoClient.twapHistory({ user }),
      ]);
      if (
        refreshEpoch !== epoch ||
        infoClient !== activeInfoClient ||
        connection() !== activeConnection
      ) {
        return;
      }

      const [fillsResult, fundingResult, ordersResult, twapResult] = results;
      if (fillsResult.status === "fulfilled") {
        setLiveTradeFills(
          fillsResult.value
            .map((fill) => normalizeTradeFill(fill, symbolConverter))
            .sort((a, b) => b.time - a.time),
        );
      }
      if (fundingResult.status === "fulfilled") {
        setLiveFundingPayments(
          fundingResult.value
            .map((update) => normalizeFundingPayment(update, symbolConverter))
            .sort((a, b) => b.time - a.time),
        );
      }
      if (ordersResult.status === "fulfilled") {
        setLiveHistoricalOrders(
          ordersResult.value
            .map((entry) => normalizeHistoricalOrder(entry, symbolConverter))
            .sort((a, b) => b.time - a.time),
        );
      }
      if (twapResult.status === "fulfilled") {
        setLiveTwapOrders(
          twapResult.value
            .map((entry) => normalizeTwapOrder(entry, symbolConverter))
            .filter(
              (entry): entry is HyperliquidTwapOrder => entry !== null,
            )
            .sort((a, b) => b.createdAt - a.createdAt),
        );
      }

      const failures = results.filter((result) => result.status === "rejected");
      setActivityRefreshError(
        failures.length > 0
          ? "Some Hyperliquid account history could not be refreshed."
          : undefined,
      );
      setLastActivityRefreshAt(Date.now());
    })()
      .catch((error) => {
        if (refreshEpoch !== epoch || infoClient !== activeInfoClient) return;
        setActivityRefreshError(
          getErrorMessage(
            error,
            "Could not refresh Hyperliquid account history.",
          ),
        );
      })
      .finally(() => {
        if (activityRefreshInFlight === inFlight) {
          activityRefreshInFlight = null;
          setActivityRefreshPending(false);
        }
      });
    activityRefreshInFlight = inFlight;
    return await inFlight.promise;
  };

  const refreshHyperliquidPortfolio = async (
    force = false,
  ): Promise<void> => {
    const epoch = refreshEpoch;
    const activeConnection = connection();
    const activeInfoClient = infoClient;
    if (!activeConnection || !activeInfoClient) return;
    const refreshedAt = lastPortfolioRefreshAt();
    if (
      !force &&
      refreshedAt !== undefined &&
      Date.now() - refreshedAt < PORTFOLIO_REFRESH_MS
    ) {
      return;
    }
    if (portfolioRefreshInFlight?.epoch === epoch) {
      return await portfolioRefreshInFlight.promise;
    }

    const inFlight = { epoch, promise: Promise.resolve() };
    setPortfolioRefreshPending(true);
    setPortfolioRefreshError(undefined);
    inFlight.promise = (async () => {
      const user = activeConnection.masterAddress;
      const historyStart = Date.now() - PORTFOLIO_HISTORY_LOOKBACK_MS;
      const results = await Promise.allSettled([
        activeInfoClient.portfolio({ user }),
        activeInfoClient.userFees({ user }),
        activeInfoClient.userBorrowLendInterest({
          user,
          startTime: historyStart,
        }),
        activeInfoClient.userNonFundingLedgerUpdates({
          user,
          startTime: historyStart,
        }),
      ]);
      if (
        refreshEpoch !== epoch ||
        infoClient !== activeInfoClient ||
        connection() !== activeConnection
      ) {
        return;
      }

      const [portfolioResult, feesResult, interestResult, transfersResult] =
        results;
      if (portfolioResult.status === "fulfilled") {
        setLivePortfolioSnapshots(
          normalizePortfolioSnapshots(portfolioResult.value),
        );
      }
      if (feesResult.status === "fulfilled") {
        setLiveFeeSummary(normalizeFeeSummary(feesResult.value));
      }
      if (interestResult.status === "fulfilled") {
        setLiveInterestPayments(
          interestResult.value
            .map(normalizeInterestPayment)
            .sort((a, b) => b.time - a.time),
        );
      }
      if (transfersResult.status === "fulfilled") {
        setLiveAccountTransfers(
          transfersResult.value
            .map((update) => normalizeAccountTransfer(update, user))
            .filter(
              (update): update is HyperliquidAccountTransfer => update !== null,
            )
            .sort((a, b) => b.time - a.time),
        );
      }

      const failures = results.filter((result) => result.status === "rejected");
      setPortfolioRefreshError(
        failures.length > 0
          ? "Some Hyperliquid portfolio data could not be refreshed."
          : undefined,
      );
      setLastPortfolioRefreshAt(Date.now());
    })()
      .catch((error) => {
        if (refreshEpoch !== epoch || infoClient !== activeInfoClient) return;
        setPortfolioRefreshError(
          getErrorMessage(error, "Could not refresh Hyperliquid portfolio data."),
        );
      })
      .finally(() => {
        if (portfolioRefreshInFlight === inFlight) {
          portfolioRefreshInFlight = null;
          setPortfolioRefreshPending(false);
        }
      });
    portfolioRefreshInFlight = inFlight;
    return await inFlight.promise;
  };

  const connectHyperliquid = async (input: ConnectInput): Promise<ActionResult> => {
    if (connectionStatus() !== "disconnected") {
      return {
        ok: false,
        error:
          connectionStatus() === "connecting"
            ? "A connection attempt is already in progress."
            : "Disconnect your current account first.",
      };
    }
    if (input.network !== undefined && input.network !== "mainnet") {
      return {
        ok: false,
        error: "This connection is no longer supported. Connect a key from your live Hyperliquid account.",
      };
    }
    const network = "mainnet";
    const expectedAccount = input.masterAddress
      ? normalizeAddress(input.masterAddress)
      : undefined;
    if (input.masterAddress && !expectedAccount) {
      return {
        ok: false,
        error: "The saved account address is invalid. Remove the saved connection and reconnect.",
      };
    }
    const privateKey = normalizePrivateKey(input.apiWalletPrivateKey);
    if (!privateKey) {
      return {
        ok: false,
        error: "That key looks incomplete. Copy the full API key from Hyperliquid’s API settings.",
      };
    }

    setConnectionStatus("connecting");
    setConnectionError(undefined);
    stopRefreshTimer();
    const attemptEpoch = ++connectionAttemptEpoch;

    try {
      const {
        HttpTransport,
        InfoClient,
        SymbolConverter,
        privateKeyToAccount,
      } = await loadHyperliquidExecutionSdk();
      if (
        attemptEpoch !== connectionAttemptEpoch ||
        connectionStatus() !== "connecting"
      ) {
        throw new Error("Connection canceled. Please try again.");
      }
      const wallet = privateKeyToAccount(privateKey);
      const transport = new HttpTransport({
        isTestnet: false,
        timeout: 12_000,
      });
      const nextInfoClient = new InfoClient({ transport });
      const role = await nextInfoClient.userRole({ user: wallet.address });
      const masterAddress = resolveApiWalletAccount(
        role,
        expectedAccount ?? undefined,
      );

      let agentName: string | undefined;
      let agentValidUntil: number | undefined;
      try {
        const agents = await nextInfoClient.extraAgents({ user: masterAddress });
        const approved = agents.find(
          (agent) => agent.address.toLowerCase() === wallet.address.toLowerCase(),
        );
        agentName = approved?.name || undefined;
        agentValidUntil = approved?.validUntil ?? undefined;
        if (agentValidUntil !== undefined && agentValidUntil <= Date.now()) {
          throw new Error(
            "This API key has expired. Create a new one in Hyperliquid’s API settings.",
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("expired")) {
          throw error;
        }
        // Unnamed agents may not be returned by extraAgents. userRole above is
        // authoritative for the master/agent relationship.
      }

      const [nextConverter, perpDexMetadata] = await Promise.all([
        SymbolConverter.create({ transport }),
        nextInfoClient.perpDexs().catch(() => []),
      ]);
      const nextPerpDexIndices = new Map(
        perpDexMetadata.flatMap((dex, index) =>
          dex?.name ? ([[dex.name, index]] as const) : [],
        ),
      );
      if (
        attemptEpoch !== connectionAttemptEpoch ||
        connectionStatus() !== "connecting"
      ) {
        throw new Error("Connection canceled. Please try again.");
      }
      const sessionLockEpoch = await acquireExecutionSessionLock(
        network,
        wallet.address,
      );
      if (
        attemptEpoch !== connectionAttemptEpoch ||
        connectionStatus() !== "connecting"
      ) {
        releaseSessionLock(sessionLockEpoch);
        throw new Error("Connection canceled. Please try again.");
      }
      const nextExchangeConfig: ExchangeSingleWalletConfig<HttpTransport> = {
        transport,
        wallet,
        nonceManager: createNonceManager(network),
        defaultExpiresAfter: () => Date.now() + REQUEST_EXPIRY_MS,
      };

      exchangeConfig = nextExchangeConfig;
      infoClient = nextInfoClient;
      symbolConverter = nextConverter;
      perpDexIndexByName = nextPerpDexIndices;
      const nextConnection: HyperliquidConnection = {
        network,
        masterAddress,
        agentAddress: wallet.address.toLowerCase() as `0x${string}`,
        agentName,
        agentValidUntil,
      };
      setConnection(nextConnection);
      setConnectionStatus("connected");
      setExecutionEnabled(true);
      await refreshHyperliquidAccount();
      if (
        attemptEpoch !== connectionAttemptEpoch ||
        connectionStatus() !== "connected"
      ) {
        throw new Error("Connection canceled. Please try again.");
      }
      if (accountRefreshError()) {
        throw new Error(accountRefreshError());
      }
      refreshTimer = setInterval(() => {
        void refreshHyperliquidAccount();
      }, ACCOUNT_REFRESH_MS);
      void startDexDiscovery(nextConnection);
      return { ok: true };
    } catch (error) {
      const message = getErrorMessage(
        error,
        "Could not connect your account. Please try again.",
      );
      if (attemptEpoch === connectionAttemptEpoch) {
        disconnectHyperliquid();
        setConnectionError(message);
      }
      return { ok: false, error: message };
    }
  };

  const setHyperliquidAccountMode = async (
    mode: Exclude<HyperliquidAccountMode, "default">,
  ): Promise<ActionResult> => {
    try {
      const {
        exchangeConfig: config,
        infoClient: activeInfoClient,
      } = ensureClients();
      const activeConnection = connection();
      if (!activeConnection) {
        return { ok: false, error: "Connect an API wallet first." };
      }
      const currentMode = await activeInfoClient.userAbstraction({
        user: activeConnection.masterAddress,
      });
      setAccountMode(currentMode);
      if (currentMode !== "default") {
        return {
          ok: false,
          error:
            "API wallets can only choose an account mode while the account is still in Default mode. Change an existing mode with the master wallet in Hyperliquid Settings.",
        };
      }
      const wireMode =
        mode === "portfolioMargin"
          ? "p"
          : mode === "unifiedAccount"
            ? "u"
            : "i";
      const { agentSetAbstraction } = await loadHyperliquidExecutionSdk();
      await agentSetAbstraction(config, { abstraction: wireMode });
      await refreshHyperliquidAccount();
      if (accountMode() !== mode) {
        return {
          ok: false,
          error:
            "Hyperliquid did not confirm the requested account mode. Existing-mode transitions may require the master wallet in Hyperliquid Settings.",
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: getErrorMessage(error, "Could not update Hyperliquid account mode."),
      };
    }
  };

  onCleanup(() => {
    stopRefreshTimer();
    stopDexDiscovery();
  });

  return {
    connection,
    connectionStatus,
    connectionError,
    accountMode,
    accountRefreshError,
    lastAccountRefreshAt,
    liveOpenOrders,
    livePositions,
    liveReferencePrices,
    liveSpotBalances,
    liveSpotAvailableBalances,
    liveSpotBorrowedBalances,
    liveSpotCollateralLtvs,
    liveWithdrawable,
    liveAccountValue,
    livePortfolioMarginSummary,
    liveTradeFills,
    liveFundingPayments,
    liveHistoricalOrders,
    liveTwapOrders,
    activityRefreshPending,
    activityRefreshError,
    lastActivityRefreshAt,
    livePortfolioSnapshots,
    liveFeeSummary,
    liveInterestPayments,
    liveAccountTransfers,
    portfolioRefreshPending,
    portfolioRefreshError,
    lastPortfolioRefreshAt,
    isHyperliquidConnected,
    isHyperliquidExecution,
    setExecutionEnabled,
    connectHyperliquid,
    disconnectHyperliquid,
    refreshHyperliquidAccount,
    refreshHyperliquidActivity,
    refreshHyperliquidPortfolio,
    setHyperliquidAccountMode,
  };
});

type ResolvedAsset = {
  apiSymbol: string;
  assetId: number;
  szDecimals: number;
  dex: string;
};

const findResolvedAsset = (
  converter: SymbolConverter,
  symbol: string,
  marketType: "perp" | "spot",
): ResolvedAsset | null => {
  const trimmedSymbol = symbol.trim();
  const apiSymbol =
    marketType === "spot" && trimmedSymbol.startsWith("@")
      ? converter.getSymbolBySpotPairId(trimmedSymbol) ??
        marketSymbol(symbol, marketType)
      : marketSymbol(symbol, marketType);
  const directAssetId = converter.getAssetId(apiSymbol);
  const directSzDecimals = converter.getSzDecimals(apiSymbol);
  if (directAssetId !== undefined && directSzDecimals !== undefined) {
    return {
      apiSymbol,
      assetId: directAssetId,
      szDecimals: directSzDecimals,
      dex: marketType === "perp" ? perpDexForSymbol(apiSymbol) : "",
    };
  }
  if (marketType !== "perp" || apiSymbol.includes(":")) return null;

  const builderDexMatches = [...namedPerpAssets.values()].filter(
    (asset) => asset.apiSymbol.endsWith(`:${apiSymbol}`),
  );
  if (builderDexMatches.length > 1) {
    throw new Error(
      `${apiSymbol} exists on more than one perpetual DEX. Use a DEX-prefixed symbol such as ${builderDexMatches[0].apiSymbol}.`,
    );
  }
  return builderDexMatches[0] ?? null;
};

const refreshPerpDexDirectory = async () => {
  const { infoClient: activeInfoClient } = ensureClients();
  const directory = await activeInfoClient.perpDexs();
  perpDexIndexByName = new Map(
    directory.flatMap((dex, index) =>
      dex?.name ? ([[dex.name, index]] as const) : [],
    ),
  );
};

const loadNamedPerpDexMetadata = async (dex: string) => {
  if (!dex || loadedNamedPerpDexs.has(dex)) return;
  const existing = namedPerpMetadataLoads.get(dex);
  if (existing) return await existing;

  const load = (async () => {
    const { infoClient: activeInfoClient } = ensureClients();
    if (!perpDexIndexByName.has(dex)) await refreshPerpDexDirectory();
    const dexIndex = perpDexIndexByName.get(dex);
    if (dexIndex === undefined) {
      throw new Error(`${dex} is not a perpetual DEX on the selected network.`);
    }
    const metadata = await activeInfoClient.meta({ dex });
    const offset = 100_000 + dexIndex * 10_000;
    for (const [assetIndex, asset] of metadata.universe.entries()) {
      namedPerpAssets.set(asset.name, {
        apiSymbol: asset.name,
        assetId: offset + assetIndex,
        szDecimals: asset.szDecimals,
        dex,
      });
    }
    loadedNamedPerpDexs.add(dex);
  })();
  namedPerpMetadataLoads.set(dex, load);
  try {
    await load;
  } finally {
    namedPerpMetadataLoads.delete(dex);
  }
};

const resolveAsset = async (symbol: string, marketType: "perp" | "spot") => {
  const { symbolConverter: converter } = ensureClients();
  const apiSymbol = marketSymbol(symbol, marketType);
  const explicitDex =
    marketType === "perp" ? perpDexForSymbol(apiSymbol) : "";
  let resolved = findResolvedAsset(converter, symbol, marketType);
  if (!resolved && !explicitDex) {
    await converter.reload();
    resolved = findResolvedAsset(converter, symbol, marketType);
  }
  if (!resolved && marketType === "perp") {
    if (explicitDex) {
      await loadNamedPerpDexMetadata(explicitDex);
      resolved = namedPerpAssets.get(apiSymbol) ?? null;
    } else {
      const relevantNamedDexs = [...relevantPerpDexs].filter(Boolean);
      await Promise.allSettled(
        relevantNamedDexs.map((dex) => loadNamedPerpDexMetadata(dex)),
      );
      resolved = findResolvedAsset(converter, symbol, marketType);

      // xyz is the app's native builder DEX. Load it only when a bare symbol
      // is absent from the default and already relevant DEXes.
      if (!resolved) {
        try {
          await loadNamedPerpDexMetadata("xyz");
          resolved = findResolvedAsset(converter, symbol, marketType);
        } catch {
          // The final not-available error below remains authoritative.
        }
      }
    }
  }
  if (!resolved) {
    throw new Error(`${apiSymbol} is not available on the selected network.`);
  }
  if (marketType === "perp") relevantPerpDexs.add(resolved.dex);
  return resolved;
};

const getSelectedNetworkReferencePrice = async (
  resolved: ResolvedAsset,
  marketType: "perp" | "spot",
): Promise<number> => {
  const { infoClient: activeInfoClient, symbolConverter: converter } =
    ensureClients();
  const mids = await activeInfoClient.allMids({ dex: resolved.dex });
  const midSymbol =
    marketType === "spot"
      ? converter.getSpotPairId(resolved.apiSymbol) ?? resolved.apiSymbol
      : resolved.apiSymbol;
  const referencePrice = parseNumber(
    mids[midSymbol] ?? mids[resolved.apiSymbol],
  );
  if (referencePrice > 0) {
    referencePriceCache[resolved.apiSymbol] = referencePrice;
    return referencePrice;
  }
  throw new Error(
    `Hyperliquid did not return a current ${resolved.apiSymbol} reference price on the selected network.`,
  );
};

const directionalMarketLimitPrice = (
  referencePrice: number,
  side: "buy" | "sell",
) => {
  const slippage = DEFAULT_MAX_SLIPPAGE_BPS / 10_000;
  return referencePrice * (side === "buy" ? 1 + slippage : 1 - slippage);
};

const reconcileAccountAfterAcknowledgement = () => {
  const epoch = refreshEpoch;
  reconcileInBackground(refreshInFlight?.promise, () => epoch === refreshEpoch, refreshHyperliquidAccount);
};

const reconcileSubmittedOrder = async (
  cloid: `0x${string}`,
  submissionError: unknown,
): Promise<ActionResult> => {
  const { infoClient: activeInfoClient } = ensureClients();
  const activeConnection = connection();
  const originalMessage = getErrorMessage(
    submissionError,
    "The exchange request failed.",
  );
  if (!activeConnection) {
    return { ok: false, error: originalMessage };
  }

  let reconciliationError: string | undefined;
  for (const delayMs of ORDER_RECONCILIATION_DELAYS_MS) {
    await wait(delayMs);
    try {
      const status = await activeInfoClient.orderStatus({
        user: activeConnection.masterAddress,
        oid: cloid,
      });
      if (status.status === "unknownOid") continue;
      const orderState = status.order.status;
      if (
        orderState === "open" ||
        orderState === "filled" ||
        orderState === "triggered"
      ) {
        reconcileAccountAfterAcknowledgement();
        return {
          ok: true,
          message: `The submit response was interrupted, but Hyperliquid confirmed the order as ${orderState}.`,
        };
      }
      return {
        ok: false,
        error: `Hyperliquid received the order but reports ${orderState}. It may have partially filled; inspect the account before submitting another order.`,
      };
    } catch (error) {
      reconciliationError = getErrorMessage(
        error,
        "The follow-up order-status check failed.",
      );
    }
  }

  return {
    ok: false,
    error: `${originalMessage} Hyperliquid did not confirm client order ${cloid}. Submission status is unknown${
      reconciliationError ? ` (${reconciliationError})` : ""
    }; do not resubmit until you verify the account on Hyperliquid.`,
  };
};

const reconcileSubmittedOrders = async (
  cloids: `0x${string}`[],
  submissionError: unknown,
): Promise<ActionResult> => {
  const results = await Promise.all(
    cloids.map((cloid) => reconcileSubmittedOrder(cloid, submissionError)),
  );
  const confirmed = results.filter((result) => result.ok).length;
  if (confirmed === results.length) {
    return {
      ok: true,
      message: `The submit response was interrupted, but Hyperliquid confirmed all ${confirmed} position TP/SL order${confirmed === 1 ? "" : "s"}.`,
    };
  }
  const unresolvedCloids = cloids.filter((_, index) => !results[index].ok);
  if (confirmed > 0) {
    return {
      ok: false,
      error: `Hyperliquid confirmed ${confirmed} of ${results.length} position TP/SL orders after an interrupted response. Status is unresolved for ${unresolvedCloids.join(", ")}; inspect the account and do not resubmit blindly.`,
    };
  }
  const firstFailure = results.find(
    (result): result is Extract<ActionResult, { ok: false }> => !result.ok,
  );
  return {
    ok: false,
    error:
      firstFailure?.error ??
      "Hyperliquid did not confirm the position TP/SL orders. Inspect the account before resubmitting.",
  };
};

export const placeHyperliquidOrder = async (
  input: PlaceOrderInput,
): Promise<ActionResult> => {
  try {
    const {
      formatHyperliquidPrice,
      formatHyperliquidSize,
      order,
      updateLeverage,
    } = await loadHyperliquidExecutionSdk();
    const { exchangeConfig: config } = ensureClients();
    const marketType = input.marketType ?? "perp";
    if (!Number.isFinite(input.size) || input.size <= 0) {
      return { ok: false, error: "Enter a valid size." };
    }
    const resolved = await resolveAsset(input.symbol, marketType);
    const { assetId, szDecimals } = resolved;
    const size = formatHyperliquidSize(input.size, szDecimals);

    if (shouldUpdateLeverage(input)) {
      const leverageKey = `${assetId}:${input.marginType}`;
      const leverageValue = String(input.leverage);
      if (leverageCache.get(leverageKey) !== leverageValue) {
        await updateLeverage(config, {
          asset: assetId,
          isCross: input.marginType === "cross",
          leverage: input.leverage as number,
        });
        leverageCache.set(leverageKey, leverageValue);
      }
    }

    let rawPrice = input.price;
    let tif: "Gtc" | "FrontendMarket" = "Gtc";
    if (input.type === "market") {
      const selectedNetworkReferencePrice =
        await getSelectedNetworkReferencePrice(resolved, marketType);
      rawPrice = directionalMarketLimitPrice(
        selectedNetworkReferencePrice,
        input.side,
      );
      tif = "FrontendMarket";
    }
    if (!Number.isFinite(rawPrice) || (rawPrice ?? 0) <= 0) {
      return { ok: false, error: "Enter a valid price." };
    }
    const price = formatHyperliquidPrice(
      rawPrice as number,
      szDecimals,
      marketType,
    );

    const cloid = makeCloid();
    let response: Awaited<ReturnType<typeof order>>;
    try {
      response = await order(config, {
        orders: [
          {
            a: assetId,
            b: input.side === "buy",
            p: price,
            s: size,
            r: input.reduceOnly ?? false,
            t: { limit: { tif } },
            c: cloid,
          },
        ],
        grouping: "na",
      });
    } catch (error) {
      return await reconcileSubmittedOrder(cloid, error);
    }
    const statusError = orderStatusError(response);
    if (statusError) return { ok: false, error: statusError };
    reconcileAccountAfterAcknowledgement();
    return input.type === "market"
      ? {
          ok: true,
          message: `Submitted with a direction-aware ${HYPERLIQUID_MARKET_SLIPPAGE_PERCENT}% cap from the selected-network reference price.`,
        }
      : { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error, "Hyperliquid order submission failed."),
    };
  }
};

export const cancelHyperliquidOrder = async (
  symbol: string,
  oid: number,
): Promise<ActionResult> => {
  try {
    const { cancel } = await loadHyperliquidExecutionSdk();
    const { exchangeConfig: config } = ensureClients();
    const { assetId } = await resolveAsset(
      symbol,
      symbol.includes("/") || symbol.startsWith("@") ? "spot" : "perp",
    );
    const response = await cancel(config, {
      cancels: [{ a: assetId, o: oid }],
    });
    const statuses = response.response.data.statuses as unknown[];
    const failure = statuses.find(
      (status) =>
        typeof status === "object" && status !== null && "error" in status,
    ) as { error?: unknown } | undefined;
    if (typeof failure?.error === "string") {
      return { ok: false, error: failure.error };
    }
    reconcileAccountAfterAcknowledgement();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error, "Could not cancel the Hyperliquid order."),
    };
  }
};

export const closeHyperliquidPosition = async (
  symbol: string,
): Promise<ActionResult> => {
  await refreshHyperliquidAccount();
  if (accountRefreshError()) {
    return {
      ok: false,
      error:
        "Could not refresh the live position before closing it. No close order was submitted.",
    };
  }
  const position = livePositions().find((item) => item.symbol === symbol);
  if (!position) return { ok: false, error: "Position is no longer open." };
  return await placeHyperliquidOrder({
    symbol,
    side: position.size > 0 ? "sell" : "buy",
    type: "market",
    size: Math.abs(position.size),
    reduceOnly: true,
    marketType: "perp",
  });
};

export const updateHyperliquidPositionTpsl = async ({
  symbol,
  takeProfit,
  stopLoss,
}: {
  symbol: string;
  takeProfit?: number | null;
  stopLoss?: number | null;
}): Promise<ActionResult> => {
  try {
    const {
      cancel,
      formatHyperliquidPrice,
      formatHyperliquidSize,
      order,
    } = await loadHyperliquidExecutionSdk();
    if (!validTriggerPrice(takeProfit) || !validTriggerPrice(stopLoss)) {
      return { ok: false, error: "Enter a valid trigger price." };
    }
    const { exchangeConfig: config } = ensureClients();
    await refreshHyperliquidAccount();
    if (accountRefreshError()) {
      return {
        ok: false,
        error:
          "Could not refresh the live position before updating TP/SL. Existing orders were left unchanged.",
      };
    }
    const position = livePositions().find((item) => item.symbol === symbol);
    if (!position) return { ok: false, error: "Position is no longer open." };
    const triggerDirectionError = positionTriggerDirectionError(
      position,
      takeProfit,
      stopLoss,
    );
    if (triggerDirectionError) {
      return { ok: false, error: triggerDirectionError };
    }
    const { assetId, szDecimals } = await resolveAsset(symbol, "perp");

    const triggers = [
      takeProfit == null ? null : { price: takeProfit, kind: "tp" as const },
      stopLoss == null ? null : { price: stopLoss, kind: "sl" as const },
    ].filter(
      (value): value is { price: number; kind: "tp" | "sl" } => value !== null,
    );

    const oldTriggers = positionTpslOrdersForSymbol(rawOpenOrders, symbol);
    if (oldTriggers.length > 0) {
      const cancelResponse = await cancel(config, {
        cancels: oldTriggers.map((order) => ({ a: assetId, o: order.oid })),
      });
      const failure = (
        cancelResponse.response.data.statuses as unknown[]
      ).find(
        (status) =>
          typeof status === "object" && status !== null && "error" in status,
      ) as { error?: unknown } | undefined;
      if (typeof failure?.error === "string") {
        return { ok: false, error: failure.error };
      }
    }

    if (triggers.length === 0) {
      reconcileAccountAfterAcknowledgement();
      return { ok: true };
    }

    const isBuy = position.size < 0;
    const size = formatHyperliquidSize(Math.abs(position.size), szDecimals);
    const orders = triggers.map((trigger) => {
      const slippage = DEFAULT_MAX_SLIPPAGE_BPS / 10_000;
      const limitPrice = trigger.price * (isBuy ? 1 + slippage : 1 - slippage);
      return {
        a: assetId,
        b: isBuy,
        p: formatHyperliquidPrice(limitPrice, szDecimals, "perp"),
        s: size,
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: formatHyperliquidPrice(
              trigger.price,
              szDecimals,
              "perp",
            ),
            tpsl: trigger.kind,
          },
        },
        c: makeCloid(),
      } as const;
    });
    let response: Awaited<ReturnType<typeof order>>;
    try {
      response = await order(config, {
        orders,
        grouping: "positionTpsl",
      });
    } catch (error) {
      return await reconcileSubmittedOrders(
        orders.map((triggerOrder) => triggerOrder.c),
        error,
      );
    }
    const statusError = orderStatusError(response);
    if (statusError) return { ok: false, error: statusError };
    reconcileAccountAfterAcknowledgement();
    return {
      ok: true,
      message: `Hyperliquid accepted ${orders.length} position TP/SL order${orders.length === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error, "Could not update Hyperliquid TP/SL."),
    };
  }
};

export const hyperliquidAccountModeLabel = () => {
  switch (accountMode()) {
    case "portfolioMargin":
      return "Portfolio";
    case "unifiedAccount":
      return "Unified";
    case "disabled":
      return "Standard";
    default:
      return "Default";
  }
};

export const hyperliquidExecutionLabel = () => {
  const active = connection();
  if (!active) return "Practice trading";
  return "Live trading";
};

export {
connectHyperliquid,
disconnectHyperliquid,accountMode as hyperliquidAccountMode,
accountRefreshError as hyperliquidAccountRefreshError,liveAccountTransfers as hyperliquidAccountTransfers,liveAccountValue as hyperliquidAccountValue,activityRefreshError as hyperliquidActivityRefreshError,activityRefreshPending as hyperliquidActivityRefreshPending,connection as hyperliquidConnection,connectionError as hyperliquidConnectionError,connectionStatus as hyperliquidConnectionStatus,liveFeeSummary as hyperliquidFeeSummary,liveFundingPayments as hyperliquidFundingPayments,
liveHistoricalOrders as hyperliquidHistoricalOrders,liveInterestPayments as hyperliquidInterestPayments,lastActivityRefreshAt as hyperliquidLastActivityRefreshAt,lastPortfolioRefreshAt as hyperliquidLastPortfolioRefreshAt,lastAccountRefreshAt as hyperliquidLastRefreshAt,
liveOpenOrders as hyperliquidOpenOrders,livePortfolioMarginSummary as hyperliquidPortfolioMarginSummary,portfolioRefreshError as hyperliquidPortfolioRefreshError,portfolioRefreshPending as hyperliquidPortfolioRefreshPending,livePortfolioSnapshots as hyperliquidPortfolioSnapshots,livePositions as hyperliquidPositions,
liveReferencePrices as hyperliquidReferencePrices,liveSpotAvailableBalances as hyperliquidSpotAvailableBalances,liveSpotBalances as hyperliquidSpotBalances,liveSpotBorrowedBalances as hyperliquidSpotBorrowedBalances,
liveSpotCollateralLtvs as hyperliquidSpotCollateralLtvs,liveTradeFills as hyperliquidTradeFills,liveTwapOrders as hyperliquidTwapOrders,liveWithdrawable as hyperliquidWithdrawable,isHyperliquidConnected,
isHyperliquidExecution,refreshHyperliquidAccount,
refreshHyperliquidActivity,
refreshHyperliquidPortfolio,
setHyperliquidAccountMode,setExecutionEnabled as setHyperliquidExecutionEnabled
};

export const __test = {
  normalizeAddress,
  normalizePrivateKey,
  parseCollateralLtv,
  normalizeCumulativeFunding,
  derivePortfolioMarginSummary,
  normalizeTradeFill,
  normalizeFundingPayment,
  normalizeHistoricalOrder,
  normalizeTwapOrder,
  normalizePortfolioSnapshots,
  normalizeFeeSummary,
  normalizeInterestPayment,
  normalizeAccountTransfer,
  orderStatusError,
  marketSymbol,
  perpDexForSymbol,
  trackedPerpDexsForRefresh,
  directionalMarketLimitPrice,
  availableSpotBalance,
  borrowedSpotBalance,
  requiresMaintenanceAvailability,
  shouldUpdateLeverage,
  validTriggerPrice,
  positionTriggerDirectionError,
  positionTpslOrdersForSymbol,
};
