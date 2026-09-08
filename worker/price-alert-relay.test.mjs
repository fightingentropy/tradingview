import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { Miniflare, Response as MockResponse } from 'miniflare';

import { priceMonitorSignaturePayload } from '../src/domain/priceAlerts.ts';

// Every network call is intercepted. These values exist only inside ephemeral tests.
const APP_KEY = 'price-alert-test-app-key';
const MONITOR_KEY = 'price-alert-test-monitor-key';
const TOKEN = 'ExpoPushToken[price_alert_test_device]';
const DEVICE = createHash('sha256').update(TOKEN).digest('hex');
const SYNC = '/price-alerts/sync';
const MONITOR_SYNC = '/price-alerts/monitor/sync';
const EVENT = '/price-alerts/monitor/event';
let bundle;

before(async () => {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const contents = `
    import worker from './worker/news-relay.ts';
    import { MacMiniAlertRelay } from './worker/price-alert-relay.ts';
    export class TestRelay extends MacMiniAlertRelay {
      async testSql(query, ...args) { return this.ctx.storage.sql.exec(query, ...args).toArray(); }
    }
    export default {
      async fetch(request, env, ctx) {
        if (new URL(request.url).pathname === '/__test/sql') {
          const [query, ...args] = await request.json();
          return Response.json(await env.PRICE_ALERTS.getByName('mac-mini-v1').testSql(query, ...args));
        }
        return worker.fetch(request, env, ctx);
      }
    };
  `;
  const built = await build({ stdin: { contents, resolveDir: projectRoot, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], target: 'es2022' });
  bundle = built.outputFiles[0].text;
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(read, predicate, message) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function makeRule(overrides = {}) {
  return { id: 'btc-rise', instrumentId: 'hl:perp:BTC', symbol: 'BTC', source: 'hyperliquid', coinKey: 'BTC', direction: 'up', pct: 10, anchorPrice: 100, createdAt: Date.now() - 5_000, ...overrides };
}

async function fixture(t, outbound) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tradingview-alert-relay-test-'));
  const sends = [];
  const receipts = [];
  const options = {
    name: 'price-alert-test', script: bundle, modules: true,
    compatibilityDate: '2026-07-10', compatibilityFlags: ['nodejs_compat'],
    bindings: { APP_ACCESS_TOKEN: APP_KEY, BRIDGE_SECRET: MONITOR_KEY },
    kvNamespaces: ['NEWS_RELAY_KV'],
    durableObjects: { PRICE_ALERTS: { className: 'TestRelay', useSQLite: true } },
    resourcePersistencePath: path.join(directory, 'state'),
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://exp.host', 'unexpected outbound network request');
      const payload = await request.json();
      if (url.pathname.endsWith('/push/send')) {
        sends.push(payload);
        return outbound ? outbound({ type: 'send', payload, count: sends.length }) : MockResponse.json({ data: { status: 'ok', id: `receipt-${sends.length}` } });
      }
      assert.equal(url.pathname, '/--/api/v2/push/getReceipts');
      receipts.push(payload);
      return outbound ? outbound({ type: 'receipt', payload, count: receipts.length }) : MockResponse.json({ data: Object.fromEntries(payload.ids.map((id) => [id, { status: 'ok' }])) });
    },
  };
  let runtime = new Miniflare(options);
  t.after(async () => { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); });

  async function request(pathname, payload, { method = 'POST', app = false, monitor = false, timestamp, bodyOverride, signatureOverride } = {}) {
    const body = bodyOverride ?? JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    if (app) headers.Authorization = `Bearer ${APP_KEY}`;
    if (monitor) {
      const stamp = timestamp ?? String(Math.floor(Date.now() / 1_000));
      headers['X-Monitor-Timestamp'] = stamp;
      headers['X-Monitor-Signature'] = signatureOverride ?? createHmac('sha256', MONITOR_KEY).update(priceMonitorSignaturePayload(method, pathname, stamp, body)).digest('hex');
    }
    const response = await runtime.dispatchFetch(`https://relay.test${pathname}`, { method, headers, ...(method !== 'GET' ? { body } : {}) });
    return { status: response.status, body: await response.json() };
  }
  async function sql(query, ...values) {
    const response = await runtime.dispatchFetch('https://relay.test/__test/sql', { method: 'POST', body: JSON.stringify([query, ...values]) });
    assert.equal(response.status, 200);
    return response.json();
  }
  const sync = (rules, enabled = true, token = TOKEN, registrationToken) => request(SYNC, { expoPushToken: token, registrationToken, enabled, rules }, { app: true });
  const monitor = (appliedRevisions = {}) => request(MONITOR_SYNC, { health: { connected: true, lastHyperliquidAt: Date.now(), lastCboeAt: null, pendingEvents: 0, version: 'test' }, appliedRevisions }, { monitor: true });
  const trigger = (rule, overrides = {}) => request(EVENT, { device: DEVICE, alertId: rule.id, createdAt: rule.createdAt, price: 111, triggeredAt: Date.now(), ...overrides }, { monitor: true });
  return { request, sync, monitor, trigger, sql, sends, receipts, restart: async () => { await runtime.dispose(); runtime = new Miniflare(options); } };
}

