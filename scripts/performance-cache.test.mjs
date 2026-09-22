import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { QueryClient } from '@tanstack/react-query';
import { DisplayReadCache, displayReadCache, acceptAccountSnapshot } from '../src/lib/hyperliquid/displayReadCache.ts';
import { createQueryCheckpoint, publicCacheSnapshot } from '../src/lib/queryPersistence.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('display reads share HTTP, separate networks/accounts and keep newer streamed state', async () => {
  const cache = new DisplayReadCache();
  const req = { type: 'clearinghouseState', user: '0xA', dex: '' };
  let finish;
  const load = mock.fn(() => new Promise(resolve => { finish = resolve; }));
  const a = cache.read('mainnet', req, load);
  const b = cache.read('mainnet', { ...req, dex: undefined }, load);
  assert.equal(load.mock.callCount(), 1);
  cache.put('mainnet', req, { value: 2 }, 5000);
  finish({ value: 1 });
  assert.deepEqual(await a, { value: 2 }); assert.deepEqual(await b, { value: 2 });
  assert.deepEqual(await cache.read('testnet', req, async () => ({ value: 3 })), { value: 3 });
  assert.deepEqual(await cache.read('mainnet', { ...req, user: '0xB' }, async () => ({ value: 4 })), { value: 4 });
  cache.invalidateAccount('mainnet', '0xa');
  assert.equal(await cache.read('mainnet', req, async () => 5), 5);
});

test('account stream snapshots expire, reject cross-account data and fall back to HTTP', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const user = '0x123';
  const request = { type: 'spotClearinghouseState', user };
  acceptAccountSnapshot('mainnet', user, 'spotState', { user: '0x456', spotState: { balances: [] } });
  const load = mock.fn(async () => ({ balances: [{ coin: 'HTTP' }] }));
  await displayReadCache.read('mainnet', request, load);
  assert.equal(load.mock.callCount(), 1);
  acceptAccountSnapshot('mainnet', user, 'spotState', { user, spotState: { balances: [{ coin: 'WS' }] } });
  assert.equal((await displayReadCache.read('mainnet', request, load)).balances[0].coin, 'WS');
  t.mock.timers.tick(5001);
  assert.equal((await displayReadCache.read('mainnet', request, load)).balances[0].coin, 'HTTP');
  assert.equal(load.mock.callCount(), 2);
  displayReadCache.invalidateAccount('mainnet', user);
});

test('hundreds of price updates do not write or serialize until a checkpoint', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const saved = [];
  const checkpoint = createQueryCheckpoint(client, { persistClient: state => saved.push(state) }, 60_000);
  try {
    for (let n = 0; n < 500; n++) client.setQueryData(['candles', 'BTC', '5m', 400], [{ c: n }]);
    assert.equal(saved.length, 0);
    checkpoint.flush();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].clientState.queries[0].state.data[0].c, 499);
    checkpoint.flush(); assert.equal(saved.length, 1);
    client.setQueryData(['hl-account', 'mainnet', 'private'], { balance: 1 });
    client.setQueryData(['news-feed', 'private'], ['private']);
    checkpoint.flush(); assert.equal(saved.length, 1);
    await tick();
  } finally { checkpoint.dispose(); client.clear(); }
});

test('cold-start snapshots are bounded and exclude signing/account/private data', () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  try {
    for (let i = 0; i < 30; i++) client.setQueryData(['candles', `coin${i}`], Array.from({ length: 3000 }, (_, t) => ({ t })), { updatedAt: i + 1 });
    for (const key of ['hl-account', 'hl-trading-identity', 'hl-legal-check', 'news-feed']) client.setQueryData([key], { private: true });
    client.setQueryData(['instruments'], { instruments: [] });
    const result = publicCacheSnapshot(client);
    assert.equal(result.queries.length, 9);
    assert.equal(result.mutations.length, 0);
    assert.equal(result.queries.filter(q => q.queryKey[0] === 'candles').every(q => q.state.data.length === 2000), true);
    assert.equal(result.queries.some(q => q.queryKey[1] === 'coin0'), false);
    assert.equal(client.getQueryData(['candles', 'coin29']).length, 3000, 'does not trim the live chart');
  } finally { client.clear(); }
});


test('display snapshots share reads while trade preflight always fetches fresh account state', async t => {
  // Bundle these exports together so the reader and stream use the same cache.
  const bundled = await build({
    stdin: { contents: `export { fetchHlAccount, fetchHlAccountOverview } from './info';
      export { acceptAccountSnapshot } from './displayReadCache';`,
      resolveDir: fileURLToPath(new URL('../src/lib/hyperliquid', import.meta.url)), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
  });
  const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const user = '0x1111111111111111111111111111111111111111';
  const state = value => ({
    marginSummary: { accountValue: String(value), totalNtlPos: '0', totalMarginUsed: '0' },
    crossMarginSummary: { accountValue: String(value), totalNtlPos: '0', totalMarginUsed: '0' },
    crossMaintenanceMarginUsed: '0', withdrawable: String(value), assetPositions: [],
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.hyperliquid.xyz/info');
    const body = JSON.parse(init.body);
    requests.push(body);
    const responses = {
      userAbstraction: 'default', meta: { collateralToken: 0 },
      perpDexs: [null, { name: 'xyz' }],
      allPerpMetas: [{ collateralToken: 0 }, { collateralToken: 0 }],
      clearinghouseState: state(12), spotClearinghouseState: { balances: [] },
      spotMetaAndAssetCtxs: [{ universe: [] }, []], userVaultEquities: [],
    };
    assert.ok(body.type in responses, body.type);
    return { ok: true, json: async () => responses[body.type] };
  });
  api.acceptAccountSnapshot('mainnet', user, 'allDexsClearinghouseState', {
    user, clearinghouseStates: [['', state(100)], ['xyz', state(200)]],
  });
  const [display, overview] = await Promise.all([
    api.fetchHlAccount(user, 'mainnet', true),
    api.fetchHlAccountOverview(user, 'standard', 'mainnet', true),
  ]);
  assert.equal(display.accountValue, 300);
  assert.equal(overview.portfolioValue, 300);
  assert.equal(requests.filter(r => r.type === 'clearinghouseState').length, 0);
  assert.equal(requests.filter(r => r.type === 'spotClearinghouseState').length, 1);
  assert.equal(requests.filter(r => r.type === 'spotMetaAndAssetCtxs').length, 1);

  const fresh = await api.fetchHlAccount(user);
  assert.equal(fresh.accountValue, 24);
  assert.equal(requests.filter(r => r.type === 'clearinghouseState').length, 2);
  assert.equal(requests.filter(r => r.type === 'spotClearinghouseState').length, 2);
});
