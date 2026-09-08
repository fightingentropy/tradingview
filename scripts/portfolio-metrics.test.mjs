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

const [{ portfolioNumber, portfolioPoints, portfolioWindowMetrics, rebasedPnl, feeVolume14d, fillNetPnl, earnUsdcState },
  { normalizeAccountActivity }, { fetchHlAccount, fetchHlPortfolio, fetchHlEarnBalance, fetchHlAccountActivity, fetchUserFills }] = await Promise.all([
  loadModule('../src/lib/portfolioMetrics.ts'),
  loadModule('../src/lib/accountActivity.ts'),
  loadModule('../src/lib/hyperliquid/info.ts'),
]);

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-08T14:00:00Z');
const ADDRESS = '0x1111111111111111111111111111111111111111';

function mockInfo(t, handler) {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.hyperliquid.xyz/info');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    const result = await handler(body);
    if (result instanceof Response) return result;
    return { ok: true, json: async () => result };
  });
}

test('numeric portfolio fields distinguish reported zero from missing or invalid values', () => {
  for (const value of [null, undefined, '', '  ', false, [], {}, 'NaN', Infinity]) {
    assert.equal(portfolioNumber(value), null);
  }
  assert.equal(portfolioNumber('0'), 0);
  assert.equal(portfolioNumber('-2.5'), -2.5);
});

test('history samples retain order-independent values and reject missing endpoints or interior samples', () => {
  assert.deepEqual(portfolioPoints([[3, '0'], [1, '10'], [2, '-2'], [1, '10']]), [
    { t: 1, v: 10 }, { t: 2, v: -2 }, { t: 3, v: 0 },
  ]);
  assert.deepEqual(portfolioPoints(undefined), []);
  assert.deepEqual(portfolioPoints([]), []);
  for (const raw of [null, {}, [[1, '2'], [2, '']], [[1, null], [2, '3']],
    [[1, '2'], [2, undefined], [3, '4']], [[1, '2'], [1, '3']], [[0, '2']],
    [[1.5, '2']], [[1, '2', '3']], [null]]) {
    assert.throws(() => portfolioPoints(raw), /Portfolio history/);
  }
});

test('cash deposits affect equity but never become trading PNL or percentage drawdown', () => {
  const accountValue = portfolioPoints([[1, '100'], [2, '1150'], [3, '1120']]);
  const pnl = portfolioPoints([[1, '25'], [2, '75'], [3, '45']]);
  const metrics = portfolioWindowMetrics({ accountValue, pnl, volume: 5000, available: true });
  assert.equal(metrics.pnl, 20);
  assert.equal(metrics.equityChange, 1020);
  assert.equal(metrics.maxPnlDrawdown, 30);
  assert.equal(metrics.lastEquity, 1120);
  assert.deepEqual(rebasedPnl(pnl), [{ t: 1, v: 0 }, { t: 2, v: 50 }, { t: 3, v: 20 }]);
  assert.equal(portfolioWindowMetrics(undefined).pnl, null);
  assert.equal(portfolioWindowMetrics({ pnl: [{ t: 1, v: 0 }] }).maxPnlDrawdown, null);
});

test('fee volume uses exactly the 14 completed UTC dates', () => {
  const utcEnd = Date.parse('2026-09-08T00:00:00Z');
  const date = (daysAgo) => new Date(utcEnd - daysAgo * DAY).toISOString().slice(0, 10);
  const row = (daysAgo, value = '1') => ({ date: date(daysAgo), userCross: value, userAdd: '2' });
  const valid = Array.from({ length: 14 }, (_, index) => row(index + 1));
  assert.equal(feeVolume14d([row(0, '999'), ...valid, row(15, '999')], NOW), 42);
  assert.equal(feeVolume14d([], NOW), 0);
  assert.equal(feeVolume14d(null, NOW), null);
  assert.equal(feeVolume14d([...valid, row(1)], NOW), null);
  assert.equal(feeVolume14d([{ ...row(1), userCross: '' }], NOW), null);
  assert.equal(feeVolume14d([{ ...row(1), userAdd: '-1' }], NOW), null);
  assert.equal(feeVolume14d([{ date: '2026-02-30', userCross: '1', userAdd: '1' }], Date.parse('2026-03-05')), null);
});

