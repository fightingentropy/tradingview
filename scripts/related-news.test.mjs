import assert from 'node:assert/strict';
import test from 'node:test';

import { createRelatedNewsMatcher } from '../src/domain/relatedNews.ts';

const instrument = (symbol, extra = {}) => ({ id: `hl:perp:${symbol}`, symbol, name: `${symbol} Perpetual`, assetClass: 'crypto-perp', ...extra });
const item = (text, extra = {}) => ({ id: text, source: 'x', author: { name: 'Reporter' }, text, publishedAt: '2026-09-08T12:00:00Z', ...extra });
const matchedSymbols = (symbols, text) => createRelatedNewsMatcher(symbols.map((symbol) => instrument(symbol)))([item(text)]).flatMap((entry) => entry.instruments.map((entry) => entry.symbol));

test('matches known project/company names and explicit ticker mentions', () => {
  assert.deepEqual(matchedSymbols(['BTC', 'ETH', 'HYPE', 'NVDA'], 'Bitcoin and Ethereum rose as Nvidia reported earnings.'), ['BTC', 'ETH', 'NVDA']);
  assert.deepEqual(matchedSymbols(['BTC', 'HYPE', 'ON'], '$BTC is up; $hype is active. $ON earnings today.'), ['BTC', 'HYPE', 'ON']);
  assert.deepEqual(matchedSymbols(['HYPE', 'HOOD', 'LITE'], 'Hyperliquid, Robinhood and Lumentum announced updates.'), ['HYPE', 'HOOD', 'LITE']);
});

test('ordinary words and ambiguous tickers cannot create spurious news', () => {
  const symbols = ['HYPE', 'ON', 'GAS', 'LITE', 'HOOD', 'AAPL', 'AMZN', 'GOOGL'];
  assert.deepEqual(matchedSymbols(symbols, 'The hype is on. Get a lite coat with a hood. Apple pie near the Amazon, learning the alphabet.'), []);
  assert.deepEqual(matchedSymbols(symbols, 'HYPE ON GAS LITE HOOD'), []);
  assert.deepEqual(matchedSymbols(symbols, 'Apple shares and Amazon earnings improved. Alphabet revenue rose.'), ['AAPL', 'AMZN', 'GOOGL']);
  assert.deepEqual(matchedSymbols(symbols, 'gas futures rose, but the stove is off.'), ['GAS']);
});

test('matches token boundaries without using links, handles or publisher names', () => {
  const matcher = createRelatedNewsMatcher([instrument('BTC'), instrument('NVDA')]);
  assert.equal(matcher([item('ABTC $BTC2 and NVDA2 are unrelated.')]).length, 0);
  assert.equal(matcher([item('See https://example.com/$BTC?NVDA=true and @BTC', { author: { name: 'BTC NVDA' } })]).length, 0);
  assert.equal(matcher([item('(BTC), NVDA!')])[0].instruments.length, 2);
});

test('short tickers need a cashtag or financial phrase', () => {
  assert.deepEqual(matchedSymbols(['MU', 'ON'], 'mu is a Greek letter; turn it on.'), []);
  assert.deepEqual(matchedSymbols(['MU', 'ON'], 'MU shares rose after Micron earnings. $ON gained.'), ['MU', 'ON']);
});

test('supports explicit market aliases and underlying Unit spot wrappers', () => {
  assert.deepEqual(matchedSymbols(['SP500', 'XYZ100'], 'The S&P 500 outperformed the Nasdaq-100.'), ['SP500', 'XYZ100']);
  const matcher = createRelatedNewsMatcher([instrument('UBTC', { assetClass: 'crypto-spot', name: 'UBTC/USDC' })]);
  assert.equal(matcher([item('Bitcoin liquidity grew')]).length, 1);
  assert.equal(matcher([item('$UBTC liquidity grew')]).length, 1);
});

test('deduplicates by source and id, sorts newest first, and excludes outcome labels', () => {
  const matcher = createRelatedNewsMatcher([instrument('BTC'), instrument('YES', { assetClass: 'outcome', name: 'Will Bitcoin rise?' })]);
  const old = item('Bitcoin older', { id: 'same', publishedAt: '2026-09-07T12:00:00Z' });
  const fresh = item('BTC newer', { id: 'same', source: 'telegram' });
  const results = matcher([old, old, fresh, item('$YES wins')]);
  assert.deepEqual(results.map((entry) => entry.item.source), ['telegram', 'x']);
  assert.deepEqual(results.flatMap((entry) => entry.instruments.map((entry) => entry.symbol)), ['BTC', 'BTC']);
});