async function seedEvent(f, rule, overrides = {}) {
  const event = {
    key: `${DEVICE}:${rule.id}:${rule.createdAt}`, device: DEVICE, alertId: rule.id, createdAt: rule.createdAt,
    instrumentId: rule.instrumentId, symbol: rule.symbol, price: 111, triggeredAt: Date.now() - 100,
    changePct: 11, delivery: 'pending', updatedAt: Date.now() - 120_000, attempts: 1, retryAt: Date.now() - 1_000,
    ...overrides,
  };
  await f.sql('INSERT OR REPLACE INTO events(key, device, updated_at, payload) VALUES(?,?,?,?)', event.key, event.device, event.updatedAt, JSON.stringify(event));
  return event;
}

test('signed endpoints reject missing auth, modified signatures and stale timestamps', async (t) => {
  const f = await fixture(t);
  const subscription = { expoPushToken: TOKEN, enabled: true, rules: [] };
  assert.equal((await f.request(SYNC, subscription)).status, 401);
  assert.equal((await f.request(MONITOR_SYNC, {}, { app: true })).status, 401);
  assert.equal((await f.request(MONITOR_SYNC, {}, { monitor: true, timestamp: String(Math.floor(Date.now() / 1_000) - 121) })).status, 401);
  assert.equal((await f.request(MONITOR_SYNC, {}, { monitor: true, signatureOverride: '0'.repeat(64) })).status, 401);
  const stamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac('sha256', MONITOR_KEY).update(priceMonitorSignaturePayload('POST', MONITOR_SYNC, stamp, '{}')).digest('hex');
  assert.equal((await f.request(EVENT, {}, { monitor: true, timestamp: stamp, signatureOverride: signature })).status, 401);
  assert.equal((await f.request(MONITOR_SYNC, { changed: true }, { monitor: true, timestamp: stamp, signatureOverride: signature })).status, 401);
  assert.equal((await f.sync([])).status, 200);
  assert.equal((await f.monitor()).status, 200);
  assert.equal(f.sends.length, 0);
});

test('validates subscriptions and caps request size and per-device rules', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  assert.equal((await f.sync([rule, rule])).status, 400);
  assert.equal((await f.sync([{ ...rule, direction: ['up'] }])).status, 400);
  assert.equal((await f.sync(Array.from({ length: 101 }, (_, index) => ({ ...rule, id: `rule-${index}` })))).status, 400);
  assert.equal((await f.sync([], true, 'ExpoPushToken[broken]\n')).status, 400);
  for (const registrationToken of ['', 'bad', null, 123, {}]) {
    assert.equal((await f.sync([], true, TOKEN, registrationToken)).status, 400);
  }
  assert.equal((await f.request(SYNC, {}, { app: true, bodyOverride: 'x'.repeat(128_001) })).status, 413);
});