test('fill net PNL subtracts only compatible fee units and includes maker rebates', () => {
  assert.equal(fillNetPnl({ closedPnl: 12, fee: 2, feeToken: 'USDC' }), 10);
  assert.equal(fillNetPnl({ closedPnl: 12, fee: -2, feeToken: 'USDC' }), 14);
  assert.equal(fillNetPnl({ closedPnl: 12, fee: 0 }), 12);
  assert.equal(fillNetPnl({ closedPnl: 12, fee: 2, feeToken: 'HYPE' }), null);
  assert.equal(fillNetPnl({ closedPnl: 12, fee: 2 }), null);
  assert.equal(fillNetPnl({ closedPnl: 0, fee: 0, feeToken: 'USDC', pnlKnown: false }), null);
});

test('Earn only calls an absent USDC entry zero after validating the token collection', () => {
  assert.deepEqual(earnUsdcState({ tokenToState: [] }), { suppliedUsdc: 0, borrowedUsdc: 0 });
  assert.deepEqual(earnUsdcState({ tokenToState: [[1, { supply: { value: '400' }, borrow: { value: '2' } }]] }),
    { suppliedUsdc: 0, borrowedUsdc: 0 });
  assert.deepEqual(earnUsdcState({ tokenToState: [[0, { supply: { value: '100' }, borrow: { value: '0' } }]] }),
    { suppliedUsdc: 100, borrowedUsdc: 0 });
  assert.deepEqual(earnUsdcState({ tokenToState: [[0, { supply: { value: '' }, borrow: { value: '-2' } }]] }),
    { suppliedUsdc: null, borrowedUsdc: null });
  for (const raw of [null, {}, [], { tokenToState: null }, { tokenToState: [null] },
    { tokenToState: [[0, null]] }, { tokenToState: [['0', {}]] }, { tokenToState: [[0, {}], [0, {}]] },
    { tokenToState: [[1, []]] }]) assert.throws(() => earnUsdcState(raw), /Earn balance/);
});

test('vault withdrawals display the reported net amount, never the requested amount', () => {
  const [record] = normalizeAccountActivity([{ time: NOW, delta: {
    type: 'vaultWithdraw', requestedUsd: '100', netWithdrawnUsd: '92', commission: '8', closingCost: '0',
  } }], ADDRESS);
  assert.equal(record.amount, 92);
  assert.equal(record.token, 'USDC');
  assert.equal(record.flow, 'internal');
  assert.equal(record.label, 'Vault withdrawal (net)');
  const [missing] = normalizeAccountActivity([{ time: NOW, delta: { type: 'vaultWithdraw', requestedUsd: '100' } }], ADDRESS);
  assert.equal(missing.amount, null);
});

test('ledger transfers retain token units, direction and valid unknown event types', () => {
  const other = '0x2222222222222222222222222222222222222222';
  const rows = normalizeAccountActivity([
    { time: NOW, delta: { type: 'spotTransfer', token: 'HYPE:0xabc', amount: '3', usdcValue: '120', user: other, destination: ADDRESS } },
    { time: NOW + 1, delta: { type: 'internalTransfer', usdc: '10', user: ADDRESS, destination: other } },
    { time: NOW + 2, delta: { type: 'spotTransfer', token: 'HYPE', amount: '1', user: ADDRESS, destination: ADDRESS } },
    { time: NOW + 3, delta: { type: 'futureLedgerEvent' } },
  ], ADDRESS);
  assert.equal(rows[0].type, 'futureLedgerEvent');
  assert.equal(rows[0].amount, null);
  assert.equal(rows[1].flow, 'internal');
  assert.equal(rows[2].flow, 'out');
  assert.equal(rows[3].flow, 'in');
  assert.equal(rows[3].amount, 3);
  assert.equal(rows[3].token, 'HYPE');
});

