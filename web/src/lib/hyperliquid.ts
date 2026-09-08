import {
  normalizeSymbol as sharedNormalizeSymbol,
  formatPrice as sharedFormatPrice,
  formatVolume as sharedFormatVolume,
  formatPercent as sharedFormatPercent,
} from "./format";
import type { OrderBookLevel, L2Book } from "./format";
import {
  hyperliquidDataNetwork,
  hyperliquidInfoUrl,
} from "./hyperliquidNetwork";

const INFO_MIN_INTERVAL_MS = 300;
const INFO_RATE_LIMIT_COOLDOWN_MS = 2500;
const INFO_MAX_QUEUE = 200;
const INFO_MAX_RETRY_AFTER_MS = 60_000;
const INFO_MAX_RESPONSE_ROWS = 2_000;
const INFO_MAX_RESPONSE_BYTES = 2_000_000;
const INFO_FETCH_TIMEOUT_MS = 10_000;
let infoLastRequestAt = 0;
let infoRateLimitedUntil = 0;

type InfoPriority = "high" | "low";

type InfoQueueTask = {
  run: () => Promise<Response | null>;
  resolve: (value: Response | null) => void;
  reject: (reason?: unknown) => void;
  priority: InfoPriority;
};

const infoQueue: InfoQueueTask[] = [];
let infoQueueRunning = false;

const drainInfoQueue = async () => {
  if (infoQueueRunning) return;
  infoQueueRunning = true;
  while (infoQueue.length > 0) {
    const highIndex = infoQueue.findIndex(
      (task) => task.priority === "high",
    );
    const task =
      highIndex >= 0
        ? infoQueue.splice(highIndex, 1)[0]
        : infoQueue.shift();
    if (!task) break;
    try {
      const result = await task.run();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    }
  }
  infoQueueRunning = false;
};

const delayWithAbort = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      finish();
    };
    if (!signal) return;
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const readBoundedJson = async (response: Response): Promise<unknown | null> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > INFO_MAX_RESPONSE_BYTES
  ) {
    return null;
  }
  const body = await response.text();
  if (body.length > INFO_MAX_RESPONSE_BYTES) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
};

const postHyperliquidInfo = (
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  options?: { priority?: InfoPriority },
): Promise<Response | null> => {
  if (signal?.aborted) return Promise.resolve(null);
  if (infoQueue.length >= INFO_MAX_QUEUE) return Promise.resolve(null);
  const priority = options?.priority ?? "low";
  const requestUrl = hyperliquidInfoUrl();

  return new Promise<Response | null>((resolve, reject) => {
    const run = async () => {
      if (signal?.aborted) return null;
      const now = Date.now();
      if (now < infoRateLimitedUntil) return null;
      const waitMs = Math.max(
        0,
        infoLastRequestAt + INFO_MIN_INTERVAL_MS - now,
      );
      if (waitMs > 0) {
        await delayWithAbort(waitMs, signal);
        if (signal?.aborted) return null;
      }
      infoLastRequestAt = Date.now();
      const timeoutSignal = AbortSignal.timeout(INFO_FETCH_TIMEOUT_MS);
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal,
      });
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const retryMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
        const cooldownMs = Number.isFinite(retryMs) && retryMs >= 0
          ? Math.min(retryMs, INFO_MAX_RETRY_AFTER_MS)
          : INFO_RATE_LIMIT_COOLDOWN_MS;
        infoRateLimitedUntil = Date.now() + cooldownMs;
      }
      return response;
    };

    infoQueue.push({ run, resolve, reject, priority });
    void drainInfoQueue();
  });
};

export interface AssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
}

export interface AssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium?: string | null;
  oraclePx: string;
  markPx: string;
  midPx?: string | null;
  impactPxs?: string[] | null;
}

export interface MetaAndAssetCtxs {
  universe: AssetMeta[];
  ctx: AssetCtx[];
}

export interface SpotMeta {
  tokens: { name: string; szDecimals: number; index: number }[];
  universe: { name: string; tokens: [number, number]; index: number }[];
}

