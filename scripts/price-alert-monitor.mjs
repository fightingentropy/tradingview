import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeRemotePriceRule, priceAlertMove, priceMonitorSignaturePayload,
  remotePriceRuleKey, PRICE_MONITOR_VERSION,
} from '../src/domain/priceAlerts.ts';
import { readNewsRelayConfiguration } from './news-relay-keychain.mjs';

const DEFAULT_STATE_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'TradingView Price Alerts');
const SOCKET_URL = 'wss://api.hyperliquid.xyz/ws';
const CBOE_URL = 'https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json';
const SYNC_INTERVAL = 15_000;
const MAX_RULES_AGE = 60_000;
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const MAX_SOCKET_BYTES = 4 * 1024 * 1024;
const MAX_RULES = 100_000;

function priceNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function validMids(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 20_000) return null;
  const mids = {};
  for (const [key, raw] of entries) {
    if (key.length > 100 || !/^[A-Za-z0-9@#._:\/-]+$/.test(key)) continue;
    const price = priceNumber(raw);
    if (price === null || (price === 0 && !key.startsWith('#'))) continue;
    mids[key] = price;
  }
  return Object.keys(mids).length ? mids : null;
}

async function boundedJson(response, maximumBytes) {
  if (response.headers?.get('content-length') && Number(response.headers.get('content-length')) > maximumBytes) throw new Error('Response exceeds monitor limits');
  if (!response.body?.getReader) {
    // The real fetch Response always has a stream; this supports injected test clients.
    let value;
    try { value = await response.json(); } catch { throw new Error('Invalid JSON from price source'); }
    if (Buffer.byteLength(JSON.stringify(value)) > maximumBytes) throw new Error('Response exceeds monitor limits');
    return value;
  }
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) throw new Error('Response exceeds monitor limits');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => undefined); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON from price source'); }
}