test('invalid ledger records fail the read instead of silently showing an incomplete history', () => {
  for (const raw of [null, [null], [{ time: NOW }], [{ time: NOW, delta: [] }],
    [{ time: 0, delta: { type: 'deposit' } }], [{ time: NOW, delta: { type: '' } }],
    [{ time: NOW, delta: { type: 'deposit' } }, { time: 'bad', delta: { type: 'withdraw' } }]]) {
    assert.throws(() => normalizeAccountActivity(raw, ADDRESS), /Account activity/);
  }
  assert.deepEqual(normalizeAccountActivity([], ADDRESS), []);
});

test('portfolio API distinguishes absent windows from empty windows and rejects malformed series', async (t) => {
  let response = [['day', { accountValueHistory: [], pnlHistory: [], vlm: '0' }]];
  mockInfo(t, ({ type }) => { assert.equal(type, 'portfolio'); return response; });
  const result = await fetchHlPortfolio(ADDRESS);
  assert.equal(result.day.available, true);
  assert.equal(result.day.volume, 0);
  assert.equal(result.week.available, false);
  assert.equal(result.week.volume, null);
  for (const raw of [null, [['day', null]], [['day', {}], ['day', {}]],
    [['day', { accountValueHistory: null }]], [['day', { pnlHistory: [[1, '0'], [2, '']] }]]]) {
    response = raw;
    await assert.rejects(fetchHlPortfolio(ADDRESS), /Portfolio history/);
  }
});

test('Earn API preserves the malformed-state failure and known absent-USDC state', async (t) => {
  let response = { tokenToState: [null] };
  mockInfo(t, ({ type }) => { assert.equal(type, 'borrowLendUserState'); return response; });
  await assert.rejects(fetchHlEarnBalance(ADDRESS), /Earn balance/);
  response = { tokenToState: [] };
  assert.deepEqual(await fetchHlEarnBalance(ADDRESS), { suppliedUsdc: 0, borrowedUsdc: 0 });
});

test('ledger API rejects non-array responses rather than reporting no activity', async (t) => {
  mockInfo(t, ({ type }) => { assert.equal(type, 'userNonFundingLedgerUpdates'); return {}; });
  await assert.rejects(fetchHlAccountActivity(ADDRESS), /Account history response is invalid/);
});

test('standard equity completeness requires valid perp values; unified modes use authoritative spot balances', async (t) => {
  let mode = 'default';
  let accountValue = '';
  let spotBalance = { coin: 'USDC', token: 0, total: '100', hold: '0' };
  let midPx = '';
  mockInfo(t, ({ type }) => {
    switch (type) {
      case 'userAbstraction': return mode;
      case 'meta': return { collateralToken: 0 };
      case 'perpDexs': return [null, { name: 'xyz' }];
      case 'allPerpMetas': return [{ collateralToken: 0 }, { collateralToken: 0 }];
      case 'clearinghouseState': return {
        marginSummary: { accountValue, totalNtlPos: '0', totalMarginUsed: '0' },
        crossMarginSummary: { accountValue: '0', totalNtlPos: '0', totalMarginUsed: '0' },
        crossMaintenanceMarginUsed: '0', withdrawable: '0', assetPositions: [],
      };
      case 'spotClearinghouseState': return { balances: [spotBalance] };
      case 'spotMetaAndAssetCtxs': return [
        { universe: [{ name: 'HYPE/USDC', tokens: [1, 0], index: 0 }] },
        [{ coin: 'HYPE/USDC', midPx, markPx: null }],
      ];
      case 'userVaultEquities': return [];
      default: throw new Error(`Unexpected info request ${type}`);
    }
  });
  assert.equal((await fetchHlAccount(ADDRESS)).totalEquityLoaded, false);
  accountValue = '0';
  assert.equal((await fetchHlAccount(ADDRESS)).totalEquityLoaded, true);
  accountValue = '';
  for (const abstraction of ['unifiedAccount', 'portfolioMargin']) {
    mode = abstraction;
    const account = await fetchHlAccount(ADDRESS);
    assert.equal(account.totalEquityLoaded, true);
    assert.equal(account.totalEquity, 100);
  }
  mode = 'default';
  accountValue = '0';
  spotBalance = { coin: 'HYPE', token: 1, total: '2', hold: '0' };
  assert.equal((await fetchHlAccount(ADDRESS)).totalEquityLoaded, false);
  midPx = '0';
  assert.equal((await fetchHlAccount(ADDRESS)).totalEquityLoaded, true);
  spotBalance = { ...spotBalance, total: '' };
  assert.equal((await fetchHlAccount(ADDRESS)).spotBalancesLoaded, false);
});

