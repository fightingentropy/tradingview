import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}
const [{ deriveAccountOverview }, { fetchHlAccountOverview }, { queryKeys }] = await Promise.all([
  loadModule('../src/lib/accountOverview.ts'),
  loadModule('../src/lib/hyperliquid/info.ts'),
  loadModule('../src/lib/queryKeys.ts'),
]);

const ADDRESS = '0x1111111111111111111111111111111111111111';
const prices = { byToken: { 0: 1, 150: 5, 1: 1.01 }, byCoin: {} };
function state({ notional = '0', maintenance = '0', pnl = '0', equity = '0', isolated = '0' } = {}) {
  return {
    marginSummary: { accountValue: equity, totalNtlPos: notional },
    crossMarginSummary: { accountValue: equity },
    crossMaintenanceMarginUsed: maintenance,
    assetPositions: [{ position: { unrealizedPnl: pnl, leverage: { type: 'isolated' }, marginUsed: isolated } }],
  };
}
const spot = {
  portfolioMarginRatio: '0.2719',
  tokenToPortfolioBorrowRatio: [[0, '0.24'], [1, '0.63']],
  balances: [
    { coin: 'USDC', token: 0, total: '-30', ltv: '0' },
    { coin: 'HYPE', token: 150, total: '10', ltv: '0.65' },
  ],
};
const perps = [
  { collateralToken: 0, state: state({ notional: '100', maintenance: '5', pnl: '2' }) },
  { collateralToken: 0, state: state({ notional: '-200', maintenance: '10', pnl: '-3' }) },
  { collateralToken: 1, state: state({ notional: '300', maintenance: '20', pnl: '4' }) },
];
const summary = (changes = {}) => deriveAccountOverview({ mode: 'portfolioMargin', spot, perps, prices, ...changes });

test('PM uses the exchange ratio and highest borrow cap, preserving liabilities and all-DEX exposure', () => {
  const result = summary();
  assert.equal(result.marginRatio, 0.2719);
  assert.equal(result.borrowCapUsed, 0.63);
  assert.equal(result.portfolioValue, 20); // $50 HYPE minus $30 borrowed USDC
  assert.equal(result.unrealizedPnl, 3.04); // Includes a third DEX settled in USDT.
  assert.equal(result.perpsMaintenanceMargin, 35.2);
  assert.equal(result.accountLeverage, 32.65); // ($50 collateral + $603 perps) / $20 equity.
});

test('zero ratios remain zero, ratios over 100% remain visible, and missing ratios stay unknown', () => {
  assert.equal(summary({ spot: { ...spot, portfolioMarginRatio: '0' } }).marginRatio, 0);
  assert.equal(summary({ spot: { ...spot, portfolioMarginRatio: '1.12' } }).marginRatio, 1.12);
  for (const value of [undefined, null, '', 'bad', -1, Infinity]) {
    assert.equal(summary({ spot: { ...spot, portfolioMarginRatio: value } }).marginRatio, null);
  }
  assert.equal(summary({ spot: { ...spot, tokenToPortfolioBorrowRatio: [] } }).borrowCapUsed, 0);
  for (const value of [undefined, null, [[0, '']], [[0, '-1']], [[0, '0.2'], [0, '0.4']], [null]]) {
    assert.equal(summary({ spot: { ...spot, tokenToPortfolioBorrowRatio: value } }).borrowCapUsed, null);
  }
});

test('price or DEX outages never turn partial equity or maintenance into a valid total', () => {
  const unpriced = summary({ prices: null });
  assert.equal(unpriced.portfolioValue, null);
  assert.equal(unpriced.accountLeverage, null);
  assert.equal(unpriced.perpsMaintenanceMargin, null);
  assert.equal(unpriced.marginRatio, 0.2719);
  assert.equal(unpriced.borrowCapUsed, 0.63);
  const missingDex = summary({ perps: null });
  assert.equal(missingDex.perpsMaintenanceMargin, null);
  assert.equal(missingDex.unrealizedPnl, null);
  assert.equal(missingDex.accountLeverage, null);
  assert.equal(missingDex.portfolioValue, 20);
  assert.equal(missingDex.marginRatio, 0.2719);
});

test('invalid and unknown balances do not silently become zero equity', () => {
  for (const balances of [undefined, [null], [spot.balances[0], spot.balances[0]], [{ coin: 'HYPE', token: 150, total: '' }], [{ coin: 'UNKNOWN', token: 99, total: '1' }]]) {
    assert.equal(summary({ spot: { ...spot, balances } }).portfolioValue, null);
  }
  const unknownDust = summary({ spot: { ...spot, balances: [...spot.balances, { coin: 'UNKNOWN', token: 99, total: '0' }] } });
  assert.equal(unknownDust.portfolioValue, 20);
  assert.equal(summary({ spot: { ...spot, balances: [{ coin: 'USDC', token: 0, total: '-1' }] } }).accountLeverage, null);
});

test('malformed position data does not suppress independently reported portfolio ratios', () => {
  const result = summary({ perps: [{ collateralToken: 0, state: { ...state(), assetPositions: [null] } }] });
  assert.equal(result.unrealizedPnl, null);
  assert.equal(result.marginRatio, 0.2719);
  assert.equal(result.borrowCapUsed, 0.63);
});