export function createPriceAlertRelayClient(configuration, fetchImpl = fetch) {
  const base = new URL(configuration.url);
  if (base.protocol !== 'https:') throw new Error('Price monitor requires an HTTPS relay');
  return async (pathname, payload) => {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', configuration.bridgeSecret)
      .update(priceMonitorSignaturePayload('POST', pathname, timestamp, body)).digest('hex');
    const response = await fetchImpl(new URL(pathname, base), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Monitor-Timestamp': timestamp, 'X-Monitor-Signature': signature },
      body, signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Price alert relay returned ${response.status}`);
    return boundedJson(response, MAX_STATE_BYTES);
  };
}

/** Files contain only alert trigger records and opaque device hashes, never push tokens. */
export class PriceAlertMonitor {
  constructor({ relay, stateDir = DEFAULT_STATE_DIR, fetchImpl = fetch, socketFactory = url => new WebSocket(url), now = Date.now, log = console.log, onFatal = () => undefined }) {
    this.relay = relay; this.stateDir = stateDir; this.fetchImpl = fetchImpl;
    this.socketFactory = socketFactory; this.now = now; this.log = log; this.onFatal = onFatal;
    this.pending = {}; this.completed = new Set(); this.rules = []; this.appliedRevisions = {};
    this.lastSyncAt = 0; this.lastHyperliquidAt = null; this.lastXyzAt = null; this.lastCboeAt = null;
    this.lastMessageAt = 0; this.connected = false; this.stopped = false;
    this.writeChain = Promise.resolve(); this.tasks = new Set(); this.retryCount = 0; this.storageFailed = false;
  }

  async initialize() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    try {
      const file = await open(path.join(this.stateDir, 'triggers.json'), 'r');
      let raw;
      try {
        if ((await file.stat()).size > MAX_STATE_BYTES) throw new Error('Trigger state exceeds monitor limits');
        raw = await file.readFile('utf8');
      } finally { await file.close(); }
      const state = JSON.parse(raw);
      if (!state || state.version !== 1 || !state.pending || typeof state.pending !== 'object' || Array.isArray(state.pending) || !Array.isArray(state.completed) || Object.keys(state.pending).length > MAX_RULES || state.completed.length > MAX_RULES) throw new Error('Invalid state');
      for (const [key, event] of Object.entries(state.pending)) {
        if (!event || event.key !== key || !/^[a-f0-9]{64}$/.test(event.device) ||
            typeof event.alertId !== 'string' || event.alertId.length > 120 || !Number.isSafeInteger(event.createdAt) || event.createdAt <= 0 ||
            !Number.isFinite(event.price) || event.price < 0 || !Number.isSafeInteger(event.triggeredAt) || event.triggeredAt < event.createdAt ||
            key !== `${event.device}:${event.alertId}:${event.createdAt}`) throw new Error('Invalid trigger state');
      }
      this.pending = state.pending;
      if (state.completed.some(key => typeof key !== 'string' || key.length > 256 || !/^[a-f0-9]{64}:/.test(key))) throw new Error('Invalid completed trigger history');
      this.completed = new Set(state.completed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Price monitor state could not be restored; refusing to reset trigger history', { cause: error });
    }
  }

  persist() {
    this.writeChain = this.writeChain.then(async () => {
      const file = path.join(this.stateDir, 'triggers.json');
      const temporary = `${file}.tmp`;
      const text = `${JSON.stringify({ version: 1, pending: this.pending, completed: [...this.completed] })}\n`;
      if (Buffer.byteLength(text) > MAX_STATE_BYTES || Object.keys(this.pending).length > MAX_RULES || this.completed.size > MAX_RULES) throw new Error('Trigger state exceeds monitor limits');
      const handle = await open(temporary, 'w', 0o600);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temporary, file);
      const directory = await open(this.stateDir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }).catch(error => {
      this.storageFailed = true;
      throw new Error('Price monitor trigger storage is unavailable', { cause: error });
    });
    return this.writeChain;
  }

  health() {
    return {
      storageHealthy: !this.storageFailed, connected: this.connected && !this.storageFailed, lastHyperliquidAt: this.lastHyperliquidAt,
      lastXyzAt: this.lastXyzAt, lastCboeAt: this.lastCboeAt,
      pendingEvents: Object.keys(this.pending).length, version: PRICE_MONITOR_VERSION,
    };
  }

  track(task) {
    this.tasks.add(task);
    task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
    return task;
  }

  sync() {
    if (this.stopped) return Promise.resolve();
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.track(this.syncImpl());
    this.syncPromise.then(() => { this.syncPromise = null; }, () => { this.syncPromise = null; });
    return this.syncPromise;
  }

  async syncImpl() {
    if (this.storageFailed) throw new Error('Price monitor trigger storage is unavailable');
    if (this.syncing) return;
    this.syncing = true;
    try {
      const payload = await this.relay('/price-alerts/monitor/sync', { health: this.health(), appliedRevisions: this.appliedRevisions });
      if (!payload || !Array.isArray(payload.subscriptions) || payload.subscriptions.length > 1000) throw new Error('Invalid relay response');
      if (this.stopped) return;
      const rules = [], revisions = {};
      for (const subscription of payload.subscriptions) {
        if (!subscription || !/^[a-f0-9]{64}$/.test(subscription.device) || !Number.isSafeInteger(subscription.revision) || subscription.revision < 0 || !Array.isArray(subscription.rules) || subscription.rules.length > 100 || revisions[subscription.device] !== undefined) throw new Error('Invalid subscription');
        revisions[subscription.device] = subscription.revision;
        for (const raw of subscription.rules) {
          const rule = normalizeRemotePriceRule(raw);
          if (!rule) throw new Error('Invalid monitor rule');
          rules.push({ ...rule, device: subscription.device, key: `${subscription.device}:${remotePriceRuleKey(rule)}` });
        }
      }
      if (rules.length > MAX_RULES || new Set(rules.map(rule => rule.key)).size !== rules.length) throw new Error('Duplicate or excessive monitor rules');
      this.rules = rules; this.appliedRevisions = revisions; this.lastSyncAt = this.now();
      // Keep dedup keys while any current rule or durable pending event can refer to them.
      const active = new Set(rules.map(rule => rule.key));
      this.completed = new Set([...this.completed].filter(key => active.has(key) || this.pending[key]));
      await this.persist();
      await this.flushPending();
      await this.writeHealth();
    } finally { this.syncing = false; }
  }

  observe(source, mids, observedAt = this.now()) {
    if (this.stopped) return Promise.resolve();
    return this.track(this.observeImpl(source, mids, observedAt));
  }

  async observeImpl(source, rawMids, observedAt) {
    const now = this.now();
    const mids = validMids(rawMids);
    if (!mids || !['hyperliquid', 'cboe'].includes(source) || this.storageFailed || !Number.isSafeInteger(observedAt) || observedAt <= 0 ||
        now - this.lastSyncAt > MAX_RULES_AGE || observedAt > now + 5000 || now - observedAt > 30_000) return;
    let changed = false;
    // Capture every crossing in this observation before yielding. A shutdown
    // cannot drain the first write while a later rule has yet to be recorded.
    for (const rule of this.rules) {
      if (rule.source !== source || observedAt < rule.createdAt || this.pending[rule.key] || this.completed.has(rule.key)) continue;
      const price = mids[rule.coinKey];
      if (price === undefined || priceAlertMove(rule, price) === null) continue;
      this.pending[rule.key] = { key: rule.key, device: rule.device, alertId: rule.id,
        createdAt: rule.createdAt, price, triggeredAt: observedAt };
      changed = true;
    }
    // No relay request for any event is allowed until all recorded crossings
    // are fsynced and the atomic rename is durable in the containing directory.
    if (changed) await this.persist();
    if (!this.stopped) await this.flushPending();
  }

  flushPending() {
    if (this.stopped) return Promise.resolve();
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.track(this.flushPendingImpl());
    this.flushPromise.then(() => { this.flushPromise = null; }, () => { this.flushPromise = null; });
    return this.flushPromise;
  }

  async flushPendingImpl() {
    while (!this.stopped) {
      if (this.storageFailed) throw new Error('Price monitor trigger storage is unavailable');
      const next = Object.entries(this.pending)[0];
      if (!next) return;
      const [key, event] = next;
      await this.writeChain;
      if (this.stopped) return;
      const response = await this.relay('/price-alerts/monitor/event', event);
      if (!response || typeof response.accepted !== 'boolean') throw new Error('Invalid trigger acknowledgement');
      // Explicit rejection is authoritative cancellation/rearm validation at the
      // relay. A transport failure leaves the exact event queued for idempotent retry.
      delete this.pending[key]; this.completed.add(key);
      await this.persist();
      this.log(JSON.stringify({ event: response.accepted ? 'price_trigger_recorded' : 'price_trigger_canceled', delivery: response.event?.delivery }));
    }
  }

  connect() {
    if (this.stopped || this.socket) return;
    const socket = this.socketFactory(SOCKET_URL);
    this.socket = socket;
    const reconnect = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectTimer); this.socket = null; this.connected = false;
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(); } catch { /* Already closed. */ }
      if (!this.stopped) this.reconnectTimer = setTimeout(() => this.connect(), Math.min(30_000, 1000 * 2 ** this.retryCount++));
    };
    this.reconnect = reconnect;
    this.connectTimer = setTimeout(reconnect, 12_000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectTimer); this.connected = true; this.retryCount = 0; this.lastMessageAt = this.now();
      try {
        for (const dex of ['', 'xyz']) socket.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids', ...(dex ? { dex } : {}) } }));
      } catch { reconnect(); }
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      let message;
      const text = String(event.data);
      if (Buffer.byteLength(text) > MAX_SOCKET_BYTES) return;
      try { message = JSON.parse(text); } catch { return; }
      this.lastMessageAt = this.now();
      if (message?.channel !== 'allMids') return;
      const mids = validMids(message.data?.mids);
      if (!mids) return;
      const keys = Object.keys(mids);
      if (keys.some(key => key.startsWith('xyz:'))) this.lastXyzAt = this.now();
      if (keys.some(key => !key.includes(':'))) this.lastHyperliquidAt = this.now();
      void this.observe('hyperliquid', mids).catch(error => this.handleError(error));
    };
    socket.onerror = reconnect; socket.onclose = reconnect;
  }

  pollCboe() {
    if (this.stopped) return Promise.resolve();
    if (this.cboePromise) return this.cboePromise;
    this.cboePromise = this.track(this.pollCboeImpl());
    this.cboePromise.then(() => { this.cboePromise = null; }, () => { this.cboePromise = null; });
    return this.cboePromise;
  }

  async pollCboeImpl() {
    if (this.cboePolling || !this.rules.some(rule => rule.source === 'cboe')) return;
    this.cboePolling = true;
    try {
      const response = await this.fetchImpl(CBOE_URL, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Cboe returned ${response.status}`);
      const payload = await boundedJson(response, MAX_SOCKET_BYTES);
      const price = priceNumber(payload?.data?.current_price);
      if (price === null || price <= 0) throw new Error('Cboe quote is unavailable');
      if (this.stopped) return;
      this.lastCboeAt = this.now();
      await this.observe('cboe', { _VIX: price });
    } finally { this.cboePolling = false; }
  }

  async writeHealth() {
    const target = path.join(this.stateDir, 'health.json');
    await writeFile(`${target}.tmp`, `${JSON.stringify({ ...this.health(), updatedAt: this.now(), rules: this.rules.length, lastSyncAt: this.lastSyncAt })}\n`, { mode: 0o600 });
    await rename(`${target}.tmp`, target);
  }

  handleError(error) {
    // Never emit rule bodies, push tokens or relay credentials.
    this.log(JSON.stringify({ event: 'price_monitor_error', message: error.message }));
    this.lastError = error.message;
    if (this.storageFailed) this.onFatal(error);
  }

  async start() {
    await this.initialize();
    this.connect();
    await this.sync().catch(error => this.handleError(error));
    if (this.stopped || this.storageFailed) return;
    this.syncTimer = setInterval(() => { void this.sync().catch(error => this.handleError(error)); }, SYNC_INTERVAL);
    this.cboeTimer = setInterval(() => { void this.pollCboe().catch(error => this.handleError(error)); }, 60_000);
    this.pingTimer = setInterval(() => {
      if (!this.socket) return;
      if (this.now() - this.lastMessageAt > 40_000) { this.reconnect(); return; }
      if (this.connected) {
        try { this.socket.send(JSON.stringify({ method: 'ping' })); } catch { this.reconnect(); }
      }
    }, 15_000);
    await this.pollCboe().catch(error => this.handleError(error));
    this.log(JSON.stringify({ event: 'price_monitor_started', version: PRICE_MONITOR_VERSION }));
  }

  async stop() {
    this.stopped = true;
    for (const timer of [this.syncTimer, this.cboeTimer, this.pingTimer]) clearInterval(timer);
    clearTimeout(this.reconnectTimer); clearTimeout(this.connectTimer);
    this.reconnect?.();
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
    await this.writeChain;
  }
}

