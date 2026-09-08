import assert from 'node:assert/strict';
import test from 'node:test';

import { restoreRemovedSymbols, sortWatchlistView } from '../src/lib/watchlistSort.ts';

const instruments = Object.freeze([
  Object.freeze({ id: 'eth', symbol: 'ETH' }),
  Object.freeze({ id: 'btc', symbol: 'BTC' }),
  Object.freeze({ id: 'hype', symbol: 'HYPE' }),
]);
const quotes = { btc: { last: 90_000, change24hPct: 2 }, eth: { last: 3_000, change24hPct: -1 }, hype: { last: 50, change24hPct: 4 } };
const ids = (items) => items.map((item) => item.id);

test('every sort leaves manual order unchanged, and Manual restores it', () => {
  assert.deepEqual(ids(sortWatchlistView(instruments, quotes, 'symbol', 'asc')), ['btc', 'eth', 'hype']);
  assert.deepEqual(ids(sortWatchlistView(instruments, quotes, 'price', 'desc')), ['btc', 'eth', 'hype']);
  assert.deepEqual(ids(sortWatchlistView(instruments, quotes, 'change', 'desc')), ['hype', 'btc', 'eth']);
  assert.deepEqual(ids(sortWatchlistView(instruments, quotes, 'change', 'asc')), ['eth', 'btc', 'hype']);
  assert.deepEqual(ids(sortWatchlistView(instruments, quotes, 'manual', 'desc')), ['eth', 'btc', 'hype']);
  assert.deepEqual(ids(instruments), ['eth', 'btc', 'hype']);
});

test('missing and non-finite values sort last in either direction, ties retain manual order', () => {
  const partial = { eth: { last: 3, change24hPct: null }, btc: { last: 3, change24hPct: -2 }, hype: { last: NaN } };
  assert.deepEqual(ids(sortWatchlistView(instruments, partial, 'price', 'asc')), ['eth', 'btc', 'hype']);
  assert.deepEqual(ids(sortWatchlistView(instruments, partial, 'price', 'desc')), ['eth', 'btc', 'hype']);
  assert.deepEqual(ids(sortWatchlistView(instruments, partial, 'change', 'asc')), ['btc', 'eth', 'hype']);
  assert.deepEqual(ids(sortWatchlistView(instruments, partial, 'change', 'desc')), ['btc', 'eth', 'hype']);
});

test('undo restores removed symbols in order without losing subsequent additions', () => {
  const previous = ['a', 'b', 'c', 'd'];
  const current = Object.freeze(['a', 'd', 'new']);
  assert.deepEqual(restoreRemovedSymbols(current, previous, ['b', 'c']), ['a', 'b', 'c', 'd', 'new']);
  assert.deepEqual(current, ['a', 'd', 'new']);
  assert.deepEqual(restoreRemovedSymbols(['d', 'a'], previous, ['b', 'c']), ['b', 'c', 'd', 'a']);
});

test('undo never duplicates symbols already restored and handles removing the entire list', () => {
  assert.deepEqual(restoreRemovedSymbols(['a', 'b'], ['a', 'b'], ['b']), ['a', 'b']);
  assert.deepEqual(restoreRemovedSymbols([], ['a', 'b'], ['a', 'b']), ['a', 'b']);
  assert.deepEqual(restoreRemovedSymbols(['a', 'new'], ['a', 'b'], ['b']), ['a', 'b', 'new']);
  assert.deepEqual(restoreRemovedSymbols(['new'], ['a', 'b'], ['a', 'b']), ['a', 'b', 'new']);
});
