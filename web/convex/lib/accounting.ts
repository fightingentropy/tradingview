/**
 * Versioned fixed-point accounting primitives.
 *
 * JavaScript numbers are permitted only at the UI/database compatibility
 * boundary. All domain calculations in this module use bigint atoms and an
 * explicit precision and rounding rule.
 */

export const ACCOUNTING_VERSION = "fixed-point-v1" as const;
export const ROUNDING_RULE = "half-even" as const;

export const CASH_PRECISION = 6;
export const PRICE_PRECISION = 8;
export const QUANTITY_PRECISION = 8;
export const FUNDING_RATE_PRECISION = 12;

const MAX_ABS_ATOMS = 10n ** 30n;

const assertAtomRange = (atoms: bigint): bigint => {
  if (atoms > MAX_ABS_ATOMS || atoms < -MAX_ABS_ATOMS) {
    throw new AccountingInputError("Value is out of the supported range.");
  }
  return atoms;
};

export type RoundingMode = "reject" | "half-even" | "toward-zero";

export class AccountingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingInputError";
  }
}

const pow10 = (precision: number): bigint => {
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) {
    throw new AccountingInputError(
      "Precision must be an integer from 0 to 18.",
    );
  }
  return 10n ** BigInt(precision);
};

const decimalParts = (value: string | number) => {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new AccountingInputError("Value must be finite.");
  }
  const source = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) {
    throw new AccountingInputError("Value must be a base-10 decimal.");
  }

  const negative = match[1] === "-";
  const whole = match[2];
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
    throw new AccountingInputError("Decimal exponent is out of range.");
  }

  // Keep leading zeros while positioning the decimal point. BigInt accepts
  // them, and removing them here would turn values such as 0.1 into 1.
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  const integerDigits =
    decimalIndex <= 0
      ? "0"
      : `${digits}${"0".repeat(Math.max(0, decimalIndex - digits.length))}`.slice(
          0,
          decimalIndex,
        );
  const fractionDigits =
    decimalIndex <= 0
      ? `${"0".repeat(-decimalIndex)}${digits}`
      : digits.slice(decimalIndex);

  return {
    negative,
    integerDigits: integerDigits || "0",
    fractionDigits,
  };
};

const shouldRoundHalfEven = (kept: bigint, discarded: string): boolean => {
  if (!discarded) return false;
  const first = discarded.charCodeAt(0) - 48;
  if (first > 5) return true;
  if (first < 5) return false;
  if (/[1-9]/.test(discarded.slice(1))) return true;
  return kept % 2n !== 0n;
};

export const decimalToAtoms = (
  value: string | number,
  precision: number,
  options: {
    rounding?: RoundingMode;
    allowNegative?: boolean;
    allowZero?: boolean;
  } = {},
): bigint => {
  const rounding = options.rounding ?? "reject";
  const { negative, integerDigits, fractionDigits } = decimalParts(value);
  if (negative && options.allowNegative === false) {
    throw new AccountingInputError("Value cannot be negative.");
  }

  const scale = pow10(precision);
  const keptFraction = fractionDigits
    .slice(0, precision)
    .padEnd(precision, "0");
  const discarded = fractionDigits.slice(precision);
  if (rounding === "reject" && /[1-9]/.test(discarded)) {
    throw new AccountingInputError(
      `Value exceeds the supported ${precision}-decimal precision.`,
    );
  }

  let atoms = BigInt(integerDigits) * scale + BigInt(keptFraction || "0");
  if (rounding === "half-even" && shouldRoundHalfEven(atoms, discarded)) {
    atoms += 1n;
  }
  if (negative) atoms = -atoms;

  assertAtomRange(atoms);
  if (options.allowZero === false && atoms === 0n) {
    throw new AccountingInputError("Value must be greater than zero.");
  }
  return atoms;
};

export const atomsToDecimal = (atoms: bigint, precision: number): string => {
  assertAtomRange(atoms);
  const scale = pow10(precision);
  const negative = atoms < 0n;
  const absolute = negative ? -atoms : atoms;
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(precision, "0")
    .replace(/0+$/, "");
  const value = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative && absolute !== 0n ? `-${value}` : value;
};

