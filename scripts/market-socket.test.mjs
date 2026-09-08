import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/providers/hyperliquid/ws.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Execute the production socket with deterministic time and a local transport. */
function harness() {
  let now = 1_800_000_000_000;
  let nextTimer = 0;
  const timers = new Map();
  const sockets = [];
  let onAppState;
  const schedule = (fn, delay, interval) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + delay, interval });
    return id;
  };
  class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.onclose?.(); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  }
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, WebSocket: FakeSocket, Date: { now: () => now },
    setTimeout: (fn, delay) => schedule(fn, delay, 0),
    setInterval: (fn, delay) => schedule(fn, delay, delay),
    clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id),
    require: (name) => {
      if (name === 'react-native') return { AppState: { addEventListener: (_, fn) => { onAppState = fn; } } };
      if (name === './rest') return { HL_WS_URL: 'wss://local.test' };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const advance = (ms) => {
    const target = now + ms;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      now = timer.at;
      if (timer.interval) timer.at += timer.interval;
      else timers.delete(id);
      timer.fn();
    }
    now = target;
  };
  return { ...exports, sockets, advance, appState: (state) => onAppState(state) };
}

test('a silent open connection is replaced and subscriptions recover', () => {
  const h = harness();
  const statuses = [];
  h.hlSocket.subscribeConnection((status) => statuses.push(status));
  h.subscribeCandle('BTC', '1m', () => {});
  h.sockets[0].open();
  assert.equal(statuses.at(-1), 'connected');
  h.advance(45_000);
  assert.equal(h.sockets[0].readyState, 3);
  assert.equal(statuses.at(-1), 'reconnecting');
  h.advance(500);
  assert.equal(h.sockets.length, 2);
  h.sockets[1].open();
  assert.equal(h.sockets[1].sent[0].subscription.coin, 'BTC');
  assert.equal(h.sockets[1].sent[0].subscription.interval, '1m');
  assert.equal(statuses.at(-1), 'connected');
});

test('pong/data messages keep a healthy socket alive; a hung handshake is bounded', () => {
  const h = harness();
  h.subscribeAllMids([undefined], () => {});
  h.advance(15_500);
  assert.equal(h.sockets.length, 2, 'connection timeout must retry without waiting forever for onclose');
  h.sockets[1].open();
  for (let index = 0; index < 5; index++) {
    h.advance(20_000);
    h.sockets[1].receive({ channel: 'pong' });
  }
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[1].readyState, 1);
});

test('background pause and final unsubscribe stop sockets and retries', () => {
  const h = harness();
  const statuses = [];
  h.hlSocket.subscribeConnection((status) => statuses.push(status));
  const unsubscribe = h.subscribeAllMids([undefined], () => {});
  h.sockets[0].open();
  h.appState('background');
  h.advance(100_000);
  assert.equal(h.sockets.length, 1);
  assert.equal(statuses.at(-1), 'paused');
  h.appState('active');
  h.sockets[1].open();
  unsubscribe();
  h.advance(100_000);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[1].readyState, 3);
  assert.equal(statuses.at(-1), 'idle');
});

test('late callbacks from a retired socket cannot close its replacement', () => {
  const h = harness();
  h.subscribeAllMids([undefined], () => {});
  h.sockets[0].open();
  const lateClose = h.sockets[0].onclose;
  h.sockets[0].onerror();
  h.advance(500);
  h.sockets[1].open();
  lateClose();
  assert.equal(h.sockets[1].readyState, 1);
  h.advance(10_000);
  assert.equal(h.sockets.length, 2);
});