test('acknowledges only the current subscription revision and rejects canceled or rearmed generations', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  assert.equal((await f.sync([rule])).body.revision, 1);
  assert.equal((await f.sync([rule])).body.revision, 1);
  await f.monitor({ [DEVICE]: 1 });
  assert.equal((await f.sync([rule])).body.monitorRevision, 1);
  assert.equal((await f.sync([])).body.revision, 2);
  assert.equal((await f.trigger(rule)).body.accepted, false);
  const rearmed = { ...rule, createdAt: rule.createdAt + 1 };
  assert.equal((await f.sync([rearmed])).body.revision, 3);
  await f.monitor({ [DEVICE]: 1 });
  assert.equal((await f.sync([rearmed])).body.monitorRevision, 1);
  assert.equal((await f.trigger(rule)).body.accepted, false);
  assert.equal((await f.trigger(rearmed, { price: 105 })).body.accepted, false);
  assert.equal((await f.trigger(rearmed, { triggeredAt: rearmed.createdAt - 1 })).body.accepted, false);
  assert.equal((await f.trigger(rearmed)).body.accepted, true);
  assert.equal(f.sends.length, 1);
});

test('persists one trigger per generation across duplicate events and a full runtime restart', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  const initial = await f.trigger(rule);
  assert.equal(initial.body.accepted, true);
  assert.equal(initial.body.event.delivery, 'accepted');
  assert.equal((await f.trigger(rule)).body.event.key, initial.body.event.key);
  assert.equal(f.sends.length, 1);
  await f.restart();
  const repeated = await f.trigger(rule);
  assert.equal(repeated.body.accepted, true, JSON.stringify({ response: repeated, subscriptions: await f.sql('SELECT device FROM subscriptions'), events: await f.sql('SELECT key FROM events') }));
  assert.equal(repeated.body.event.delivery, 'accepted');
  assert.equal(f.sends.length, 1);
  const monitor = await f.monitor();
  assert.equal(monitor.body.subscriptions[0].rules.length, 0, 'completed generations must not be rearmed after restart');
});

test('preserves uncertain delivery without sending the same trigger again', async (t) => {
  const f = await fixture(t, () => new MockResponse('not-json', { status: 200 }));
  const rule = makeRule();
  await f.sync([rule]);
  assert.equal((await f.trigger(rule)).body.event.delivery, 'unconfirmed');
  await f.trigger(rule);
  await f.monitor();
  await f.restart();
  await f.trigger(rule);
  assert.equal(f.sends.length, 1);
});

test('an in-flight push cannot recreate events after the device is deleted', async (t) => {
  const began = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, async () => { began.resolve(); await release.promise; return MockResponse.json({ data: { status: 'ok', id: 'old-receipt' } }); });
  const rule = makeRule();
  await f.sync([rule]);
  const trigger = f.trigger(rule);
  await began.promise;
  assert.equal((await f.request(SYNC, { expoPushToken: TOKEN }, { app: true, method: 'DELETE' })).status, 200);
  release.resolve();
  await trigger;
  assert.deepEqual(await f.sql('SELECT key FROM events'), []);
  assert.deepEqual(await f.sql('SELECT device FROM subscriptions'), []);
});

test('stale completion cannot overwrite a new dispatch after delete and re-registration', async (t) => {
  const began = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, async ({ count }) => {
    if (count === 1) { began.resolve(); await release.promise; return new MockResponse('', { status: 429 }); }
    return MockResponse.json({ data: { status: 'ok', id: 'new-receipt' } });
  });
  const rule = makeRule();
  await f.sync([rule]);
  const first = f.trigger(rule);
  await began.promise;
  await f.request(SYNC, { expoPushToken: TOKEN }, { app: true, method: 'DELETE' });
  await f.sync([rule]);
  assert.equal((await f.trigger(rule)).body.event.delivery, 'accepted');
  release.resolve();
  await first;
  assert.equal((await f.sync([rule])).body.events[0].delivery, 'accepted');
  const rows = await f.sql('SELECT payload FROM events');
  assert.equal(JSON.parse(rows[0].payload).receiptId, 'new-receipt');
  assert.equal(f.sends.length, 2);
});