export const atomsToNumber = (atoms: bigint, precision: number): number => {
  const value = Number(atomsToDecimal(atoms, precision));
  if (!Number.isFinite(value)) {
    throw new AccountingInputError("Value cannot be represented for display.");
  }
  return value;
};

/** Read an authoritative canonical value, falling back to a rounded legacy
 * number while old rows are migrated lazily on their next mutation. */
export const readStoredAtoms = (
  exactValue: string | undefined,
  legacyValue: number,
  precision: number,
  allowNegative = true,
): bigint =>
  decimalToAtoms(exactValue ?? legacyValue, precision, {
    allowNegative,
    rounding: exactValue === undefined ? "half-even" : "reject",
  });

export const mulDiv = (
  left: bigint,
  right: bigint,
  divisor: bigint,
  rounding: Exclude<RoundingMode, "reject"> = ROUNDING_RULE,
): bigint => {
  if (divisor <= 0n) {
    throw new AccountingInputError("Divisor must be positive.");
  }
  const product = left * right;
  const negative = product < 0n;
  const absolute = negative ? -product : product;
  let quotient = absolute / divisor;
  const remainder = absolute % divisor;
  if (rounding === "half-even") {
    const doubled = remainder * 2n;
    if (doubled > divisor || (doubled === divisor && quotient % 2n !== 0n)) {
      quotient += 1n;
    }
  }
  return assertAtomRange(negative ? -quotient : quotient);
};

export const rescale = (
  atoms: bigint,
  fromPrecision: number,
  toPrecision: number,
  rounding: Exclude<RoundingMode, "reject"> = ROUNDING_RULE,
): bigint => {
  if (fromPrecision === toPrecision) return atoms;
  if (fromPrecision < toPrecision) {
    return assertAtomRange(atoms * pow10(toPrecision - fromPrecision));
  }
  return mulDiv(atoms, 1n, pow10(fromPrecision - toPrecision), rounding);
};

export const cashAtoms = (value: string | number, allowZero = false) =>
  decimalToAtoms(value, CASH_PRECISION, {
    allowNegative: false,
    allowZero,
  });

export const signedCashAtoms = (value: string | number) =>
  decimalToAtoms(value, CASH_PRECISION, { allowNegative: true });

export const priceAtoms = (value: string | number) =>
  decimalToAtoms(value, PRICE_PRECISION, {
    allowNegative: false,
    allowZero: false,
  });

export const quantityAtoms = (value: string | number, allowZero = false) =>
  decimalToAtoms(value, QUANTITY_PRECISION, {
    allowNegative: false,
    allowZero,
  });

export const signedQuantityAtoms = (value: string | number) =>
  decimalToAtoms(value, QUANTITY_PRECISION, { allowNegative: true });

export const fundingRateAtoms = (value: string | number) =>
  decimalToAtoms(value, FUNDING_RATE_PRECISION, { allowNegative: true });

export const notionalCashAtoms = (size: bigint, price: bigint): bigint =>
  mulDiv(
    size,
    price,
    pow10(QUANTITY_PRECISION + PRICE_PRECISION - CASH_PRECISION),
  );

export const realizedPnlCashAtoms = (
  entryPrice: bigint,
  fillPrice: bigint,
  closedSize: bigint,
  direction: "long" | "short",
): bigint => {
  const priceDelta =
    direction === "long" ? fillPrice - entryPrice : entryPrice - fillPrice;
  return notionalCashAtoms(closedSize, priceDelta);
};

export const weightedAveragePriceAtoms = (
  currentSize: bigint,
  currentPrice: bigint,
  addedSize: bigint,
  addedPrice: bigint,
): bigint => {
  if (currentSize < 0n || addedSize < 0n) {
    throw new AccountingInputError("Weighted sizes cannot be negative.");
  }
  const total = currentSize + addedSize;
  if (total === 0n) return addedPrice;
  return mulDiv(currentPrice * currentSize + addedPrice * addedSize, 1n, total);
};