export interface SpotAssetCtx {
  dayNtlVlm: string;
  markPx: string;
  midPx: string | null;
  prevDayPx: string;
  coin?: string;
}

export interface SpotMetaAndAssetCtxs {
  meta: SpotMeta;
  ctx: SpotAssetCtx[];
}

export interface HyperliquidCandle {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
}

// Re-export shared types
export type { OrderBookLevel, L2Book };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDecimalString = (
  value: unknown,
  allowNegative = true,
): value is string => {
  if (typeof value !== "string" || value.length > 64) return false;
  if (!allowNegative && value.startsWith("-")) return false;
  if (!/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 1e30;
};

const isPositiveDecimalString = (value: unknown): value is string =>
  isDecimalString(value, false) && Number(value) > 0;

const isNonnegativeDecimalString = (value: unknown): value is string =>
  isDecimalString(value, false) && Number(value) >= 0;

const isAssetMeta = (value: unknown): value is AssetMeta =>
  isRecord(value) &&
  typeof value.name === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/.test(value.name) &&
  Number.isSafeInteger(value.szDecimals) &&
  (value.szDecimals as number) >= 0 &&
  (value.szDecimals as number) <= 18 &&
  Number.isSafeInteger(value.maxLeverage) &&
  (value.maxLeverage as number) >= 1 &&
  (value.maxLeverage as number) <= 200 &&
  (value.onlyIsolated === undefined || typeof value.onlyIsolated === "boolean");

const isAssetCtx = (value: unknown): value is AssetCtx =>
  isRecord(value) &&
  isDecimalString(value.funding) &&
  Math.abs(Number(value.funding)) <= 1 &&
  isNonnegativeDecimalString(value.openInterest) &&
  isPositiveDecimalString(value.prevDayPx) &&
  isNonnegativeDecimalString(value.dayNtlVlm) &&
  isPositiveDecimalString(value.oraclePx) &&
  isPositiveDecimalString(value.markPx) &&
  (value.midPx === undefined ||
    value.midPx === null ||
    isPositiveDecimalString(value.midPx)) &&
  (value.premium === undefined ||
    value.premium === null ||
    isDecimalString(value.premium)) &&
  (value.impactPxs === undefined ||
    value.impactPxs === null ||
    (Array.isArray(value.impactPxs) &&
      value.impactPxs.length <= 8 &&
      value.impactPxs.every(isPositiveDecimalString)));

export const parseMetaAndAssetCtxsResponse = (
  value: unknown,
): MetaAndAssetCtxs | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const rawMeta = value[0];
  const contexts = value[1];
  const universe =
    isRecord(rawMeta) && Array.isArray(rawMeta.universe)
      ? rawMeta.universe
      : Array.isArray(rawMeta)
        ? rawMeta
        : null;
  if (
    !universe ||
    !Array.isArray(contexts) ||
    universe.length !== contexts.length ||
    universe.length > INFO_MAX_RESPONSE_ROWS ||
    !universe.every(isAssetMeta) ||
    !contexts.every(isAssetCtx)
  ) {
    return null;
  }
  const names = new Set(universe.map((asset) => asset.name.toUpperCase()));
  return names.size === universe.length
    ? { universe, ctx: contexts }
    : null;
};

type SpotToken = { name: string; szDecimals: number; index: number };
type SpotPair = { name: string; tokens: [number, number]; index: number };

const isSpotToken = (value: unknown): value is SpotToken =>
  isRecord(value) &&
  typeof value.name === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/.test(value.name) &&
  Number.isSafeInteger(value.szDecimals) &&
  (value.szDecimals as number) >= 0 &&
  (value.szDecimals as number) <= 18 &&
  Number.isSafeInteger(value.index) &&
  (value.index as number) >= 0 &&
  (value.index as number) <= 1_000_000;

const isSpotPair = (value: unknown): value is SpotPair =>
  isRecord(value) &&
  typeof value.name === "string" &&
  value.name.length <= 80 &&
  Array.isArray(value.tokens) &&
  value.tokens.length === 2 &&
  value.tokens.every(
    (token) =>
      Number.isSafeInteger(token) && token >= 0 && token <= 1_000_000,
  ) &&
  value.tokens[0] !== value.tokens[1] &&
  Number.isSafeInteger(value.index) &&
  (value.index as number) >= 0 &&
  (value.index as number) <= 1_000_000;