test('fill API marks missing PNL fields unknown instead of turning them into a known zero', async (t) => {
  mockInfo(t, ({ type }) => {
    assert.equal(type, 'userFills');
    return [{ coin: 'BTC', px: '100', sz: '1', side: 'B', time: NOW, startPosition: '0', dir: 'Open Long',
      closedPnl: '', hash: 'test', oid: 1, crossed: true, fee: '0', feeToken: 'USDC', tid: 1 }];
  });
  const [fill] = await fetchUserFills(ADDRESS);
  assert.equal(fill.pnlKnown, false);
  assert.equal(fillNetPnl(fill), null);
});

const PRIVATE_SENTINEL = 'DO_NOT_EXPOSE_PRIVATE_RESPONSE_OR_TOKEN';
const validSpotBalance = () => ({ coin: 'USDC', token: 0, total: '20', hold: '0' });

function diagnosticAccountFixture({ type }) {
  switch (type) {
    case 'userAbstraction': return 'portfolioMargin';
    case 'meta': return { collateralToken: 0 };
    case 'clearinghouseState': return {
      marginSummary: { accountValue: '0', totalNtlPos: '0', totalMarginUsed: '0' },
      crossMarginSummary: { accountValue: '0', totalNtlPos: '0', totalMarginUsed: '0' },
      crossMaintenanceMarginUsed: '0', withdrawable: '0', assetPositions: [],
    };
    case 'spotClearinghouseState': return { balances: [validSpotBalance()] };
    case 'spotMetaAndAssetCtxs': return [{ universe: [] }, []];
    case 'userVaultEquities': return [];
    default: throw new Error(`Unexpected fixture request ${type}`);
  }
}

function assertPrivateSpotFailure(account, expected) {
  assert.equal(account.spotBalancesLoaded, false);
  assert.equal(account.totalEquityLoaded, false);
  assert.equal(account.spendableUsdcLoaded, false);
  assert.deepEqual(account.spotBalances, []);
  assert.equal(account.spotValue, 0);
  assert.match(account.spotBalancesError, expected);
  assert.equal(account.spotBalancesError.includes(PRIVATE_SENTINEL), false);
  assert.equal(account.spotBalancesError.includes(ADDRESS), false);
}

test('successful spot reads clear diagnostics and preserve known PM equity', async (t) => {
  mockInfo(t, diagnosticAccountFixture);
  const account = await fetchHlAccount(ADDRESS);
  assert.equal(account.spotBalancesLoaded, true);
  assert.equal(account.totalEquityLoaded, true);
  assert.equal(account.spotBalancesError, null);
  assert.equal(account.totalEquity, 20);
});

test('spot diagnostics identify invalid field categories without exposing rejected values', async (t) => {
  let response;
  mockInfo(t, (body) => body.type === 'spotClearinghouseState' ? response : diagnosticAccountFixture(body));
  const cases = [
    [{ balances: PRIVATE_SENTINEL }, /balances list/i],
    [{ balances: [null] }, /balance entry/i],
    [{ balances: [{ ...validSpotBalance(), coin: { private: PRIVATE_SENTINEL } }] }, /coin field/i],
    [{ balances: [{ ...validSpotBalance(), coin: PRIVATE_SENTINEL, token: '0' }] }, /token field/i],
    [{ balances: [{ ...validSpotBalance(), coin: PRIVATE_SENTINEL, total: PRIVATE_SENTINEL }] }, /total field/i],
    [{ balances: [{ ...validSpotBalance(), coin: PRIVATE_SENTINEL, hold: undefined }] }, /hold field/i],
    [{ balances: [{ ...validSpotBalance(), coin: PRIVATE_SENTINEL, hold: PRIVATE_SENTINEL }] }, /hold field/i],
  ];
  for (const [raw, category] of cases) {
    response = raw;
    assertPrivateSpotFailure(await fetchHlAccount(ADDRESS), category);
  }
});