export const applySpotFill = ({
  quoteBalance,
  baseBalance,
  size,
  price,
  side,
}: {
  quoteBalance: bigint;
  baseBalance: bigint;
  size: bigint;
  price: bigint;
  side: "buy" | "sell";
}) => {
  if (quoteBalance < 0n || baseBalance < 0n || size <= 0n || price <= 0n) {
    throw new AccountingInputError("Spot fill inputs are out of range.");
  }
  const notional = notionalCashAtoms(size, price);
  if (side === "buy") {
    if (notional > quoteBalance) {
      throw new AccountingInputError("Insufficient quote balance.");
    }
    return {
      quoteBalance: quoteBalance - notional,
      baseBalance: baseBalance + size,
      notional,
    };
  }
  if (size > baseBalance) {
    throw new AccountingInputError("Insufficient base balance.");
  }
  return {
    quoteBalance: quoteBalance + notional,
    baseBalance: baseBalance - size,
    notional,
  };
};

export const liquidationPriceAtoms = ({
  entryPrice,
  equity,
  size,
  side,
}: {
  entryPrice: bigint;
  equity: bigint;
  size: bigint;
  side: "long" | "short";
}) => {
  if (entryPrice <= 0n || equity < 0n || size <= 0n) {
    throw new AccountingInputError("Liquidation inputs are out of range.");
  }
  const priceDistance = mulDiv(
    equity,
    pow10(PRICE_PRECISION + QUANTITY_PRECISION - CASH_PRECISION),
    size,
  );
  return side === "long"
    ? entryPrice > priceDistance
      ? entryPrice - priceDistance
      : 0n
    : entryPrice + priceDistance;
};

export const fundingCashAtoms = ({
  size,
  price,
  rate,
  hours,
  side,
}: {
  size: bigint;
  price: bigint;
  rate: bigint;
  hours: bigint;
  side: "long" | "short";
}) => {
  if (size < 0n || price <= 0n || hours < 0n) {
    throw new AccountingInputError("Funding inputs are out of range.");
  }
  const notional = notionalCashAtoms(size, price);
  const perHour = mulDiv(notional, rate, pow10(FUNDING_RATE_PRECISION));
  const signed = side === "long" ? -perHour : perHour;
  return assertAtomRange(signed * hours);
};

export const validateSlippageBps = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new AccountingInputError("Slippage must be from 0 to 10000 bps.");
  }
  return value;
};

export const isExecutionWithinSlippage = ({
  referencePrice,
  executionPrice,
  side,
  maxSlippageBps,
}: {
  referencePrice: bigint;
  executionPrice: bigint;
  side: "buy" | "sell";
  maxSlippageBps: number;
}) => {
  validateSlippageBps(maxSlippageBps);
  if (referencePrice <= 0n || executionPrice <= 0n) return false;
  const bps = BigInt(maxSlippageBps);
  return side === "buy"
    ? executionPrice * 10_000n <= referencePrice * (10_000n + bps)
    : executionPrice * 10_000n >= referencePrice * (10_000n - bps);
};

export const normalizeIdempotencyKey = (value: string): string => {
  const key = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new AccountingInputError(
      "Idempotency key must contain 16 to 128 URL-safe characters.",
    );
  }
  return key;
};

export const canonicalSymbol = (value: string): string => {
  const trimmed = String(value ?? "").trim();
  const hasVenue = trimmed.includes(":");
  const isXyz = trimmed.toLowerCase().startsWith("xyz:");
  if (hasVenue && !isXyz) {
    throw new AccountingInputError("Asset venue is invalid.");
  }
  const asset = isXyz ? trimmed.slice(trimmed.indexOf(":") + 1) : trimmed;
  const symbol = asset.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol)) {
    throw new AccountingInputError("Asset symbol is invalid.");
  }
  return isXyz ? `xyz:${symbol}` : symbol;
};

export const exactFields = (atoms: bigint, precision: number) => ({
  exactValue: atomsToDecimal(atoms, precision),
  precision,
  accountingVersion: ACCOUNTING_VERSION,
  roundingRule: ROUNDING_RULE,
});

export const accountingMetadata = {
  accountingVersion: ACCOUNTING_VERSION,
  roundingRule: ROUNDING_RULE,
} as const;
