import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/priceAlertRegistration.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
});
const { buildRemotePriceRules, priceAlertNotificationMatch } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const NOW = 1_788_825_100_000;
const BTC = Object.freeze({ id: 'hl:perp:BTC', symbol: 'BTC', source: 'hyperliquid', coinKey: 'BTC', assetClass: 'crypto-perp' });
const OUTCOME = Object.freeze({ id: 'hl:outcome:100', symbol: 'YES', source: 'hyperliquid', coinKey: '#100', assetClass: 'outcome' });
const instruments = Object.freeze({ [BTC.id]: BTC, [OUTCOME.id]: OUTCOME });
const alert = (overrides = {}) => ({ id: 'btc-rise', instrumentId: BTC.id, symbol: BTC.symbol, direction: 'up', pct: 10, anchorPrice: 100, createdAt: NOW - 10_000, triggeredAt: null, triggeredPrice: null, ...overrides });
const notification = (a, overrides = {}) => ({ type: 'price-alert', alertId: a.id, instrumentId: a.instrumentId, createdAt: a.createdAt, price: 111, triggeredAt: NOW - 1_000, ...overrides });

test('builds deterministic source-backed rules without mutating alert order or generations', () => {
  const a = Object.freeze(alert({ id: 'z-alert' }));
  const b = Object.freeze(alert({ id: 'a-alert', instrumentId: OUTCOME.id, symbol: 'YES', anchorPrice: 0.5 }));
  const original = Object.freeze([a, b]);
  const rules = buildRemotePriceRules(original, instruments, true);
  assert.deepEqual(rules.map((rule) => rule.id), ['a-alert', 'z-alert']);
  assert.equal(rules[0].coinKey, OUTCOME.coinKey);
  assert.equal(rules[1].source, BTC.source);
  assert.equal(rules[1].createdAt, a.createdAt);
  assert.equal('triggeredAt' in rules[1], false);
  assert.deepEqual(original.map((item) => item.id), ['z-alert', 'a-alert']);
});

test('keeps remotely fired generations registered while excluding legacy foreground triggers', () => {
  const armed = alert();
  const remote = alert({ id: 'remote', triggeredAt: NOW - 2_000, triggeredPrice: 111, remoteTriggered: true });
  const legacy = alert({ id: 'legacy', instrumentId: 'hl:perp:DELISTED', triggeredAt: NOW - 2_000, triggeredPrice: 111 });
  const rules = buildRemotePriceRules([armed, remote, legacy], instruments, true);
  assert.deepEqual(rules.map((rule) => rule.id), ['btc-rise', 'remote']);
  assert.equal(rules.find((rule) => rule.id === 'remote').completed, true);
  assert.equal('completed' in rules.find((rule) => rule.id === armed.id), false);
});

test('hidden outcome alerts do not require a catalog entry or register remotely', () => {
  const hidden = alert({ instrumentId: OUTCOME.id, symbol: OUTCOME.symbol, anchorPrice: 0.5 });
  assert.deepEqual(buildRemotePriceRules([hidden], {}, false), []);
  assert.throws(() => buildRemotePriceRules([hidden], {}, true), /Waiting for YES market data/);
});

test('missing catalog entries fail explicitly instead of silently canceling included rules', () => {
  assert.throws(() => buildRemotePriceRules([alert()], {}, true), /Waiting for BTC market data/);
  assert.throws(() => buildRemotePriceRules([alert({ remoteTriggered: true, triggeredAt: NOW - 2_000 })], {}, true), /Waiting for BTC market data/);
  assert.deepEqual(buildRemotePriceRules([], {}, true), []);
});

test('malformed rules and the 101st included alert cannot reach remote registration', () => {
  for (const overrides of [{ anchorPrice: 0 }, { pct: NaN }, { createdAt: 0 }, { direction: ['up'] }, { symbol: 'bad\nname' }]) {
    assert.throws(() => buildRemotePriceRules([alert(overrides)], instruments, true), /needs to be recreated/);
  }
  const rules = Array.from({ length: 100 }, (_, index) => alert({ id: `rule-${index}` }));
  assert.equal(buildRemotePriceRules(rules, instruments, true).length, 100);
  assert.throws(() => buildRemotePriceRules([...rules, alert({ id: 'rule-100' })], instruments, true), /At most 100/);
});

test('notification matching requires the exact live alert generation and instrument', () => {
  const current = alert();
  const result = priceAlertNotificationMatch(notification(current), [current], NOW);
  assert.equal(result.alert, current);
  assert.equal(result.price, 111);
  assert.equal(result.changePct, 11);
  assert.equal(priceAlertNotificationMatch(notification(current), [], NOW), null);
  assert.equal(priceAlertNotificationMatch(notification(current), [{ ...current, createdAt: current.createdAt + 1 }], NOW), null);
  assert.equal(priceAlertNotificationMatch(notification(current, { instrumentId: OUTCOME.id }), [current], NOW), null);
  assert.equal(priceAlertNotificationMatch(notification(current, { alertId: 'another' }), [current], NOW), null);
});

test('malformed, impossible and pre-generation notification values cannot trigger alerts', () => {
  const current = alert();
  for (const overrides of [
    { type: 'news' }, { createdAt: String(current.createdAt) }, { price: '111' }, { price: NaN },
    { price: Infinity }, { price: -1 }, { price: 0 }, { price: 105 }, { price: 80 },
    { triggeredAt: NaN }, { triggeredAt: Infinity }, { triggeredAt: String(NOW) },
    { triggeredAt: current.createdAt - 1 }, { triggeredAt: NOW + 60_001 },
  ]) assert.equal(priceAlertNotificationMatch(notification(current, overrides), [current], NOW), null, JSON.stringify(overrides));
});

test('a resolved outcome can trigger at zero without admitting zero-priced ordinary markets', () => {
  const outcome = alert({ instrumentId: OUTCOME.id, symbol: OUTCOME.symbol, anchorPrice: 0.5, direction: 'down', pct: 50 });
  assert.equal(priceAlertNotificationMatch(notification(outcome, { price: 0 }), [outcome], NOW)?.changePct, -100);
  const ordinary = alert({ direction: 'down', pct: 50 });
  assert.equal(priceAlertNotificationMatch(notification(ordinary, { price: 0 }), [ordinary], NOW), null);
});
