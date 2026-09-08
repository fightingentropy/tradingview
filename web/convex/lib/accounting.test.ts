import { describe, expect, test } from "bun:test";
import fixture from "../../fixtures/accounting-v1.json";
import {
  AccountingInputError,
  CASH_PRECISION,
  PRICE_PRECISION,
  QUANTITY_PRECISION,
  applySpotFill,
  atomsToDecimal,
  cashAtoms,
  canonicalSymbol,
  decimalToAtoms,
  fundingCashAtoms,
  fundingRateAtoms,
  isExecutionWithinSlippage,
  issueVaultShares,
  liquidationPriceAtoms,
  normalizeIdempotencyKey,
  notionalCashAtoms,
  priceAtoms,
  quantityAtoms,
  realizedPnlCashAtoms,
  redeemVaultShares,
  shareAtoms,
  validateSlippageBps,
  weightedAveragePriceAtoms,
} from "./accounting";

const makeRng = (seed: number) => {
  let state = seed >>> 0;
  return (maxExclusive: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % maxExclusive;
  };
};

describe("fixed-point boundaries", () => {
  test("parses canonical decimals and applies half-even rounding", () => {
    expect(atomsToDecimal(cashAtoms("0.1"), CASH_PRECISION)).toBe("0.1");
    expect(atomsToDecimal(cashAtoms("1e-3"), CASH_PRECISION)).toBe("0.001");
    expect(
      decimalToAtoms("1.2345675", CASH_PRECISION, { rounding: "half-even" }),
    ).toBe(1_234_568n);
    expect(
      decimalToAtoms("1.2345685", CASH_PRECISION, { rounding: "half-even" }),
    ).toBe(1_234_568n);
  });

  test("rejects non-finite, negative, over-precise and out-of-range inputs", () => {
    expect(() => cashAtoms(Number.NaN)).toThrow(AccountingInputError);
    expect(() => cashAtoms(Number.POSITIVE_INFINITY)).toThrow(
      AccountingInputError,
    );
    expect(() => cashAtoms("-0.01")).toThrow(AccountingInputError);
    expect(() => cashAtoms("0.0000001")).toThrow(AccountingInputError);
    expect(() => quantityAtoms("0.000000001")).toThrow(AccountingInputError);
    expect(() => cashAtoms("1e100")).toThrow(AccountingInputError);
    expect(() =>
      notionalCashAtoms(
        decimalToAtoms("1e22", QUANTITY_PRECISION),
        decimalToAtoms("1e22", PRICE_PRECISION),
      ),
    ).toThrow(AccountingInputError);
  });

  test("enforces slippage boundaries without floating-point comparisons", () => {
    const reference = priceAtoms("100");
    expect(
      isExecutionWithinSlippage({
        referencePrice: reference,
        executionPrice: priceAtoms("100.5"),
        side: "buy",
        maxSlippageBps: 50,
      }),
    ).toBe(true);
    expect(
      isExecutionWithinSlippage({
        referencePrice: reference,
        executionPrice: priceAtoms("100.50000001"),
        side: "buy",
        maxSlippageBps: 50,
      }),
    ).toBe(false);
    expect(() => validateSlippageBps(-1)).toThrow(AccountingInputError);
    expect(() => validateSlippageBps(10_001)).toThrow(AccountingInputError);
  });

  test("canonicalizes supported symbols and rejects path-like input", () => {
    expect(canonicalSymbol("xyz:btc")).toBe("xyz:BTC");
    expect(() => canonicalSymbol("other:BTC")).toThrow(AccountingInputError);
    expect(() => canonicalSymbol("../BTC")).toThrow(AccountingInputError);
    expect(() => canonicalSymbol("USDC/USDT")).toThrow(AccountingInputError);
  });
});

