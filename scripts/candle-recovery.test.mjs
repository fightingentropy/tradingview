import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as history from '../src/lib/candleHistory.ts';
import { INTERVALS } from '../src/domain/intervals.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../src/data/useCandles.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const BASE_TIME = 1_800_000_000_000;
const bar = (minute, close) => ({ t: BASE_TIME + minute * 60_000, o: 100, h: Math.max(110, close), l: 90, c: close, v: 1 });

// Run the production hook's callbacks against a local cache/transport; no React
// renderer or exchange is involved in these network/timer ordering regressions.
function harness(initial) {
  let now = BASE_TIME;
  let cache = initial;
  let options;
  let tick;
  let connection;
  let appState;
  let complete;
  let fail;
  let nextTimer = 0;
  let refetches = 0;
  const effects = [];
  const timers = new Map();
  const queryClient = {
    getQueryData: () => cache,
    setQueryData: (_, updater) => { cache = updater(cache); },
    refetchQueries: () => { refetches++; return Promise.resolve(); },
  };
  const provider = {
    getCandles: () => new Promise((resolve, reject) => { complete = resolve; fail = reject; }),
    subscribeConnection: (callback) => { connection = callback; callback('connecting'); return () => {}; },
    subscribeCandles: (_, __, callback) => { tick = callback; return () => {}; },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date: { now: () => now },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    require: (name) => {
      if (name === 'react') return { useEffect: (fn) => effects.push(fn), useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}] };
      if (name === '@tanstack/react-query') return { useQuery: (input) => { options = input; return { data: cache, isError: false }; } };
      if (name === 'react-native') return { AppState: { addEventListener: (_, fn) => { appState = fn; return { remove: () => {} }; } } };
      if (name === '@/domain/intervals') return { INTERVALS };
      if (name === '@/lib/candleHistory') return history;
      if (name === '@/lib/queryClient') return { queryClient };
      if (name === '@/lib/queryKeys') return { queryKeys: { candles: (...args) => ['candles', ...args] } };
      if (name === '@/providers/registry') return { getProvider: () => provider };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  exports.useCandles({ id: 'hl:perp:BTC', source: 'hyperliquid', coinKey: 'BTC' }, '1m', 10);
  const cleanups = effects.map((effect) => effect());
  const advance = (ms) => {
    const target = now + ms;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = target;
  };
  return {
    advance, tick: (candle) => tick(candle), cache: () => cache,
    load: () => options.queryFn().then((result) => { cache = result; }),
    complete: (data) => complete(data), fail: (error) => fail(error),
    connection: (status) => connection(status), appState: (status) => appState(status),
    refetches: () => refetches, unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

test('a buffered pre-request tick cannot overwrite the completed history backfill', async () => {
  const h = harness([bar(0, 100), bar(1, 100)]);
  h.tick(bar(1, 101));
  h.advance(100);
  const load = h.load();
  h.complete([bar(0, 100), bar(1, 103)]);
  await load;
  h.advance(200);
  assert.equal(h.cache().at(-1).c, 103);
});

test('ticks received during a history request survive its older response and trailing flush', async () => {
  const h = harness([bar(0, 100), bar(1, 100)]);
  const load = h.load();
  h.advance(100);
  h.tick(bar(1, 105));
  h.complete([bar(0, 100), bar(1, 103)]);
  await load;
  assert.equal(h.cache().at(-1).c, 105);
  h.advance(250);
  assert.equal(h.cache().at(-1).c, 105);
});

test('reconnect, foreground resume, and missing intervals each request history recovery', () => {
  const h = harness([bar(0, 100)]);
  assert.equal(h.refetches(), 0);
  h.connection('connected');
  h.appState('active');
  h.tick(bar(2, 105));
  assert.equal(h.refetches(), 3);
});

test('failed history reads leave live ticks usable and unmount cancels trailing writes', async () => {
  const h = harness([bar(0, 100)]);
  h.tick(bar(0, 101));
  h.advance(100);
  const load = h.load();
  h.fail(new Error('offline'));
  await assert.rejects(load, /offline/);
  h.advance(150);
  assert.equal(h.cache().at(-1).c, 101);
  h.tick(bar(1, 102));
  h.unmount();
  h.advance(1000);
  assert.equal(h.cache().at(-1).t, bar(0, 100).t);
});