const isSpotAssetCtx = (value: unknown): value is SpotAssetCtx =>
  isRecord(value) &&
  isNonnegativeDecimalString(value.dayNtlVlm) &&
  isPositiveDecimalString(value.markPx) &&
  (value.midPx === null || isPositiveDecimalString(value.midPx)) &&
  isNonnegativeDecimalString(value.prevDayPx) &&
  (value.coin === undefined ||
    (typeof value.coin === "string" && value.coin.length <= 80));

export const parseSpotMetaAndAssetCtxsResponse = (
  value: unknown,
): SpotMetaAndAssetCtxs | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const meta = value[0];
  const contexts = value[1];
  if (
    !isRecord(meta) ||
    !Array.isArray(meta.tokens) ||
    !Array.isArray(meta.universe) ||
    !Array.isArray(contexts) ||
    meta.tokens.length > INFO_MAX_RESPONSE_ROWS ||
    meta.universe.length > INFO_MAX_RESPONSE_ROWS ||
    contexts.length > INFO_MAX_RESPONSE_ROWS ||
    !meta.tokens.every(isSpotToken) ||
    !meta.universe.every(isSpotPair)
  ) {
    return null;
  }
  const tokenIndexes = new Set(meta.tokens.map((token) => token.index));
  const tokenByIndex = new Map(
    meta.tokens.map((token) => [token.index, token.name.toUpperCase()]),
  );
  const tokenNames = new Set(
    meta.tokens.map((token) => token.name.toUpperCase()),
  );
  const pairIndexes = new Set(meta.universe.map((pair) => pair.index));
  const pairNames = new Set(
    meta.universe.map((pair) => pair.name.toUpperCase()),
  );
  if (
    tokenIndexes.size !== meta.tokens.length ||
    tokenNames.size !== meta.tokens.length ||
    pairIndexes.size !== meta.universe.length ||
    pairNames.size !== meta.universe.length ||
    meta.universe.some((pair) =>
      pair.tokens.some((token) => !tokenIndexes.has(token)),
    )
  ) {
    return null;
  }
  const contextsUsePairIndex = contexts.length !== meta.universe.length;
  if (
    contextsUsePairIndex &&
    meta.universe.some((pair) => pair.index >= contexts.length)
  ) {
    return null;
  }
  const supported = meta.universe
    .map((pair, universeIndex) => ({
      pair,
      context: contexts[contextsUsePairIndex ? pair.index : universeIndex],
    }))
    .filter(
      ({ pair }) => tokenByIndex.get(pair.tokens[1]) === "USDC",
    );
  if (
    supported.some(
      ({ pair, context }) =>
        !isSpotAssetCtx(context) ||
        (context.coin !== undefined &&
          context.coin.toUpperCase() !== pair.name.toUpperCase()),
    )
  ) {
    return null;
  }
  return {
    meta: { tokens: meta.tokens, universe: supported.map(({ pair }) => pair) },
    ctx: supported.map(({ context }) => context),
  };
};

/**
 * Normalize a symbol to Hyperliquid format (uppercase, no suffix, xyz: prefix)
 */
export const normalizeSymbol = sharedNormalizeSymbol;

const HYPERLIQUID_SPOT_UI_SYMBOLS: Record<string, string> = {
  UBTC: "BTC",
  UETH: "ETH",
  USOL: "SOL",
};

const stripSpotQuote = (symbol: string): string => {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  if (normalized === "USDC") return normalized;
  return normalized.replace(/[-/]USDC$/, "").replace(/USDC$/, "");
};

export const normalizeHyperliquidSpotUiSymbol = (symbol: string): string => {
  const base = stripSpotQuote(symbol);
  return HYPERLIQUID_SPOT_UI_SYMBOLS[base] ?? base;
};