describe("economic invariants", () => {
  test("spot fills conserve value and never create a negative balance", () => {
    const rng = makeRng(0x5eed);
    for (let index = 0; index < 2_000; index += 1) {
      const price = priceAtoms(`${1 + rng(100_000)}.${rng(100_000_000)}`);
      const size = quantityAtoms(`${1 + rng(20)}.${rng(100_000_000)}`);
      const notional = notionalCashAtoms(size, price);
      const quote = notional + BigInt(rng(10_000_000));
      const base = quantityAtoms(`${rng(50)}.${rng(100_000_000)}`, true);
      const before = quote + notionalCashAtoms(base, price);
      const result = applySpotFill({
        quoteBalance: quote,
        baseBalance: base,
        size,
        price,
        side: "buy",
      });
      const after =
        result.quoteBalance + notionalCashAtoms(result.baseBalance, price);
      expect(result.quoteBalance).toBeGreaterThanOrEqual(0n);
      expect(result.baseBalance).toBeGreaterThanOrEqual(0n);
      // Valuing the aggregate position can introduce at most one cash atom
      // compared with valuing the two fills independently.
      expect(after - before >= -1n && after - before <= 1n).toBe(true);
    }
  });

  test("partial fills compose to the same quantity and weighted entry", () => {
    const rng = makeRng(0xc0ffee);
    for (let index = 0; index < 1_000; index += 1) {
      const firstSize = BigInt(1 + rng(1_000_000_000));
      const secondSize = BigInt(1 + rng(1_000_000_000));
      const firstPrice = BigInt(1 + rng(1_000_000_000));
      const secondPrice = BigInt(1 + rng(1_000_000_000));
      const weighted = weightedAveragePriceAtoms(
        firstSize,
        firstPrice,
        secondSize,
        secondPrice,
      );
      const total = firstSize + secondSize;
      const aggregateNotional = weighted * total;
      const fillNotional =
        firstPrice * firstSize + secondPrice * secondSize;
      expect(
        aggregateNotional - fillNotional >= -total / 2n - 1n &&
          aggregateNotional - fillNotional <= total / 2n + 1n,
      ).toBe(true);
    }
  });

  test("long and short realized PnL are symmetric", () => {
    const size = quantityAtoms("4.25");
    const entry = priceAtoms("2000.125");
    const fill = priceAtoms("2100.625");
    expect(realizedPnlCashAtoms(entry, fill, size, "long")).toBe(
      -realizedPnlCashAtoms(entry, fill, size, "short"),
    );
  });

  test("vault deposit, partial withdrawal and full withdrawal conserve shares", () => {
    let equity = cashAtoms("1000");
    let totalShares = issueVaultShares({
      deposit: equity,
      equity: 0n,
      totalShares: 0n,
    });
    let memberShares = totalShares;
    let costBasis = equity;

    const secondDeposit = cashAtoms("250");
    const secondShares = issueVaultShares({
      deposit: secondDeposit,
      equity,
      totalShares,
    });
    equity += secondDeposit;
    totalShares += secondShares;
    memberShares += secondShares;
    costBasis += secondDeposit;

    const partial = redeemVaultShares({
      shares: shareAtoms("125"),
      memberShares,
      totalShares,
      equity,
      memberCostBasis: costBasis,
    });
    equity -= partial.value;
    totalShares -= shareAtoms("125");
    memberShares = partial.remainingShares;
    costBasis = partial.remainingCostBasis;

    const final = redeemVaultShares({
      shares: memberShares,
      memberShares,
      totalShares,
      equity,
      memberCostBasis: costBasis,
    });
    expect(totalShares - memberShares).toBe(0n);
    expect(final.remainingShares).toBe(0n);
    expect(final.remainingCostBasis).toBe(0n);
  });

  test("performance fee can never exceed realized profit", () => {
    const result = redeemVaultShares({
      shares: shareAtoms("10"),
      memberShares: shareAtoms("10"),
      totalShares: shareAtoms("10"),
      equity: cashAtoms("100.000001"),
      memberCostBasis: cashAtoms("90"),
    });
    expect(result.fee).toBeLessThanOrEqual(result.profit);
    expect(result.payout + result.fee).toBe(result.value);
  });

  test("liquidation distance is monotonic with collateral and symmetric", () => {
    const entry = priceAtoms("2000");
    const size = quantityAtoms("2");
    const lowEquity = cashAtoms("100");
    const highEquity = cashAtoms("200");
    const longLow = liquidationPriceAtoms({
      entryPrice: entry,
      equity: lowEquity,
      size,
      side: "long",
    });
    const longHigh = liquidationPriceAtoms({
      entryPrice: entry,
      equity: highEquity,
      size,
      side: "long",
    });
    const shortLow = liquidationPriceAtoms({
      entryPrice: entry,
      equity: lowEquity,
      size,
      side: "short",
    });
    expect(longHigh).toBeLessThan(longLow);
    expect(entry - longLow).toBe(shortLow - entry);
  });

  test("funding accumulation composes across time windows", () => {
    const input = {
      size: quantityAtoms("3.5"),
      price: priceAtoms("2500"),
      rate: fundingRateAtoms("0.0001"),
      side: "long" as const,
    };
    const first = fundingCashAtoms({ ...input, hours: 7n });
    const second = fundingCashAtoms({ ...input, hours: 5n });
    const combined = fundingCashAtoms({ ...input, hours: 12n });
    expect(first + second).toBe(combined);
  });

  test("idempotency keys are strict and stable for retry deduplication", () => {
    const receipts = new Map<string, bigint>();
    const key = normalizeIdempotencyKey("order_01K3F9M2V7Z2Q8D4");
    const execute = () => {
      const existing = receipts.get(key);
      if (existing !== undefined) return existing;
      const result = 42n;
      receipts.set(key, result);
      return result;
    };
    expect(execute()).toBe(42n);
    expect(execute()).toBe(42n);
    expect(receipts.size).toBe(1);
    expect(() => normalizeIdempotencyKey("short")).toThrow(
      AccountingInputError,
    );
  });
});