test('request diagnostics distinguish balances from prices and redact HTTP bodies and exceptions', async (t) => {
  let failedType;
  let failure;
  mockInfo(t, (body) => body.type === failedType ? failure() : diagnosticAccountFixture(body));
  const failures = [
    [() => new Response(PRIVATE_SENTINEL, { status: 429 }), /HTTP 429/],
    [() => new Response(PRIVATE_SENTINEL, { status: 503 }), /HTTP 503/],
    [() => new Response(`{"private":"${PRIVATE_SENTINEL}"`, { status: 200 }), /invalid JSON response/i],
    [() => { throw new TypeError(`Network request failed: ${PRIVATE_SENTINEL} ${ADDRESS}`); }, /network connection failed/i],
    [() => { throw new Error('Hyperliquid request timed out after 15000ms'); }, /timed out/i],
    [() => { throw new Error(`Failure with private response: ${PRIVATE_SENTINEL} ${ADDRESS}`); }, /request failed/i],
    [() => { throw new Error(`Hyperliquid info 429 ${PRIVATE_SENTINEL}`); }, /request failed/i],
  ];
  for (const [type, source] of [['spotClearinghouseState', /^Balance request:/], ['spotMetaAndAssetCtxs', /^Price request:/]]) {
    failedType = type;
    for (const [simulate, category] of failures) {
      failure = simulate;
      const account = await fetchHlAccount(ADDRESS);
      assertPrivateSpotFailure(account, category);
      assert.match(account.spotBalancesError, source);
    }
  }
});

test('invalid price metadata produces a static diagnostic while keeping balances unavailable', async (t) => {
  mockInfo(t, (body) => body.type === 'spotMetaAndAssetCtxs'
    ? [{ universe: PRIVATE_SENTINEL }, null] : diagnosticAccountFixture(body));
  assertPrivateSpotFailure(await fetchHlAccount(ADDRESS), /^Price data: invalid market metadata or contexts\.$/);
});

test('PM signed holds preserve borrow liabilities and availability without enabling unsupported buying power', async (t) => {
  mockInfo(t, (body) => {
    if (body.type === 'spotClearinghouseState') return { balances: [
      { coin: 'USDC', token: 0, total: '-30', hold: '-50' },
      { coin: 'HYPE', token: 150, total: '10', hold: '0' },
    ] };
    if (body.type === 'spotMetaAndAssetCtxs') return [
      { universe: [{ name: '@107', tokens: [150, 0], index: 107 }] },
      [{ coin: '@107', markPx: '5', midPx: '5' }],
    ];
    return diagnosticAccountFixture(body);
  });
  const account = await fetchHlAccount(ADDRESS);
  const borrowedUsdc = account.spotBalances.find(({ coin }) => coin === 'USDC');
  assert.equal(account.abstractionMode, 'portfolioMargin');
  assert.equal(account.spotBalancesLoaded, true);
  assert.equal(account.totalEquityLoaded, true);
  assert.equal(account.spotBalancesError, null);
  assert.equal(borrowedUsdc.total, -30);
  assert.equal(borrowedUsdc.hold, -50);
  assert.equal(borrowedUsdc.available, 20);
  assert.equal(borrowedUsdc.usdValue, -30);
  assert.equal(account.availableUsdc, 20);
  assert.equal(account.spotValue, 20);
  assert.equal(account.totalEquity, 20);
  assert.equal(account.spendableUsdc, 0);
  assert.equal(account.spendableUsdcLoaded, false);
  assert.equal(account.riskSizingBase, 0);
  assert.equal(account.maintenanceUsage, null);
});
