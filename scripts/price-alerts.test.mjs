import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPO_PUSH_TOKEN_PATTERN,
  normalizeRemotePriceRule,
  priceAlertDeliveryLabel,
  priceAlertMove,
  priceMonitorLabel,
  priceMonitorSignaturePayload,
  remotePriceRuleKey,
} from '../src/domain/priceAlerts.ts';

const rule = Object.freeze({ id: 'btc-rise', instrumentId: 'hl:perp:BTC', symbol: 'BTC', source: 'hyperliquid', coinKey: 'BTC', direction: 'up', pct: 10, anchorPrice: 100, createdAt: 1_788_825_000_000 });

test('accepts explicit supported market rules and returns only the wire contract', () => {
  assert.deepEqual(normalizeRemotePriceRule({ ...rule, unrelated: 'discard' }), rule);
  assert.deepEqual(normalizeRemotePriceRule({ ...rule, instrumentId: 'cboe:VIX', symbol: 'VIX', source: 'cboe', coinKey: '_VIX' }), { ...rule, instrumentId: 'cboe:VIX', symbol: 'VIX', source: 'cboe', coinKey: '_VIX' });
  assert.equal(normalizeRemotePriceRule({ ...rule, source: 'http', coinKey: 'https://example.test' }), null);
  assert.equal(normalizeRemotePriceRule({ ...rule, source: 'cboe', instrumentId: 'cboe:OTHER', coinKey: '_OTHER' }), null);
});

test('rejects malformed JSON directions instead of converting arrays into a both-direction rule', () => {
  for (const direction of [['up'], ['down'], {}, 1, null, 'UP', '', 'sideways']) {
    assert.equal(normalizeRemotePriceRule({ ...rule, direction }), null, JSON.stringify(direction));
  }
});

test('preserves completed generations explicitly without coercing malformed completion flags', () => {
  assert.deepEqual(normalizeRemotePriceRule({ ...rule, completed: true }), { ...rule, completed: true });
  assert.deepEqual(normalizeRemotePriceRule({ ...rule, completed: false }), rule);
  for (const completed of ['true', 1, 0, null, [], {}]) assert.equal(normalizeRemotePriceRule({ ...rule, completed }), null);
});

test('rejects non-finite amounts, invalid generations, control characters and oversized fields', () => {
  for (const pct of [0, -1, NaN, Infinity, 10_001, '10']) assert.equal(normalizeRemotePriceRule({ ...rule, pct }), null);
  for (const anchorPrice of [0, -1, NaN, Infinity, '100']) assert.equal(normalizeRemotePriceRule({ ...rule, anchorPrice }), null);
  for (const createdAt of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) assert.equal(normalizeRemotePriceRule({ ...rule, createdAt }), null);
  assert.equal(normalizeRemotePriceRule({ ...rule, id: 'bad\nrule' }), null);
  assert.equal(normalizeRemotePriceRule({ ...rule, symbol: 'a'.repeat(41) }), null);
  assert.equal(normalizeRemotePriceRule({ ...rule, coinKey: 'BTC?url=https://example.test' }), null);
});

test('triggers inclusive thresholds in the chosen direction, using the recorded anchor', () => {
  assert.equal(priceAlertMove(rule, 110), 10);
  assert.equal(priceAlertMove(rule, 109.99), null);
  assert.equal(priceAlertMove(rule, 80), null);
  assert.equal(priceAlertMove({ ...rule, direction: 'down' }, 90), -10);
  assert.equal(priceAlertMove({ ...rule, direction: 'down' }, 120), null);
  assert.equal(priceAlertMove({ ...rule, direction: 'both' }, 90), -10);
  assert.equal(priceAlertMove({ ...rule, direction: 'both' }, 110), 10);
  for (const price of [0, -1, NaN, Infinity]) assert.equal(priceAlertMove(rule, price), null);
});

test('rearming changes the deduplication generation even with the same alert id', () => {
  assert.notEqual(remotePriceRuleKey(rule), remotePriceRuleKey({ ...rule, createdAt: rule.createdAt + 1 }));
  assert.equal(remotePriceRuleKey(rule), remotePriceRuleKey({ ...rule }));
});

test('a monitor signature binds the exact request method, path, timestamp and body bytes', () => {
  assert.equal(priceMonitorSignaturePayload('post', '/price-alerts/monitor/sync', '1788825000', '{"a":1}'), 'POST\n/price-alerts/monitor/sync\n1788825000\n{"a":1}');
  assert.notEqual(priceMonitorSignaturePayload('POST', '/a', '1', '{"a":1}'), priceMonitorSignaturePayload('POST', '/a', '1', '{ "a":1}'));
});

test('distinguishes offline monitor, unapplied rules and stale individual price sources', () => {
  const now = rule.createdAt;
  const monitor = { seenAt: now, lastHyperliquidAt: now, lastCboeAt: now, connected: true, pendingEvents: 0, version: '1' };
  const result = { now, enabled: true, revision: 2, monitorRevision: 2, monitor, events: [] };
  assert.equal(priceMonitorLabel(result, ['hyperliquid'], now), 'Monitoring on Mac mini');
  assert.equal(priceMonitorLabel({ ...result, monitor: null }, ['hyperliquid'], now), 'Mac mini is offline');
  assert.equal(priceMonitorLabel({ ...result, monitor: { ...monitor, seenAt: now - 60_001 } }, ['hyperliquid'], now), 'Mac mini is offline');
  assert.equal(priceMonitorLabel({ ...result, monitorRevision: 1 }, ['hyperliquid'], now), 'Waiting for Mac mini to sync');
  assert.equal(priceMonitorLabel({ ...result, monitor: { ...monitor, lastHyperliquidAt: now - 45_001 } }, ['hyperliquid'], now), 'Mac mini is reconnecting to prices');
  assert.equal(priceMonitorLabel({ ...result, monitor: { ...monitor, connected: false } }, ['hyperliquid'], now), 'Mac mini is reconnecting to prices');
  assert.equal(priceMonitorLabel({ ...result, monitor: { ...monitor, lastCboeAt: now - 150_001 } }, ['cboe'], now), 'Cboe quotes are unavailable');
  assert.equal(priceMonitorLabel({ ...result, monitor: { ...monitor, connected: false } }, ['cboe'], now), 'Monitoring on Mac mini · Cboe delayed');
});

test('keeps push acceptance distinct from final receipt status', () => {
  assert.equal(priceAlertDeliveryLabel('accepted'), 'Accepted by push service');
  assert.equal(priceAlertDeliveryLabel('sent'), 'Notification sent');
  assert.equal(priceAlertDeliveryLabel('unconfirmed'), 'Notification status unconfirmed');
  assert.equal(EXPO_PUSH_TOKEN_PATTERN.test('ExpoPushToken[test-token_123]'), true);
  assert.equal(EXPO_PUSH_TOKEN_PATTERN.test('ExponentPushToken[test-token_123]'), true);
  assert.equal(EXPO_PUSH_TOKEN_PATTERN.test('ExpoPushToken[test]\n'), false);
});
