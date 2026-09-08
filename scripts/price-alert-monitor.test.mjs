import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acquirePriceMonitorLock, createPriceAlertRelayClient, PriceAlertMonitor } from './price-alert-monitor.mjs';
import { priceMonitorSignaturePayload } from '../src/domain/priceAlerts.ts';

const DEVICE = 'a'.repeat(64);
const NOW = 1_000_000;
const rule = (overrides = {}) => ({ id: 'test-alert', instrumentId: 'hl:BTC', symbol: 'BTC', source: 'hyperliquid', coinKey: 'BTC', direction: 'both', pct: 10, anchorPrice: 100, createdAt: NOW - 1000, ...overrides });
const subscriptions = (rules) => ({ subscriptions: [{ device: DEVICE, revision: 1, rules }] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'price-monitor-test-'));
  const events = [];
  const logs = [];
  const monitor = new PriceAlertMonitor({
    stateDir, now: () => NOW, log: line => logs.push(line),
    relay: async (pathname, body) => {
      if (pathname.endsWith('/sync')) return subscriptions(options.rules ?? [rule()]);
      events.push(body);
      return options.event ? options.event(body, stateDir) : { accepted: true, event: { delivery: 'sent' } };
    },
    ...options,
  });
  t.after(async () => { await monitor.stop().catch(() => undefined); await rm(stateDir, { recursive: true, force: true }); });
  await monitor.initialize();
  if (options.sync !== false) await monitor.sync();
  return { monitor, stateDir, events, logs };
}

const diskState = async (directory) => JSON.parse(await readFile(path.join(directory, 'triggers.json'), 'utf8'));

test('every crossing in one observation is durable before any relay event is sent', async t => {
  const checked = [];
  const rules = [rule(), rule({ id: 'second', instrumentId: 'hl:ETH', symbol: 'ETH', coinKey: 'ETH' })];
  const { monitor, stateDir, events } = await fixture(t, {
    rules,
    event: async (body, directory) => {
      const state = await diskState(directory);
      assert.ok(state.pending[body.key], 'exact event must already be in durable queue');
      if (!checked.length) assert.equal(Object.keys(state.pending).length, 2, 'all same-observation crossings precede the first POST');
      checked.push(body.key);
      return { accepted: true };
    },
  });
  await monitor.observe('hyperliquid', { BTC: '112.25', ETH: '1.2e2' });
  assert.equal(events.length, 2);
  assert.equal(new Set(checked).size, 2);
  assert.deepEqual((await diskState(stateDir)).pending, {});
  assert.equal((await stat(path.join(stateDir, 'triggers.json'))).mode & 0o777, 0o600);
});

test('concurrent observations dedupe and a crossing during slow dispatch is drained', async t => {
  const gate = deferred();
  const firstEvent = deferred();
  let eventCount = 0;
  const rules = [rule(), rule({ id: 'second', instrumentId: 'hl:ETH', symbol: 'ETH', coinKey: 'ETH' })];
  const { monitor, events } = await fixture(t, { rules, event: async () => {
    eventCount++;
    if (eventCount === 1) { firstEvent.resolve(); await gate.promise; }
    return { accepted: true };
  } });
  const first = monitor.observe('hyperliquid', { BTC: '112' });
  await firstEvent.promise;
  const second = monitor.observe('hyperliquid', { BTC: '113', ETH: '114' });
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map(event => event.key)).size, 2);
  assert.deepEqual(monitor.pending, {});
});

test('lost relay acknowledgement survives restart and cancellation is authoritative at relay', async t => {
  const { monitor, stateDir } = await fixture(t, { event: async () => { throw new Error('response lost'); } });
  await assert.rejects(monitor.observe('hyperliquid', { BTC: 112 }), /response lost/);
  const pending = Object.values((await diskState(stateDir)).pending)[0];
  assert.ok(pending);
  await monitor.stop();
  const retried = [];
  const restarted = new PriceAlertMonitor({ stateDir, now: () => NOW + 100, log: () => {}, relay: async (pathname, body) => {
    if (pathname.endsWith('/sync')) return { subscriptions: [] }; // deleted on phone while offline
    retried.push(body); return { accepted: false };
  } });
  t.after(() => restarted.stop());
  await restarted.initialize();
  await restarted.sync();
  assert.deepEqual(retried, [pending], 'retry uses the same idempotency key and original crossing');
  assert.deepEqual((await diskState(stateDir)).pending, {});
  assert.ok((await diskState(stateDir)).completed.includes(pending.key));
});

