import {
  FUNDING_RATE_PRECISION,
  PRICE_PRECISION,
  atomsToDecimal,
  atomsToNumber,
  canonicalSymbol,
  decimalToAtoms,
} from "./accounting";

const MAX_MARKET_ROWS = 1_000;
const MAX_PRICE = 1_000_000_000_000;
const MAX_ABS_FUNDING_RATE = 1;

type PriceRow = {
  symbol: string;
  markPx: number;
  markPxExact: string;
  midPx?: number;
  midPxExact?: string;
  funding?: number;
  fundingExact?: string;
  source: "hyperliquid" | "hyperliquid-spot";
  updatedAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDecimal = (
  value: unknown,
  precision: number,
  options: {
    allowNegative: boolean;
    allowZero?: boolean;
    maxAbsolute: number;
  },
) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    const atoms = decimalToAtoms(value, precision, {
      allowNegative: options.allowNegative,
      allowZero: options.allowZero ?? false,
      rounding: "half-even",
    });
    const number = atomsToNumber(atoms, precision);
    if (Math.abs(number) > options.maxAbsolute) return null;
    return { number, exact: atomsToDecimal(atoms, precision) };
  } catch {
    return null;
  }
};

const parseSymbol = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    return canonicalSymbol(value);
  } catch {
    return null;
  }
};

export const isFreshTimestamp = (
  updatedAt: number,
  now: number,
  freshnessMs: number,
) =>
  Number.isSafeInteger(updatedAt) &&
  Number.isSafeInteger(now) &&
  Number.isSafeInteger(freshnessMs) &&
  freshnessMs >= 0 &&
  updatedAt <= now &&
  now - updatedAt <= freshnessMs;

export const parseHyperliquidPerpPayload = (
  data: unknown,
  now: number,
): PriceRow[] => {
  if (!Number.isSafeInteger(now) || now < 0) return [];
  if (!Array.isArray(data) || data.length < 2) return [];
  const meta = data[0];
  const contexts = data[1];
  if (!isRecord(meta) || !Array.isArray(meta.universe) || !Array.isArray(contexts)) {
    return [];
  }
  if (
    meta.universe.length !== contexts.length ||
    meta.universe.length > MAX_MARKET_ROWS
  ) {
    return [];
  }

  const rows: PriceRow[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < meta.universe.length; index += 1) {
    const asset = meta.universe[index];
    const context = contexts[index];
    if (!isRecord(asset) || !isRecord(context)) return [];
    const symbol = parseSymbol(asset.name);
    const mark = parseDecimal(context.markPx, PRICE_PRECISION, {
      allowNegative: false,
      maxAbsolute: MAX_PRICE,
    });
    if (!symbol || !mark || seen.has(symbol)) return [];
    seen.add(symbol);

    const mid =
      context.midPx === undefined || context.midPx === null
        ? null
        : parseDecimal(context.midPx, PRICE_PRECISION, {
            allowNegative: false,
            maxAbsolute: MAX_PRICE,
          });
    const funding =
      context.funding === undefined || context.funding === null
        ? null
        : parseDecimal(context.funding, FUNDING_RATE_PRECISION, {
            allowNegative: true,
            allowZero: true,
            maxAbsolute: MAX_ABS_FUNDING_RATE,
          });
    if (
      (context.midPx !== undefined && context.midPx !== null && !mid) ||
      (context.funding !== undefined && context.funding !== null && !funding)
    ) {
      return [];
    }
    rows.push({
      symbol,
      markPx: mark.number,
      markPxExact: mark.exact,
      ...(mid ? { midPx: mid.number, midPxExact: mid.exact } : {}),
      ...(funding
        ? { funding: funding.number, fundingExact: funding.exact }
        : {}),
      source: "hyperliquid",
      updatedAt: now,
    });
  }
  return rows;
};

export const parseHyperliquidSpotPayload = (
  data: unknown,
  now: number,
): PriceRow[] => {
  if (!Number.isSafeInteger(now) || now < 0) return [];
  if (!Array.isArray(data) || data.length < 2) return [];
  const meta = data[0];
  const contexts = data[1];
  if (
    !isRecord(meta) ||
    !Array.isArray(meta.tokens) ||
    !Array.isArray(meta.universe) ||
    !Array.isArray(contexts) ||
    meta.tokens.length > MAX_MARKET_ROWS ||
    meta.universe.length > MAX_MARKET_ROWS ||
    contexts.length > MAX_MARKET_ROWS
  ) {
    return [];
  }

  const tokenNames = new Map<number, string>();
  const seenTokenNames = new Set<string>();
  for (const token of meta.tokens) {
    if (
      !isRecord(token) ||
      !Number.isSafeInteger(token.index) ||
      (token.index as number) < 0 ||
      (token.index as number) > 1_000_000
    ) {
      return [];
    }
    const symbol = parseSymbol(token.name);
    if (
      !symbol ||
      tokenNames.has(token.index as number) ||
      seenTokenNames.has(symbol)
    ) {
      return [];
    }
    tokenNames.set(token.index as number, symbol);
    seenTokenNames.add(symbol);
  }

  const rows: PriceRow[] = [];
  const seen = new Set<string>();
  const seenPairIndexes = new Set<number>();
  for (let index = 0; index < meta.universe.length; index += 1) {
    const pair = meta.universe[index];
    if (!isRecord(pair) || !Array.isArray(pair.tokens)) {
      return [];
    }
    if (
      !Number.isSafeInteger(pair.index) ||
      (pair.index as number) < 0 ||
      (pair.index as number) >= contexts.length ||
      seenPairIndexes.has(pair.index as number)
    ) {
      return [];
    }
    seenPairIndexes.add(pair.index as number);
    if (
      pair.tokens.length !== 2 ||
      !pair.tokens.every(
        (token) =>
          Number.isSafeInteger(token) && token >= 0 && token <= 1_000_000,
      ) ||
      pair.tokens[0] === pair.tokens[1]
    ) {
      return [];
    }
    const symbol = tokenNames.get(pair.tokens[0] as number);
    const quoteSymbol = tokenNames.get(pair.tokens[1] as number);
    if (!symbol || !quoteSymbol) return [];
    // Trade XYZ settles spot against USDC. Other valid Hyperliquid quote
    // assets are ignored rather than being mis-valued as dollars.
    if (quoteSymbol !== "USDC") continue;
    if (seen.has(symbol)) return [];
    const context = contexts[pair.index as number];
    if (!isRecord(context)) return [];
    const mark = parseDecimal(context.markPx, PRICE_PRECISION, {
      allowNegative: false,
      maxAbsolute: MAX_PRICE,
    });
    if (!mark) return [];
    seen.add(symbol);
    const mid =
      context.midPx === undefined || context.midPx === null
        ? null
        : parseDecimal(context.midPx, PRICE_PRECISION, {
            allowNegative: false,
            maxAbsolute: MAX_PRICE,
          });
    if (context.midPx !== undefined && context.midPx !== null && !mid) return [];
    rows.push({
      symbol,
      markPx: mark.number,
      markPxExact: mark.exact,
      ...(mid ? { midPx: mid.number, midPxExact: mid.exact } : {}),
      source: "hyperliquid-spot",
      updatedAt: now,
    });
  }
  return rows;
};