test("precision constants stay aligned with notional scaling", () => {
  const size = decimalToAtoms("1", QUANTITY_PRECISION);
  const price = decimalToAtoms("1", PRICE_PRECISION);
  expect(notionalCashAtoms(size, price)).toBe(
    decimalToAtoms("1", CASH_PRECISION),
  );
});

test("versioned specs fixture remains executable", () => {
  expect(fixture.version).toBe("fixed-point-v1");
  expect(fixture.precision).toEqual({
    cash: CASH_PRECISION,
    price: PRICE_PRECISION,
    quantity: QUANTITY_PRECISION,
    shares: 8,
    fundingRate: 12,
  });
  expect(
    atomsToDecimal(
      notionalCashAtoms(
        quantityAtoms(fixture.notional.size),
        priceAtoms(fixture.notional.price),
      ),
      CASH_PRECISION,
    ),
  ).toBe(fixture.notional.expectedCash);
  expect(
    atomsToDecimal(
      issueVaultShares({
        deposit: cashAtoms(fixture.vaultInitialDeposit.depositCash),
        equity: 0n,
        totalShares: 0n,
      }),
      8,
    ),
  ).toBe(fixture.vaultInitialDeposit.expectedShares);
  const withdrawal = redeemVaultShares({
    shares: shareAtoms(fixture.vaultWithdrawal.shares),
    memberShares: shareAtoms(fixture.vaultWithdrawal.memberShares),
    totalShares: shareAtoms(fixture.vaultWithdrawal.totalShares),
    equity: cashAtoms(fixture.vaultWithdrawal.equityCash),
    memberCostBasis: cashAtoms(fixture.vaultWithdrawal.memberCostBasisCash),
  });
  expect(atomsToDecimal(withdrawal.profit, CASH_PRECISION)).toBe(
    fixture.vaultWithdrawal.expectedProfitCash,
  );
  expect(atomsToDecimal(withdrawal.fee, CASH_PRECISION)).toBe(
    fixture.vaultWithdrawal.expectedFeeCash,
  );
  expect(atomsToDecimal(withdrawal.payout, CASH_PRECISION)).toBe(
    fixture.vaultWithdrawal.expectedPayoutCash,
  );
  expect(
    atomsToDecimal(
      fundingCashAtoms({
        size: quantityAtoms(fixture.funding.size),
        price: priceAtoms(fixture.funding.price),
        rate: fundingRateAtoms(fixture.funding.rate),
        hours: BigInt(fixture.funding.hours),
        side: fixture.funding.side as "long",
      }),
      CASH_PRECISION,
    ),
  ).toBe(fixture.funding.expectedCash);
});