test('overlapping monitor syncs cannot send a stale pending snapshot twice', async (t) => {
  const firstBegan = deferred();
  const secondBegan = deferred();
  const releaseFirst = deferred();
  const releaseSecond = deferred();
  t.after(() => { releaseFirst.resolve(); releaseSecond.resolve(); });
  const f = await fixture(t, async ({ payload, type }) => {
    assert.equal(type, 'send');
    if (payload.data.alertId === 'first') { firstBegan.resolve(); await releaseFirst.promise; }
    else { secondBegan.resolve(); await releaseSecond.promise; }
    return MockResponse.json({ data: { status: 'ok', id: `receipt-${payload.data.alertId}` } });
  });
  const first = makeRule({ id: 'first' });
  const second = makeRule({ id: 'second' });
  await f.sync([first, second]);
  await seedEvent(f, first, { updatedAt: Date.now() - 240_000 });
  await seedEvent(f, second, { updatedAt: Date.now() - 120_000 });
  const firstSync = f.monitor();
  await firstBegan.promise;
  const secondSync = f.monitor();
  await secondBegan.promise;
  releaseFirst.resolve();
  await firstSync;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(f.sends.filter((send) => send.data.alertId === 'second').length, 1);
  releaseSecond.resolve();
  await secondSync;
  await until(() => f.sync([first, second]), (result) => result.body.events.every((event) => event.delivery === 'accepted'), 'both queued notifications should complete');
  assert.equal(f.sends.length, 2);
});

test('cancellation blocks a queued retry, and receipts advance accepted delivery without resending', async (t) => {
  const f = await fixture(t);
  const canceled = makeRule({ id: 'cancel-me' });
  const accepted = makeRule({ id: 'already-accepted' });
  await f.sync([canceled, accepted]);
  await seedEvent(f, canceled);
  await seedEvent(f, accepted, { delivery: 'accepted', receiptId: 'accepted-receipt' });
  await f.sync([accepted]);
  await f.monitor();
  await until(() => f.sync([accepted]), (result) => result.body.events.some((event) => event.alertId === accepted.id && event.delivery === 'sent'), 'push receipt should become sent');
  assert.equal(f.sends.length, 0);
  assert.equal(f.receipts.length, 1);
});

test('a pending active event is not starved by more than 500 newer terminal records', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  await seedEvent(f, rule, { updatedAt: Date.now() - 1_000_000 });
  const rows = Array.from({ length: 501 }, (_, index) => {
    const event = { key: `history-${index}`, device: DEVICE, alertId: `historical-${index}`, createdAt: 1, instrumentId: rule.instrumentId, symbol: 'BTC', price: 111, triggeredAt: 1, changePct: 11, delivery: 'sent', updatedAt: Date.now(), attempts: 1 };
    return [event.key, DEVICE, event.updatedAt, JSON.stringify(event)];
  });
  for (let index = 0; index < rows.length; index += 20) {
    const batch = rows.slice(index, index + 20);
    const placeholders = batch.map(() => '(?,?,?,?)').join(',');
    await f.sql(`INSERT INTO events(key,device,updated_at,payload) VALUES ${placeholders}`, ...batch.flat());
  }
  await f.monitor();
  await until(() => Promise.resolve(f.sends.length), (count) => count === 1, 'the old active pending event should still be dispatched');
});

test('waiting receipts cannot starve a newer queued notification', async (t) => {
  const f = await fixture(t, ({ type }) => type === 'receipt'
    ? MockResponse.json({ data: {} })
    : MockResponse.json({ data: { status: 'ok', id: 'new-ticket' } }));
  const rule = makeRule();
  await f.sync([rule]);
  for (let index = 0; index < 100; index++) {
    await seedEvent(f, { ...rule, id: `older-${index}` }, { delivery: 'accepted', receiptId: `waiting-${index}`, updatedAt: Date.now() - 240_000 });
  }
  await seedEvent(f, rule, { updatedAt: Date.now() - 120_000 });
  await f.monitor();
  await until(() => Promise.resolve(f.sends.length), (count) => count === 1, 'receipt polling must not block new notification delivery');
});

test('pending retries still in backoff cannot starve a runnable notification', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  for (let index = 0; index < 100; index++) {
    await seedEvent(f, { ...rule, id: `backoff-${index}` }, { retryAt: Date.now() + 60_000, updatedAt: Date.now() - 240_000 });
  }
  await seedEvent(f, rule, { updatedAt: Date.now() - 120_000 });
  await f.monitor();
  await until(() => Promise.resolve(f.sends.length), (count) => count === 1, 'future retries must not fill the runnable send queue');
  assert.equal(f.sends[0].data.alertId, rule.id);
});