export const resolveHyperliquidSpotPairId = (
  symbol: string,
  spotData: SpotMetaAndAssetCtxs,
): `@${number}` | null => {
  const explicitPair = String(symbol ?? "").trim();
  if (/^@(?:0|[1-9]\d{0,6})$/.test(explicitPair)) {
    const pairIndex = Number(explicitPair.slice(1));
    return spotData.meta.universe.some((pair) => pair.index === pairIndex)
      ? (explicitPair as `@${number}`)
      : null;
  }

  const requestedUiSymbol = normalizeHyperliquidSpotUiSymbol(symbol);
  if (!requestedUiSymbol || requestedUiSymbol === "USDC") return null;
  const tokenNames = new Map(
    spotData.meta.tokens.map((token) => [token.index, token.name] as const),
  );
  const matches = spotData.meta.universe.filter((pair) => {
    const base = tokenNames.get(pair.tokens[0]);
    const quote = tokenNames.get(pair.tokens[1]);
    return (
      !!base &&
      quote?.toUpperCase() === "USDC" &&
      normalizeHyperliquidSpotUiSymbol(base) === requestedUiSymbol
    );
  });
  return matches.length === 1 ? `@${matches[0].index}` : null;
};

const HYPERLIQUID_INTERVAL_MAP: Record<string, string> = {
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  "1D": "1d",
  "1W": "1w",
};

const isHyperliquidSymbol = (value: unknown): value is string =>
  typeof value === "string" &&
  (/^@(?:0|[1-9]\d{0,6})$/.test(value) ||
    /^(?:xyz:)?[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(value));

const normalizeHyperliquidMarketCoin = (coin: string): string =>
  coin.startsWith("@") ? coin : normalizeSymbol(coin);

export const toHyperliquidInterval = (resolution: string): string =>
  HYPERLIQUID_INTERVAL_MAP[resolution] ?? "5m";

/**
 * Fetch metadata and asset contexts (funding, OI, volume, etc.)
 */
export const fetchMetaAndAssetCtxs = async (
  signal?: AbortSignal,
  options?: { dex?: string },
): Promise<MetaAndAssetCtxs | null> => {
  try {
    if (
      options?.dex !== undefined &&
      !/^[A-Za-z0-9_-]{1,32}$/.test(options.dex)
    ) {
      return null;
    }
    const payload = options?.dex
      ? { type: "metaAndAssetCtxs", dex: options.dex }
      : { type: "metaAndAssetCtxs" };
    const response = await postHyperliquidInfo(payload, signal);

    if (!response || !response.ok) return null;
    return parseMetaAndAssetCtxsResponse(await readBoundedJson(response));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    console.error("Failed to fetch metaAndAssetCtxs:", error);
    return null;
  }
};

/**
 * Fetch spot metadata and asset contexts
 */
export const fetchSpotMetaAndAssetCtxs = async (
  signal?: AbortSignal,
): Promise<SpotMetaAndAssetCtxs | null> => {
  try {
    const response = await postHyperliquidInfo(
      { type: "spotMetaAndAssetCtxs" },
      signal,
    );

    if (!response || !response.ok) return null;
    return parseSpotMetaAndAssetCtxsResponse(await readBoundedJson(response));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    console.error("Failed to fetch spotMetaAndAssetCtxs:", error);
    return null;
  }
};

export type HyperliquidMarketType = "perps" | "spot" | "equities";

const SPOT_PAIR_METADATA_TTL_MS = 60_000;
const spotPairMetadataCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<SpotMetaAndAssetCtxs | null>;
  }
>();

const getSpotPairMetadata = () => {
  const network = hyperliquidDataNetwork();
  const cached = spotPairMetadataCache.get(network);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = fetchSpotMetaAndAssetCtxs();
  spotPairMetadataCache.set(network, {
    expiresAt: Date.now() + SPOT_PAIR_METADATA_TTL_MS,
    promise,
  });
  void promise.then((data) => {
    const current = spotPairMetadataCache.get(network);
    if (!data && current?.promise === promise) {
      spotPairMetadataCache.delete(network);
    }
  });
  return promise;
};

