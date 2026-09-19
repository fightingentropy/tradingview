import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

// Run the real orchestration and parsers, replacing only the native key store and
// exchange transport. These tests never send a signed order or load a user's key.
const bundled = await build({
  stdin: { contents: `export { submitTradeDraft } from './src/lib/tradeExecution';
    export { tradeReceipt } from './src/lib/tradeReceipt';
    export { fetchHlPositionSnapshot } from './src/lib/hyperliquid/info';
    export { verifySignedTradingIdentity } from './src/lib/hyperliquid/tradingIdentity';
    export { setAgentKey } from './src/lib/hyperliquid/keyStore';
    export { addressFromPrivateKey } from './src/lib/hyperliquid/sign';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
});
const nativeRequire = createRequire(import.meta.url);
const module = { exports: {} };
vm.runInNewContext(bundled.outputFiles[0].text, {
  module, exports: module.exports, console, setTimeout, clearTimeout, AbortController, Error,
  fetch: (...args) => globalThis.fetch(...args),
  require: (id) => {
    if (id === 'expo-secure-store') throw new Error('Native key storage is unavailable in tests');
    return nativeRequire(id);
  },
});
const { submitTradeDraft, tradeReceipt, fetchHlPositionSnapshot, verifySignedTradingIdentity, setAgentKey, addressFromPrivateKey } = module.exports;
const account = `0x${'2'.repeat(40)}`;
const active = { leverage: 2, isCross: true, markPx: 100, maxSzBuy: 100, maxSzSell: 100 };
const book = { bids: [{ price: 99.9, size: 100 }], asks: [{ price: 100.1, size: 100 }] };
const draft = (overrides = {}) => Object.freeze({
  coin: 'HYPE', network: 'mainnet', connectionAddress: account,
  identity: { accountAddress: account }, assetIndex: 1, szDecimals: 2,
  side: 'buy', action: 'Buy', size: 2, reduceOnly: false, closing: false, fullClose: false,
  orderType: 'market', postOnly: false, slippage: 0.005, executionMidPx: 100,
  hardIocPx: 100.5, triggerMarkPx: 100, riskEntryPx: 100.5,
  leverage: 2, isCross: true, needsLeverageUpdate: false,
  expectedActive: { leverage: 2, isCross: true }, expectedPosition: null, triggers: [],
  ...overrides,
});
const fill = { status: 'filled', totalSz: 2, avgPx: 100, oid: 42 };
function services(overrides = {}) {
  const counts = { book: 0, active: 0, position: 0, guards: 0, post: 0, leverage: 0 };
  const sent = [];
  const signAndPost = async (params) => {
    await params.validateImmediatelyBeforeSigning();
    params.assertIdentityCurrent();
    params.onPostAttempt?.();
    counts.post++;
    sent.push(params);
  };
  return { counts, sent, ports: {
    assertCurrent: () => { counts.guards++; },
    readPosition: async () => { counts.position++; return null; },
    readBook: async () => { counts.book++; return book; },
    readActive: async () => { counts.active++; return active; },
    placeOrder: async (params) => { await signAndPost(params); return params.limitPrice ? { status: 'resting', oid: 42 } : fill; },
    placeBracket: async (params) => { await signAndPost(params); return [fill, ...params.legs.map(() => ({ status: 'waitingForTrigger' }))]; },
    updateLeverage: async (params) => { await signAndPost(params); counts.leverage++; },
    ...overrides,
  } };
}

for (const side of ['buy', 'sell']) for (const orderType of ['market', 'limit']) {
  test(`${orderType} ${side} uses one final snapshot and submits the exact approved size and price`, async () => {
    const run = services();
    const result = await submitTradeDraft(draft({ side, orderType, action: side === 'buy' ? 'Buy' : 'Sell',
      hardIocPx: side === 'buy' ? 100.5 : 99.5, limitPrice: orderType === 'limit' ? 95 : undefined }), run.ports);
    assert.equal(run.counts.position, 1);
    assert.equal(run.counts.active, 1);
    assert.equal(run.counts.book, orderType === 'market' ? 1 : 0);
    assert.equal(run.counts.post, 1);
    assert.equal(run.counts.leverage, 0);
    assert.equal(run.sent[0].size, 2);
    assert.equal(run.sent[0].isBuy, side === 'buy');
    assert.equal(run.sent[0].limitPrice, orderType === 'limit' ? 95 : undefined);
    assert.equal(run.sent[0].marketIocPrice, orderType === 'market' ? side === 'buy' ? 100.5 : 99.5 : undefined);
    assert.equal(tradeReceipt(result, 'HYPE', 2).dismiss, true);
  });
}

test('book, position and leverage reads start together, with no early repeat or receipt refresh', async () => {
  const started = [];
  const release = [];
  const read = (name, value) => () => { started.push(name); return new Promise(resolve => release.push(() => resolve(value))); };
  const run = services({ readBook: read('book', book), readPosition: read('position', null), readActive: read('active', active) });
  const pending = submitTradeDraft(draft(), run.ports);
  assert.equal(started.join(','), 'book,position,active');
  assert.equal(run.counts.post, 0);
  release.forEach(done => done());
  await pending;
  assert.equal(run.counts.post, 1);
  assert.equal(started.length, 3);
});

test('price, position, leverage and connection changes still stop the order before POST', async () => {
  for (const overrides of [
    { readBook: async () => ({ bids: [{ price: 110 }], asks: [{ price: 111 }] }) },
    { readPosition: async () => ({ side: 'long', size: 5 }) },
    { readActive: async () => ({ ...active, leverage: 10 }) },
    { readPosition: async () => { throw new Error('offline'); } },
    { assertCurrent: () => { throw new Error('account changed'); } },
  ]) {
    const run = services(overrides);
    await assert.rejects(submitTradeDraft(draft(), run.ports));
    assert.equal(run.counts.post, 0);
  }
});

test('a changed account during fresh reads fails the final guard', async () => {
  let changed = false;
  const run = services({ readPosition: async () => { changed = true; return null; }, assertCurrent: () => { if (changed) throw new Error('changed'); } });
  await assert.rejects(submitTradeDraft(draft(), run.ports), /changed/);
  assert.equal(run.counts.post, 0);
});

test('leverage changes validate before both signed actions and verify the new setting', async () => {
  const run = services();
  run.ports.readActive = async () => { run.counts.active++; return { ...active, leverage: run.counts.leverage ? 3 : 2 }; };
  await submitTradeDraft(draft({ needsLeverageUpdate: true, leverage: 3 }), run.ports);
  assert.equal(run.counts.position, 2);
  assert.equal(run.counts.active, 2);
  assert.equal(run.counts.post, 2); // Settings, then order. No third snapshot.
  assert.equal(run.sent[0].leverage, 3);
});

test('a failed post-update verification prevents an order and records the settings change', async () => {
  const run = services();
  await assert.rejects(submitTradeDraft(draft({ needsLeverageUpdate: true, leverage: 3 }), run.ports), (error) => {
    assert.equal(error.name, 'TradeSubmissionUnknownError');
    assert.equal(error.leveragePostSucceeded, true);
    assert.equal(error.orderPostAttempted, false);
    return true;
  });
  assert.equal(run.counts.post, 1);
});

test('full closes enforce exact current size while skipping unrelated leverage reads', async () => {
  const run = services({ readPosition: async () => ({ side: 'long', size: 2 }) });
  await submitTradeDraft(draft({ side: 'sell', hardIocPx: 99.5, reduceOnly: true, fullClose: true, expectedPosition: { side: 'long', size: 2 } }), run.ports);
  assert.equal(run.counts.active, 0);
  assert.equal(run.sent[0].reduceOnly, true);
  await assert.rejects(submitTradeDraft(draft({ side: 'sell', hardIocPx: 99.5, size: 1, reduceOnly: true, fullClose: true, expectedPosition: { side: 'long', size: 2 } }), run.ports), /position size changed/);
  assert.equal(run.counts.post, 1);
});

test('invalid stops do not get sent and valid bracket acknowledgements stay attached', async () => {
  const bad = services();
  await assert.rejects(submitTradeDraft(draft({ triggers: [{ tpsl: 'sl', triggerPx: 110 }] }), bad.ports), /stop-loss/);
  assert.equal(bad.counts.post, 0);
  const good = services();
  const result = await submitTradeDraft(draft({ triggers: [{ tpsl: 'sl', triggerPx: 90 }] }), good.ports);
  assert.equal(good.counts.post, 1);
  assert.equal(result.legTypes.join(','), 'sl');
  assert.equal(result.results.length, 2);
});

test('a lost response is never treated as a rejected order or automatically retried', async () => {
  let posts = 0;
  const run = services({ placeOrder: async (params) => {
    await params.validateImmediatelyBeforeSigning(); params.onPostAttempt(); posts++;
    throw new Error('response lost');
  } });
  await assert.rejects(submitTradeDraft(draft(), run.ports), (error) => error.name === 'TradeSubmissionUnknownError' && error.orderPostAttempted);
  assert.equal(posts, 1);
});

const receiptInput = (overrides = {}) => ({ results: [fill], legTypes: [], requestedSize: 2, szDecimals: 2, action: 'Buy', orderType: 'market', ...overrides });
test('partial fills, missing fill facts and unknown acknowledgements stay visible', () => {
  for (const parent of [
    { ...fill, totalSz: 1 }, { ...fill, totalSz: undefined }, { ...fill, totalSz: 3 },
    { ...fill, avgPx: undefined }, { ...fill, totalSz: NaN }, { status: 'success' },
    { status: 'unknown' }, { status: 'waitingForFill' }, { status: 'resting', oid: 42 },
  ]) assert.equal(tradeReceipt(receiptInput({ results: [parent] }), 'HYPE', 2).dismiss, false);
  assert.equal(tradeReceipt(receiptInput({ results: [{ ...fill, totalSz: 1 }] }), 'HYPE', 2).detail, '1 of 2 HYPE · $100.00');
  assert.equal(tradeReceipt(receiptInput({ fullClose: true, action: 'Close' }), 'HYPE', 2).title, 'HYPE order filled');
});

test('a limit receipt reports the exchange price precision', async () => {
  const run = services();
  const result = await submitTradeDraft(draft({ orderType: 'limit', limitPrice: 1793.07, szDecimals: 3 }), run.ports);
  assert.equal(result.limitPrice, 1793.1);
  assert.equal(tradeReceipt(result, 'SNDK', 2).detail, '2 SNDK · $1,793.10');
});

test('accepted limits say placed, and an unconfirmed or rejected stop blocks automatic dismissal', () => {
  const limit = tradeReceipt(receiptInput({ results: [{ status: 'resting', oid: 42 }], orderType: 'limit', limitPrice: 95 }), 'HYPE', 2);
  assert.equal(limit.title, 'Limit buy placed');
  assert.equal(limit.detail, '2 HYPE · $95.00');
  for (const child of [undefined, { status: 'error', error: 'bad trigger' }, { status: 'success' }, { status: 'unknown' }]) {
    const receipt = tradeReceipt(receiptInput({ results: child ? [fill, child] : [fill], legTypes: ['sl'] }), 'HYPE', 2);
    assert.equal(receipt.dismiss, false);
    assert.ok(receipt.protection);
  }
});

test('the lightweight position read uses only the selected venue and rejects malformed snapshots', async (t) => {
  let response = { assetPositions: [{ position: { coin: 'xyz:GOLD', szi: '-2' } }] };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.type, 'clearinghouseState'); assert.equal(body.dex, 'xyz'); assert.equal(body.user, account);
    return { ok: true, json: async () => response };
  });
  const position = await fetchHlPositionSnapshot(account, 'xyz:GOLD');
  assert.equal(position.side, 'short'); assert.equal(position.size, 2);
  response = { assetPositions: [] };
  assert.equal(await fetchHlPositionSnapshot(account, 'xyz:GOLD'), null);
  for (const malformed of [null, {}, { assetPositions: [null] }, { assetPositions: [{ position: { coin: 'xyz:GOLD', szi: '' } }] }]) {
    response = malformed;
    await assert.rejects(fetchHlPositionSnapshot(account, 'xyz:GOLD'));
  }
});

test('both fresh identity proofs run together, but a remapped agent still fails closed', async (t) => {
  const key = `0x${'12'.repeat(32)}`;
  setAgentKey(key);
  const signer = addressFromPrivateKey(key);
  const binding = { network: 'mainnet', connectionAddress: account, accountAddress: account, signerAddress: signer, keyFingerprint: signer };
  const requests = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let target = account;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body); assert.equal(body.type, 'userRole'); requests.push(body.user);
    await gate;
    return { ok: true, json: async () => body.user === signer ? { role: 'agent', data: { user: target } } : { role: 'user' } };
  });
  const pending = verifySignedTradingIdentity(binding);
  assert.equal(requests.length, 2);
  release();
  assert.equal((await pending).accountAddress, account);
  target = `0x${'3'.repeat(40)}`;
  await assert.rejects(verifySignedTradingIdentity(binding), /master account changed/);
});