test('missing older receipts do not prevent checking newer accepted tickets', async (t) => {
  const f = await fixture(t, ({ type, payload }) => {
    assert.equal(type, 'receipt');
    return MockResponse.json({ data: payload.ids.includes('newer-receipt') ? { 'newer-receipt': { status: 'ok' } } : {} });
  });
  const rule = makeRule();
  await f.sync([rule]);
  for (let index = 0; index < 100; index++) {
    await seedEvent(f, { ...rule, id: `older-${index}` }, { delivery: 'accepted', receiptId: `waiting-${index}`, updatedAt: Date.now() - 240_000 });
  }
  await seedEvent(f, rule, { delivery: 'accepted', receiptId: 'newer-receipt', updatedAt: Date.now() - 120_000 });
  await f.monitor();
  await until(() => Promise.resolve(f.receipts.length), (count) => count === 1, 'older receipts should be checked');
  await f.monitor();
  await until(() => f.sync([rule]), (result) => result.body.events.some((event) => event.alertId === rule.id && event.delivery === 'sent'), 'newer receipt should be checked on the next sync');
  assert.equal(f.receipts.length, 2);
  assert.equal(f.sends.length, 0);
});

test('terminal history is pruned only after its rule generation is superseded', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  const retained = await seedEvent(f, rule, { delivery: 'sent' });
  await seedEvent(f, { ...rule, id: 'old-sent' }, { delivery: 'sent' });
  await seedEvent(f, { ...rule, id: 'old-failed' }, { delivery: 'failed' });
  await seedEvent(f, { ...rule, id: 'old-unconfirmed' }, { delivery: 'unconfirmed' });
  const accepted = await seedEvent(f, { ...rule, id: 'old-accepted' }, { delivery: 'accepted', receiptId: 'unfinished-receipt' });
  const sending = await seedEvent(f, { ...rule, id: 'old-sending' }, { delivery: 'sending', updatedAt: Date.now() });
  await f.sync([rule], false);
  assert.deepEqual((await f.sql('SELECT key FROM events ORDER BY key')).map((row) => row.key), [retained.key, accepted.key, sending.key].sort());
  await f.sync([rule], true);
  assert.equal((await f.trigger(rule)).body.event.delivery, 'sent', 'restoring permission must retain the original generation tombstone');
  assert.equal(f.sends.length, 0);
  const rearmed = { ...rule, createdAt: rule.createdAt + 1 };
  await f.sync([rearmed]);
  assert.equal((await f.sql('SELECT key FROM events WHERE key=?', retained.key)).length, 0);
  assert.equal((await f.trigger(rule)).body.accepted, false);
  assert.equal((await f.trigger(rearmed)).body.accepted, true);
  assert.equal(f.sends.length, 1);
});

test('a dispatch interrupted before restart becomes unconfirmed without a duplicate send', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  await seedEvent(f, rule, { delivery: 'sending', dispatchId: 'interrupted', updatedAt: Date.now() - 60_000 });
  await f.restart();
  await f.monitor();
  await until(() => f.sync([rule]), (result) => result.body.events[0]?.delivery === 'unconfirmed', 'interrupted sends should be reported as unconfirmed');
  await f.trigger(rule);
  assert.equal(f.sends.length, 0);
});

test('expired receipts become unconfirmed even while the push receipt service is unavailable', async (t) => {
  const f = await fixture(t, () => new MockResponse('', { status: 503 }));
  const rule = makeRule();
  await f.sync([rule]);
  await seedEvent(f, rule, { delivery: 'accepted', receiptId: 'expired', updatedAt: Date.now() - 25 * 60 * 60_000 });
  await f.monitor();
  await until(() => f.sync([rule]), (result) => result.body.events[0]?.delivery === 'unconfirmed', 'receipt expiry should not depend on a successful push service response');
  await f.trigger(rule);
  assert.equal(f.sends.length, 0);
  assert.equal(f.receipts.length, 0);
});

test('completed phone generations cannot rearm after disable/delete or push token rotation', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  await f.trigger(rule);
  await f.request(SYNC, { expoPushToken: TOKEN }, { app: true, method: 'DELETE' });
  const completed = { ...rule, completed: true };
  await f.sync([completed]);
  assert.equal((await f.trigger(rule)).body.accepted, false);
  const nextToken = 'ExpoPushToken[rotated_test_device]';
  const nextDevice = createHash('sha256').update(nextToken).digest('hex');
  await f.sync([completed], true, nextToken);
  assert.equal((await f.trigger(rule, { device: nextDevice })).body.accepted, false);
  const result = await f.monitor();
  assert.equal(result.body.subscriptions.length, 2);
  assert.ok(result.body.subscriptions.every((subscription) => subscription.rules.length === 0));
  assert.equal(f.sends.length, 1);
  const rearmed = { ...rule, createdAt: rule.createdAt + 1 };
  await f.sync([rearmed]);
  assert.equal((await f.trigger(rearmed)).body.accepted, true);
  assert.equal(f.sends.length, 2);
});

