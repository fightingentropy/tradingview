import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OUTCOME_ASSET_OFFSET,
  OUTCOME_MARKET_SLIPPAGE,
  OUTCOME_MAX_PRICE,
  OUTCOME_MIN_NOTIONAL,
  OUTCOME_MIN_PRICE,
  OUTCOME_PRICE_DECIMALS,
  OUTCOME_SIZE_DECIMALS,
  OUTCOME_WEI_DECIMALS,
  clampOutcomePrice,
  isOutcomeTradingAllowed,
  meetsOutcomeMinimumNotional,
  outcomeAssetId,
  outcomeCoinKey,
  outcomeMarketIocPrice,
  outcomeOrderNotional,
  outcomeOrderSize,
  outcomeSharesFromQuote,
  outcomeTokenName,
  parseOutcomeContractId,
  wholeOutcomeShares,
} from '../src/lib/outcomeTrading.ts';

test('locks Hyperliquid outcome trading constants', () => {
  assert.equal(OUTCOME_ASSET_OFFSET, 100_000_000);
  assert.equal(OUTCOME_SIZE_DECIMALS, 0);
  assert.equal(OUTCOME_WEI_DECIMALS, 5);
  assert.equal(OUTCOME_PRICE_DECIMALS, 5);
  assert.equal(OUTCOME_MIN_PRICE, 0.00001);
  assert.equal(OUTCOME_MAX_PRICE, 0.99999);
  assert.equal(OUTCOME_MARKET_SLIPPAGE, 0.08);
  assert.equal(OUTCOME_MIN_NOTIONAL, 10);
});

test('round-trips market, balance, and signed-action outcome ids', () => {
  const expected = {
    outcomeId: 856,
    side: 1,
    encoding: 8561,
    coinKey: '#8561',
    tokenName: '+8561',
    assetId: 100_008_561,
  };
  assert.deepEqual(parseOutcomeContractId('#8561'), expected);
  assert.deepEqual(parseOutcomeContractId('+8561'), expected);
  assert.deepEqual(parseOutcomeContractId(100_008_561), expected);
  assert.equal(outcomeCoinKey(856, 1), expected.coinKey);
  assert.equal(outcomeTokenName(856, 1), expected.tokenName);
  assert.equal(outcomeAssetId(856, 1), expected.assetId);
  assert.throws(() => outcomeAssetId(856, 2), RangeError);
  assert.throws(() => outcomeCoinKey(-1, 0), RangeError);

  assert.equal(parseOutcomeContractId('#8562'), null);
  assert.equal(parseOutcomeContractId('+not-a-contract'), null);
  assert.equal(parseOutcomeContractId(99_999_999), null);
  assert.equal(parseOutcomeContractId(Number.MAX_SAFE_INTEGER + 1), null);
});

test('requires every legal eligibility signal and fails closed', () => {
  const allowed = { acceptedTerms: true, userAllowed: true, restrictions: 'n' };
  assert.equal(isOutcomeTradingAllowed(allowed), true);
  assert.equal(isOutcomeTradingAllowed({ ...allowed, acceptedTerms: false }), false);
  assert.equal(isOutcomeTradingAllowed({ ...allowed, userAllowed: false }), false);
  assert.equal(isOutcomeTradingAllowed({ ...allowed, restrictions: 'a' }), false);
  assert.equal(isOutcomeTradingAllowed({ ...allowed, restrictions: 'o' }), false);
  assert.equal(isOutcomeTradingAllowed({ ...allowed, restrictions: 'u' }), false);
  assert.equal(
    isOutcomeTradingAllowed({ acceptedTerms: 'yes', userAllowed: true, restrictions: 'n' }),
    false,
  );
  assert.equal(isOutcomeTradingAllowed(null), false);
  assert.equal(isOutcomeTradingAllowed(undefined), false);
});

test('converts user amounts to whole shares without overspending quote currency', () => {
  assert.equal(wholeOutcomeShares(20.99), 20);
  assert.equal(wholeOutcomeShares(-1), 0);
  assert.equal(wholeOutcomeShares(Number.NaN), 0);
  assert.equal(outcomeSharesFromQuote(12, 0.58), 20);
  assert.equal(outcomeSharesFromQuote(12, 0), 0);

  assert.deepEqual(outcomeOrderSize(20.99, 'shares', 0.58), {
    shares: 20,
    notional: 11.6,
    meetsMinimum: true,
  });
  assert.deepEqual(outcomeOrderSize(10, 'quote', 0.58), {
    shares: 17,
    notional: 9.86,
    meetsMinimum: false,
  });
});

test('calculates and validates the documented minimum order notional', () => {
  assert.equal(outcomeOrderNotional(20.9, 0.5), 10);
  assert.equal(meetsOutcomeMinimumNotional(20.9, 0.5), true);
  assert.equal(meetsOutcomeMinimumNotional(19.9, 0.5), false);
  assert.equal(meetsOutcomeMinimumNotional(1, 0.5, 0), true);
  assert.equal(meetsOutcomeMinimumNotional(1, 0.5, Number.NaN), false);
});

test('builds official 8% IOC bounds with outcome price clamps', () => {
  assert.equal(clampOutcomePrice(0), OUTCOME_MIN_PRICE);
  assert.equal(clampOutcomePrice(1), OUTCOME_MAX_PRICE);
  assert.equal(outcomeMarketIocPrice(0.58252, true), 0.62912);
  assert.equal(outcomeMarketIocPrice(0.58252, false), 0.53591);
  assert.equal(outcomeMarketIocPrice(0.999, true), OUTCOME_MAX_PRICE);
  assert.equal(outcomeMarketIocPrice(0.00001, false), OUTCOME_MIN_PRICE);
  assert.throws(() => clampOutcomePrice(Number.NaN), RangeError);
  assert.throws(() => outcomeMarketIocPrice(Number.NaN, true), RangeError);
  assert.throws(() => outcomeMarketIocPrice(0.5, true, -0.01), RangeError);
});

test('quote sizing at the reviewed IOC wire price never exceeds maximum spend', () => {
  const maximumSpend = 100;
  const midpoint = (0.58 + 0.6) / 2;
  const reviewedIocPrice = outcomeMarketIocPrice(midpoint, true);
  const sized = outcomeOrderSize(maximumSpend, 'quote', reviewedIocPrice);

  assert.equal(reviewedIocPrice, 0.6372);
  assert.equal(sized.shares, 156);
  assert.ok(sized.notional <= maximumSpend);
  assert.ok(maximumSpend - sized.notional < reviewedIocPrice);
  assert.equal(sized.notional, sized.shares * reviewedIocPrice);
});

test('the 8% IOC helper is applied to the book midpoint, not bid or ask', () => {
  const bestBid = 0.58;
  const bestAsk = 0.6;
  const midpoint = (bestBid + bestAsk) / 2;

  const buyIocPrice = outcomeMarketIocPrice(midpoint, true);
  const sellIocPrice = outcomeMarketIocPrice(midpoint, false);

  assert.equal(buyIocPrice, 0.6372);
  assert.equal(sellIocPrice, 0.5428);
  assert.notEqual(buyIocPrice, outcomeMarketIocPrice(bestAsk, true));
  assert.notEqual(sellIocPrice, outcomeMarketIocPrice(bestBid, false));
});