test('unified ratio groups DEXs by collateral and deducts isolated margin once', () => {
  const result = summary({ mode: 'unified', spot: { balances: [
    { coin: 'USDC', token: 0, total: '100' }, { coin: 'USDT', token: 1, total: '40' },
  ] }, perps: [
    { collateralToken: 0, state: state({ notional: '200', maintenance: '10', isolated: '20' }) },
    { collateralToken: 0, state: state({ notional: '100', maintenance: '14', isolated: '0' }) },
    { collateralToken: 1, state: state({ notional: '100', maintenance: '20', isolated: '10' }) },
  ] });
  assert.equal(result.marginRatio, 20 / 30); // max(24 / 80 USDC, 20 / 30 USDT)
  assert.equal(result.portfolioValue, 140.4);
  assert.equal(result.accountLeverage, 401 / 140.4);
  assert.equal(result.borrowCapUsed, null);
});

test('standard mode uses separate perpetual balances and the worst cross-margin ratio', () => {
  const result = summary({ mode: 'standard', perps: [
    { collateralToken: 0, state: state({ equity: '100', notional: '300', maintenance: '10' }) },
    { collateralToken: 0, state: state({ equity: '50', notional: '100', maintenance: '20' }) },
  ] });
  assert.equal(result.portfolioValue, 150);
  assert.equal(result.marginRatio, 0.4);
  assert.equal(result.accountLeverage, 400 / 150);
  assert.equal(result.borrowCapUsed, null);
});

test('empty accounts report zero while a positive requirement without collateral is unknown', () => {
  const empty = summary({ spot: { balances: [], portfolioMarginRatio: '0', tokenToPortfolioBorrowRatio: [] }, perps: [{ collateralToken: 0, state: state() }] });
  assert.equal(empty.portfolioValue, 0);
  assert.equal(empty.accountLeverage, 0);
  assert.equal(empty.unrealizedPnl, 0);
  for (const mode of ['unified', 'standard']) {
    assert.equal(summary({ mode, spot: { balances: [] }, perps: [{ collateralToken: 0, state: state({ maintenance: '5' }) }] }).marginRatio, null);
  }
});

function mockInfo(t, transform = (_body, result) => result) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.hyperliquid.xyz/info');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    requests.push(body);
    if (body.user) assert.equal(body.user, ADDRESS);
    const responses = {
      perpDexs: [null, { name: 'xyz' }, { name: 'flx' }],
      allPerpMetas: [{ collateralToken: 0 }, { collateralToken: 0 }, { collateralToken: 1 }],
      spotClearinghouseState: spot,
      // Price the HYPE/USDT pair through an inverse USDC/USDT pair.
      spotMetaAndAssetCtxs: [{ universe: [
        { name: '@1', index: 1, tokens: [150, 1] }, { name: '@2', index: 2, tokens: [0, 1] },
      ] }, [{ coin: '@1', markPx: '5' }, { coin: '@2', markPx: '0.8' }]],
      clearinghouseState: perps[body.dex === 'flx' ? 2 : body.dex === 'xyz' ? 1 : 0].state,
    };
    assert.ok(body.type in responses, body.type);
    const result = await transform(body, responses[body.type]);
    return { ok: true, json: async () => result };
  });
  return requests;
}

test('expanded overview discovers every DEX and resolves inverse and multi-hop spot prices', async (t) => {
  const requests = mockInfo(t);
  const result = await fetchHlAccountOverview(ADDRESS, 'portfolioMargin');
  assert.deepEqual(requests.filter((request) => request.type === 'clearinghouseState').map((request) => request.dex ?? '').sort(), ['', 'flx', 'xyz']);
  assert.equal(result.marginRatio, 0.2719);
  assert.equal(result.portfolioValue, 32.5); // 10 HYPE * (5 USDT * $1.25) - $30
  assert.equal(result.perpsMaintenanceMargin, 40);
  assert.equal(result.unrealizedPnl, 4);
  assert.equal(result.accountLeverage, 737.5 / 32.5);
});

test('a failed extra DEX preserves exchange ratios but withholds incomplete perp totals', async (t) => {
  mockInfo(t, (body, result) => {
    if (body.type === 'clearinghouseState' && body.dex === 'flx') throw new Error('offline');
    return result;
  });
  const result = await fetchHlAccountOverview(ADDRESS, 'portfolioMargin');
  assert.equal(result.marginRatio, 0.2719);
  assert.equal(result.borrowCapUsed, 0.63);
  assert.equal(result.perpsMaintenanceMargin, null);
  assert.equal(result.unrealizedPnl, null);
});

test('overview query identities isolate account, mode and network and share order invalidation', () => {
  const key = queryKeys.hlAccountOverview('mainnet', ADDRESS, 'portfolioMargin');
  assert.deepEqual(key.slice(0, 1), queryKeys.hlAccountPrefix());
  assert.notDeepEqual(key, queryKeys.hlAccountOverview('testnet', ADDRESS, 'portfolioMargin'));
  assert.notDeepEqual(key, queryKeys.hlAccountOverview('mainnet', 'another-account', 'portfolioMargin'));
  assert.notDeepEqual(key, queryKeys.hlAccountOverview('mainnet', ADDRESS, 'unified'));
});