test('phone completion does not cancel an existing pending dispatch or receipt', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  await seedEvent(f, rule);
  const completed = { ...rule, completed: true };
  await f.sync([completed]);
  assert.equal((await f.monitor()).body.subscriptions[0].rules.length, 0);
  await until(() => f.sync([completed]), (result) => result.body.events[0]?.delivery === 'accepted', 'existing delivery should continue for a completed phone generation');
  assert.equal(f.sends.length, 1);
  await f.sql("UPDATE events SET updated_at=?,payload=json_set(payload,'$.updatedAt',?)", Date.now() - 30_000, Date.now() - 30_000);
  await f.monitor();
  await until(() => f.sync([completed]), (result) => result.body.events[0]?.delivery === 'sent', 'completed generation receipt should still be checked');
  assert.equal(f.receipts.length, 1);
  assert.equal(f.sends.length, 1);
});

test('disable retains unseen completion and authoritative rules until the phone enables again', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  const triggered = await f.trigger(rule);
  const disabled = await f.sync([], false);
  assert.equal(disabled.body.enabled, false);
  assert.equal(disabled.body.events[0].key, triggered.body.event.key);
  const subscription = JSON.parse((await f.sql('SELECT payload FROM subscriptions WHERE device=?', DEVICE))[0].payload);
  assert.deepEqual(subscription.rules, [rule], 'an empty disable payload must not discard authoritative rules');
  assert.equal((await f.monitor()).body.subscriptions.length, 0);
  await f.sync([rule]);
  assert.equal((await f.monitor()).body.subscriptions[0].rules.length, 0, 'unseen completed generations must not rearm after enable');
  assert.equal((await f.trigger(rule)).body.event.key, triggered.body.event.key);
  assert.equal(f.sends.length, 1);
});

test('a stable registration retains unseen trigger history across delivery-token rotation', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  const original = await f.trigger(rule);
  const nextToken = 'ExpoPushToken[stable_registration_new_delivery]';
  const rotated = await f.sync([rule], true, nextToken, TOKEN);
  assert.equal(rotated.body.revision, 1, 'delivery address changes do not require a monitor rule revision');
  assert.equal(rotated.body.events[0].key, original.body.event.key);
  const rows = await f.sql('SELECT device,payload FROM subscriptions');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].device, DEVICE);
  assert.equal(JSON.parse(rows[0].payload).token, nextToken);
  assert.equal((await f.monitor()).body.subscriptions[0].rules.length, 0);
  assert.equal((await f.trigger(rule)).body.event.key, original.body.event.key);
  assert.equal(f.sends.length, 1);
  const rearmed = { ...rule, createdAt: rule.createdAt + 1 };
  await f.sync([rearmed], true, nextToken, TOKEN);
  await f.trigger(rearmed);
  assert.equal(f.sends.length, 2);
  assert.equal(f.sends[1].to, nextToken, 'future dispatch must use the refreshed delivery address');
  assert.equal((await f.request(SYNC, { expoPushToken: nextToken, registrationToken: TOKEN }, { app: true, method: 'DELETE' })).status, 200);
  assert.deepEqual(await f.sql('SELECT device FROM subscriptions'), []);
  assert.deepEqual(await f.sql('SELECT key FROM events'), []);
});

test('disabling cancels queued dispatch while retaining its generation to prevent later duplication', async (t) => {
  const f = await fixture(t);
  const rule = makeRule();
  await f.sync([rule]);
  await seedEvent(f, rule);
  await f.sync([], false);
  await f.monitor();
  await until(() => f.sync([], false), (result) => result.body.events[0]?.delivery === 'failed', 'disabled queued delivery should stop');
  await f.sync([rule]);
  assert.equal((await f.monitor()).body.subscriptions[0].rules.length, 0);
  assert.equal((await f.trigger(rule)).body.event.delivery, 'failed');
  assert.equal(f.sends.length, 0);
});
