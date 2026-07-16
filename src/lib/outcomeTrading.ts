/** Hyperliquid's fixed identifiers and precision for outcome contracts. */
export const OUTCOME_ASSET_OFFSET = 100_000_000;
export const OUTCOME_SIZE_DECIMALS = 0;
export const OUTCOME_WEI_DECIMALS = 5;
export const OUTCOME_PRICE_DECIMALS = 5;
export const OUTCOME_MIN_PRICE = 0.00001;
export const OUTCOME_MAX_PRICE = 0.99999;
export const OUTCOME_MARKET_SLIPPAGE = 0.08;
export const OUTCOME_MIN_NOTIONAL = 10;

export type OutcomeSide = 0 | 1;

export interface OutcomeContractId {
  outcomeId: number;
  side: OutcomeSide;
  encoding: number;
  coinKey: string;
  tokenName: string;
  assetId: number;
}

export interface OutcomeLegalCheck {
  acceptedTerms?: boolean;
  userAllowed?: boolean;
  /** Known values are n/a/o/u; unknown future codes must remain blocked. */
  restrictions?: string | null;
}

export interface OutcomeOrderSize {
  shares: number;
  notional: number;
  meetsMinimum: boolean;
}

function safeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Hyperliquid's compact outcome-side encoding: `10 * outcome + side`. */
export function outcomeEncoding(outcomeId: number, side: number): number {
  if (!safeNonNegativeInteger(outcomeId) || (side !== 0 && side !== 1)) {
    throw new RangeError('Outcome ids must be non-negative integers and side must be 0 or 1.');
  }
  return outcomeId * 10 + side;
}

/** Public market-data key used by candles, books, trades, and all-mids. */
export function outcomeCoinKey(outcomeId: number, side: number): string {
  return `#${outcomeEncoding(outcomeId, side)}`;
}

/** Token name returned by `spotClearinghouseState` for an outcome balance. */
export function outcomeTokenName(outcomeId: number, side: number): string {
  return `+${outcomeEncoding(outcomeId, side)}`;
}

/** Integer `a` field used by signed order and cancel actions. */
export function outcomeAssetId(outcomeId: number, side: number): number {
  return OUTCOME_ASSET_OFFSET + outcomeEncoding(outcomeId, side);
}

function contractFromEncoding(encoding: number): OutcomeContractId | null {
  if (!safeNonNegativeInteger(encoding)) return null;
  const side = encoding % 10;
  if (side !== 0 && side !== 1) return null;
  const outcomeId = Math.floor(encoding / 10);
  if (!safeNonNegativeInteger(outcomeId)) return null;
  return {
    outcomeId,
    side,
    encoding,
    coinKey: `#${encoding}`,
    tokenName: `+${encoding}`,
    assetId: OUTCOME_ASSET_OFFSET + encoding,
  };
}

/** Parse `#encoding`, `+encoding`, or the signed-action asset id. */
export function parseOutcomeContractId(value: string | number): OutcomeContractId | null {
  if (typeof value === 'number') {
    return safeNonNegativeInteger(value) && value >= OUTCOME_ASSET_OFFSET
      ? contractFromEncoding(value - OUTCOME_ASSET_OFFSET)
      : null;
  }
  if (!/^[#+]\d+$/.test(value)) return null;
  return contractFromEncoding(Number(value.slice(1)));
}

/**
 * Fail closed: terms, account eligibility, and an unrestricted response are all
 * required. Callers should re-fetch this immediately before signing.
 */
export function isOutcomeTradingAllowed(
  check: OutcomeLegalCheck | null | undefined,
): check is OutcomeLegalCheck {
  return (
    check?.acceptedTerms === true &&
    check.userAllowed === true &&
    check.restrictions === 'n'
  );
}

/** Round a user-entered size down to whole contracts; invalid values become zero. */
export function wholeOutcomeShares(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Convert a quote-currency amount to whole contracts without overspending it. */
export function outcomeSharesFromQuote(quoteAmount: number, referencePrice: number): number {
  if (!(Number.isFinite(quoteAmount) && quoteAmount > 0)) return 0;
  if (!(Number.isFinite(referencePrice) && referencePrice > 0)) return 0;
  return wholeOutcomeShares(quoteAmount / referencePrice);
}

export function outcomeOrderNotional(shares: number, price: number): number {
  const wholeShares = wholeOutcomeShares(shares);
  return wholeShares > 0 && Number.isFinite(price) && price > 0
    ? wholeShares * price
    : 0;
}

export function meetsOutcomeMinimumNotional(
  shares: number,
  price: number,
  minimum = OUTCOME_MIN_NOTIONAL,
): boolean {
  return Number.isFinite(minimum) && minimum >= 0 && outcomeOrderNotional(shares, price) >= minimum;
}

/** One calculation for review rows and minimum-order validation. */
export function outcomeOrderSize(
  amount: number,
  unit: 'shares' | 'quote',
  referencePrice: number,
  minimum = OUTCOME_MIN_NOTIONAL,
): OutcomeOrderSize {
  const shares =
    unit === 'quote'
      ? outcomeSharesFromQuote(amount, referencePrice)
      : wholeOutcomeShares(amount);
  const notional = outcomeOrderNotional(shares, referencePrice);
  return {
    shares,
    notional,
    meetsMinimum: Number.isFinite(minimum) && minimum >= 0 && notional >= minimum,
  };
}

/** Clamp a valid outcome price to the exchange's non-zero probability range. */
export function clampOutcomePrice(price: number): number {
  if (!Number.isFinite(price)) throw new RangeError('Outcome price must be finite.');
  return Math.max(OUTCOME_MIN_PRICE, Math.min(OUTCOME_MAX_PRICE, price));
}

function floorOutcomePrice(price: number): number {
  const factor = 10 ** OUTCOME_PRICE_DECIMALS;
  // Matches the first-party client's tiny guard against binary float underflow.
  return Math.floor(price * factor + 1e-9) / factor;
}

/** Official-client market bound: midpoint +/- 8%, clamped and floored to the outcome tick. */
export function outcomeMarketIocPrice(
  referencePrice: number,
  isBuy: boolean,
  slippage = OUTCOME_MARKET_SLIPPAGE,
): number {
  if (!(Number.isFinite(referencePrice) && referencePrice > 0)) {
    throw new RangeError('Outcome reference price must be positive and finite.');
  }
  if (!(Number.isFinite(slippage) && slippage >= 0)) {
    throw new RangeError('Outcome slippage must be non-negative and finite.');
  }
  const adversePrice = referencePrice * (isBuy ? 1 + slippage : 1 - slippage);
  return clampOutcomePrice(floorOutcomePrice(clampOutcomePrice(adversePrice)));
}