test('completed generations stay deduplicated across a restart', async t => {
  const { monitor, stateDir } = await fixture(t);
  await monitor.observe('hyperliquid', { BTC: 112 });
  await monitor.stop();
  let eventCount = 0;
  const restarted = new PriceAlertMonitor({ stateDir, now: () => NOW + 100, log: () => {}, relay: async pathname => {
    if (pathname.endsWith('/sync')) return subscriptions([rule()]);
    eventCount++; return { accepted: true };
  } });
  t.after(() => restarted.stop());
  await restarted.initialize(); await restarted.sync();
  await restarted.observe('hyperliquid', { BTC: 120 });
  assert.equal(eventCount, 0);
});

test('storage failure prevents dispatch and exposes unhealthy state', async t => {
  const fatal = [];
  const { monitor, stateDir, events } = await fixture(t, { onFatal: error => fatal.push(error) });
  const saved = `${stateDir}-saved`;
  await rename(stateDir, saved); await writeFile(stateDir, 'not a directory');
  t.after(() => rm(saved, { recursive: true, force: true }));
  const failure = await monitor.observe('hyperliquid', { BTC: 112 }).catch(error => error);
  assert.match(failure.message, /storage is unavailable/);
  monitor.handleError(failure);
  assert.equal(events.length, 0);
  assert.equal(monitor.health().storageHealthy, false);
  assert.equal(monitor.health().connected, false);
  assert.equal(fatal.length, 1);
  await assert.rejects(monitor.sync(), /storage is unavailable/);
});

test('shutdown drains all captured crossings and does not begin relay dispatch afterward', async t => {
  const gate = deferred();
  const persisted = deferred();
  const { monitor, stateDir, events } = await fixture(t, { rules: [rule(), rule({ id: 'second' })] });
  const persist = monitor.persist.bind(monitor);
  monitor.persist = async () => { await persist(); persisted.resolve(); await gate.promise; };
  const observing = monitor.observe('hyperliquid', { BTC: 112 });
  await persisted.promise;
  let stopped = false;
  const stopping = monitor.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  assert.equal(Object.keys((await diskState(stateDir)).pending).length, 2);
  gate.resolve(); await Promise.all([observing, stopping]);
  assert.equal(events.length, 0);
  assert.equal(stopped, true);
});

test('shutdown also waits for an in-flight subscription sync', async t => {
  const gate = deferred();
  const started = deferred();
  const { monitor } = await fixture(t, { sync: false, relay: async () => { started.resolve(); await gate.promise; return subscriptions([rule()]); } });
  const syncing = monitor.sync(); await started.promise;
  let finished = false;
  const stopping = monitor.stop().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  gate.resolve(); await Promise.all([syncing, stopping]);
  assert.deepEqual(monitor.rules, []);
});

test('invalid prices/timestamps, stale rules and unsupported source cannot create events', async t => {
  const { monitor, events } = await fixture(t);
  for (const timestamp of [NaN, Infinity, NOW + 5001, NOW - 30001, 0]) await monitor.observe('hyperliquid', { BTC: 112 }, timestamp);
  for (const price of [true, null, '', ' ', {}, [], 'Infinity', '-1', 0, Infinity]) await monitor.observe('hyperliquid', { BTC: price });
  await monitor.observe('unknown', { BTC: 112 });
  monitor.lastSyncAt = NOW - 60_001;
  await monitor.observe('hyperliquid', { BTC: 112 });
  assert.equal(events.length, 0);
  assert.deepEqual(monitor.pending, {});
});

test('socket heartbeat requires valid quotes and mixed frames update both venues', async t => {
  const socket = { send() {}, close() {} };
  const { monitor } = await fixture(t, { socketFactory: () => socket });
  monitor.connect(); socket.onopen();
  for (const mids of [{}, [], { BTC: '' }, { BTC: true }, { 'xyz:BAD': 'NaN' }]) socket.onmessage({ data: JSON.stringify({ channel: 'allMids', data: { mids } }) });
  assert.equal(monitor.health().lastHyperliquidAt, null);
  assert.equal(monitor.health().lastXyzAt, null);
  socket.onmessage({ data: JSON.stringify({ channel: 'allMids', data: { mids: { BTC: '100', 'xyz:TEST': '100.5' } } }) });
  await Promise.all([...monitor.tasks]);
  assert.equal(monitor.health().lastHyperliquidAt, NOW);
  assert.equal(monitor.health().lastXyzAt, NOW);
});

