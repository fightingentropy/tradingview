import assert from 'node:assert/strict';
import test from 'node:test';
import { marketPriceState } from '../src/lib/marketFreshness.ts';
import { marketCatalogErrorForId, marketDataError, retainUnavailableMarkets } from '../src/lib/marketCatalog.ts';
import { candleCreatesGap, mergeCandleHistory } from '../src/lib/candleHistory.ts';

const now = 1_800_000_000_000;
const btc = { id: 'hl:perp:BTC', source: 'hyperliquid', assetClass: 'crypto-perp', coinKey: 'BTC' };
const spot = { id: 'hl:spot:@107', source: 'hyperliquid', assetClass: 'crypto-spot', coinKey: '@107' };
const quote = (last, ts) => ({ instrumentId: btc.id, last, ts });

test('a newer REST quote wins over an old socket tick after an outage', () => {
  const result = marketPriceState(btc, quote(110, now - 1_000), { last: 90, ts: now - 80_000 }, 'reconnecting', now);
  assert.equal(result.last, 110);
  assert.equal(result.ts, now - 1_000);
  assert.equal(result.status, 'reconnecting');
});

test('stale status advances without a price change and disconnected data is never labelled live', () => {
  const tick = { last: 100, ts: now };
  assert.equal(marketPriceState(btc, undefined, tick, 'connected', now).status, 'live');
  assert.equal(marketPriceState(btc, undefined, tick, 'connected', now + 40_000).status, 'snapshot');
  assert.equal(marketPriceState(btc, undefined, tick, 'connected', now + 130_000).status, 'stale');
  assert.equal(marketPriceState(btc, undefined, tick, 'paused', now).status, 'paused');
});

test('invalid or future ticks cannot replace a valid price; zero is valid only for outcomes', () => {
  for (const tick of [{ last: NaN, ts: now }, { last: -1, ts: now }, { last: 150, ts: now + 60_000 }, { last: 0, ts: now }]) {
    assert.equal(marketPriceState(btc, quote(100, now - 1_000), tick, 'connected', now).last, 100);
  }
  assert.equal(marketPriceState({ ...btc, assetClass: 'outcome' }, undefined, { last: 0, ts: now }, 'connected', now).last, 0);
  assert.equal(marketPriceState({ ...btc, source: 'cboe' }, quote(20, now), undefined, 'idle', now).status, 'delayed');
});

test('partial catalog failure preserves only failed sections and their original quote times', () => {
  const oldQuotes = { [btc.id]: quote(100, now - 100_000), [spot.id]: { ...quote(5, now - 100_000), instrumentId: spot.id } };
  const previous = { instruments: [btc, spot], quotes: oldQuotes };
  const errors = { 'hyperliquid:spot': 'Unavailable' };
  const retained = retainUnavailableMarkets({ instruments: [], quotes: {} }, previous, errors);
  assert.deepEqual(retained.instruments, [spot]);
  assert.equal(retained.quotes[spot.id].ts, now - 100_000);
  assert.equal(retained.quotes[btc.id], undefined, 'healthy section may legitimately delist a market');
  assert.equal(marketDataError(spot, errors), 'Unavailable');
  assert.equal(marketDataError(btc, errors), null);
  assert.equal(marketCatalogErrorForId(spot.id, errors), 'Unavailable');
  assert.equal(marketCatalogErrorForId(btc.id, errors), null);
  assert.equal(retainUnavailableMarkets({ instruments: [], quotes: {} }, previous, {}).instruments.length, 0);
});

test('a whole provider outage keeps saved symbols while another source can update', () => {
  const vix = { id: 'cboe:VIX', source: 'cboe', assetClass: 'index' };
  const result = retainUnavailableMarkets({ instruments: [vix], quotes: {} }, { instruments: [btc, spot], quotes: {} }, { hyperliquid: 'Offline' });
  assert.deepEqual(result.instruments.map((instrument) => instrument.id), [vix.id, btc.id, spot.id]);
});

const bar = (minute, close = 100) => ({ t: now + minute * 60_000, o: 100, h: Math.max(101, close), l: Math.min(99, close), c: close, v: 1 });

test('backfill repairs missing and previously closed bars while retaining newer in-flight ticks', () => {
  const snapshot = [bar(0, 100), bar(1, 104), bar(2, 106)];
  const concurrentTicks = [bar(2, 108), bar(3, 110)];
  const repaired = mergeCandleHistory(snapshot, concurrentTicks, 4);
  assert.deepEqual(repaired.map((candle) => candle.c), [100, 104, 108, 110]);
  assert.deepEqual(mergeCandleHistory([bar(0), bar(2)], [bar(1), bar(2, 105)], 2).map((candle) => candle.c), [100, 105]);
});

test('invalid candle frames are rejected and missing intervals request recovery', () => {
  assert.equal(candleCreatesGap(bar(0), bar(2), 60_000), true);
  assert.equal(candleCreatesGap(bar(0), bar(1), 60_000), false);
  assert.equal(candleCreatesGap(bar(2), bar(1), 60_000), false);
  assert.deepEqual(mergeCandleHistory([bar(0)], [{ ...bar(1), c: NaN }, { ...bar(2), h: 50 }], 10), [bar(0)]);
});