export const resolveHyperliquidMarketCoin = async ({
  symbol,
  marketType,
  signal,
}: {
  symbol: string;
  marketType: HyperliquidMarketType;
  signal?: AbortSignal;
}): Promise<string | null> => {
  if (signal?.aborted) return null;
  if (marketType !== "spot") {
    const normalized = normalizeSymbol(symbol);
    return isHyperliquidSymbol(normalized) ? normalized : null;
  }
  const spotData = await getSpotPairMetadata();
  if (!spotData || signal?.aborted) return null;
  return resolveHyperliquidSpotPairId(symbol, spotData);
};

/**
 * Get asset context for a specific coin
 */
export const getAssetContext = (
  coin: string,
  metaAndCtxs: MetaAndAssetCtxs,
): { meta: AssetMeta; ctx: AssetCtx } | null => {
  const normalizedCoin = normalizeSymbol(coin);
  const index = metaAndCtxs.universe.findIndex(
    (asset) => normalizeSymbol(asset.name) === normalizedCoin,
  );

  if (index === -1) return null;

  return {
    meta: metaAndCtxs.universe[index],
    ctx: metaAndCtxs.ctx[index],
  };
};

export const formatPrice = sharedFormatPrice;
export const formatVolume = sharedFormatVolume;
export const formatPercent = sharedFormatPercent;

export const fetchHyperliquidCandles = async ({
  coin,
  resolution,
  fromMs,
  toMs,
  signal,
  priority,
}: {
  coin: string;
  resolution: string;
  fromMs: number;
  toMs: number;
  signal?: AbortSignal;
  priority?: InfoPriority;
}): Promise<
  {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[]
> => {
  if (
    !isHyperliquidSymbol(coin) ||
    !(resolution in HYPERLIQUID_INTERVAL_MAP)
  ) {
    return [];
  }
  const interval = toHyperliquidInterval(resolution);
  const normalized = normalizeHyperliquidMarketCoin(coin);
  if (
    !normalized ||
    !Number.isSafeInteger(fromMs) ||
    !Number.isSafeInteger(toMs) ||
    fromMs < 0 ||
    toMs <= fromMs
  ) {
    return [];
  }
  const payload = {
    type: "candleSnapshot",
    req: {
      coin: normalized,
      interval,
      startTime: fromMs,
      endTime: toMs,
    },
  };

  try {
    const response = await postHyperliquidInfo(payload, signal, { priority });

    if (!response) return [];
    if (!response.ok) {
      if (response.status === 429) return [];
      throw new Error(`Hyperliquid candles failed: ${response.status}`);
    }

    const data = await readBoundedJson(response);
    if (!Array.isArray(data) || data.length > INFO_MAX_RESPONSE_ROWS) return [];

    const candles: {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }[] = [];
    const seenTimes = new Set<number>();
    for (const raw of data) {
      if (
        !isRecord(raw) ||
        !Number.isSafeInteger(raw.t) ||
        !Number.isSafeInteger(raw.T) ||
        (raw.t as number) < 0 ||
        (raw.T as number) < (raw.t as number) ||
        !isHyperliquidSymbol(raw.s) ||
        normalizeHyperliquidMarketCoin(raw.s) !== normalized ||
        raw.i !== interval ||
        !isPositiveDecimalString(raw.o) ||
        !isPositiveDecimalString(raw.h) ||
        !isPositiveDecimalString(raw.l) ||
        !isPositiveDecimalString(raw.c) ||
        !isNonnegativeDecimalString(raw.v) ||
        !Number.isSafeInteger(raw.n) ||
        (raw.n as number) < 0 ||
        seenTimes.has(raw.t as number)
      ) {
        return [];
      }
      const open = Number(raw.o);
      const high = Number(raw.h);
      const low = Number(raw.l);
      const close = Number(raw.c);
      const volume = Number(raw.v);
      if (
        high < Math.max(open, close) ||
        low > Math.min(open, close) ||
        high < low
      ) {
        return [];
      }
      seenTimes.add(raw.t as number);
      candles.push({ time: raw.t as number, open, high, low, close, volume });
    }
    return candles.sort((a, b) => a.time - b.time);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return [];
    }
    console.error("Failed to fetch hyperliquid candles:", error);
    return [];
  }
};