test('corrupt durable trigger state refuses startup rather than resetting dedup', async t => {
  const { monitor, stateDir } = await fixture(t);
  await monitor.stop();
  const text = '{invalid state';
  await writeFile(path.join(stateDir, 'triggers.json'), text);
  const broken = new PriceAlertMonitor({ stateDir, relay: async () => { throw new Error('must not connect'); } });
  await assert.rejects(broken.initialize(), /refusing to reset trigger history/);
  assert.equal(await readFile(path.join(stateDir, 'triggers.json'), 'utf8'), text);
});

test('OS ownership excludes a second process and safely replaces stale empty PID text', async t => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'price-monitor-lock-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  await writeFile(path.join(stateDir, 'monitor.pid'), '');
  const first = await acquirePriceMonitorLock(stateDir, 0);
  try {
    assert.equal(await readFile(path.join(stateDir, 'monitor.pid'), 'utf8'), String(process.pid));
    await assert.rejects(acquirePriceMonitorLock(stateDir, first.port), error => error.code === 'EADDRINUSE');
    assert.equal(await readFile(path.join(stateDir, 'monitor.pid'), 'utf8'), String(process.pid));
  } finally { await first.release(); }
  const restarted = await acquirePriceMonitorLock(stateDir, first.port);
  await restarted.release();
});

test('relay requests bind the exact signed path/body and reject oversized replies', async () => {
  const configuration = { url: 'https://relay.example.test', bridgeSecret: 'synthetic-test-secret' };
  const client = createPriceAlertRelayClient(configuration, async (url, init) => {
    assert.equal(url.pathname, '/price-alerts/monitor/event');
    const timestamp = init.headers['X-Monitor-Timestamp'];
    const expected = createHmac('sha256', configuration.bridgeSecret).update(priceMonitorSignaturePayload('POST', url.pathname, timestamp, init.body)).digest('hex');
    assert.equal(init.headers['X-Monitor-Signature'], expected);
    return { ok: true, headers: new Headers({ 'content-length': String(33 * 1024 * 1024) }), json: async () => { throw new Error('must reject before parsing'); } };
  });
  await assert.rejects(client('/price-alerts/monitor/event', { key: 'test' }), /exceeds monitor limits/);
  assert.throws(() => createPriceAlertRelayClient({ ...configuration, url: 'http://relay.example.test' }), /HTTPS/);
});

test('acknowledgement-save failure restarts with the same durable event for relay dedup', async t => {
  const accepted = new Map();
  const attempts = [];
  let saved;
  const { monitor, stateDir } = await fixture(t, { event: async (event, directory) => {
    attempts.push(event); accepted.set(event.key, event);
    saved = `${directory}-original`;
    await rename(directory, saved); await writeFile(directory, 'storage failed after relay accepted');
    return { accepted: true };
  } });
  t.after(() => rm(saved, { recursive: true, force: true }));
  await assert.rejects(monitor.observe('hyperliquid', { BTC: 112 }), /storage is unavailable/);
  const queued = Object.values((await diskState(saved)).pending)[0];
  assert.equal(queued.key, attempts[0].key);
  const restarted = new PriceAlertMonitor({ stateDir: saved, now: () => NOW, log: () => {}, relay: async (pathname, event) => {
    if (pathname.endsWith('/sync')) return subscriptions([rule()]);
    attempts.push(event); accepted.set(event.key, event); return { accepted: true };
  } });
  t.after(() => restarted.stop());
  await restarted.initialize(); await restarted.sync();
  assert.equal(attempts.length, 2);
  assert.equal(accepted.size, 1, 'both attempts use the same key; the relay can deduplicate delivery');
  assert.deepEqual((await diskState(saved)).pending, {});
});

test('Outcome settlement zero is valid while zero perp and Cboe quotes stay invalid', async t => {
  const rules = [
    rule({ id: 'outcome', instrumentId: 'hl:outcome:123:0', coinKey: '#1230', symbol: 'YES', direction: 'down', anchorPrice: 0.5 }),
    rule(),
    rule({ id: 'vix', instrumentId: 'cboe:VIX', coinKey: '_VIX', symbol: 'VIX', source: 'cboe' }),
  ];
  const { monitor, events } = await fixture(t, { rules });
  await monitor.observe('hyperliquid', { '#1230': '0', BTC: '0' });
  await monitor.observe('cboe', { _VIX: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].alertId, 'outcome');
  assert.equal(events[0].price, 0);
});