/** OS-held loopback ownership survives no crash; stale PID text is informational. */
export async function acquirePriceMonitorLock(stateDir, port = 3401) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Invalid monitor lock port');
  const server = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const file = path.join(stateDir, 'monitor.pid');
    await writeFile(`${file}.tmp`, String(process.pid), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  } catch (error) {
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
  return {
    port: server.address().port,
    async release() {
      await unlink(path.join(stateDir, 'monitor.pid')).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

async function run() {
  const stateDir = process.env.PRICE_ALERT_STATE_DIR || DEFAULT_STATE_DIR;
  const lock = await acquirePriceMonitorLock(stateDir, Number(process.env.PRICE_ALERT_LOCK_PORT || 3401));
  const configuration = readNewsRelayConfiguration();
  if (!configuration) throw new Error('The existing news relay configuration is required');
  const monitor = new PriceAlertMonitor({ relay: createPriceAlertRelayClient(configuration), stateDir, onFatal: () => process.exit(1) });
  let finishing = false;
  const finish = async () => {
    if (finishing) return;
    finishing = true;
    try { await monitor.stop(); await lock.release(); process.exit(0); }
    catch (error) { monitor.handleError(error); process.exit(1); }
  };
  process.once('SIGTERM', () => { void finish(); });
  process.once('SIGINT', () => { void finish(); });
  await monitor.start();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(JSON.stringify({ event: 'price_monitor_start_failed', message: error.message })); process.exit(1); });
}
