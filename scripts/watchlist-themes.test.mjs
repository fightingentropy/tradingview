import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: `export { useWatchlists } from './src/store/watchlists';
    export * from './src/domain/marketThemes';
    export { buildPerps } from './src/providers/hyperliquid/coins';
    export { hyperliquidProvider } from './src/providers/hyperliquid/provider';
    export { retainUnavailableMarkets } from './src/lib/marketCatalog';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'native-boundaries', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/mmkv$/ }, () => ({ path: 'test-mmkv', external: true }));
    builder.onResolve({ filter: /^\.\/ws$/ }, () => ({ path: 'test-ws', external: true }));
  } }],
});
const nativeRequire = createRequire(import.meta.url);
const plain = (value) => JSON.parse(JSON.stringify(value));
function launch(disk = new Map(), fetchImpl = () => { throw new Error('Unexpected network call'); }) {
  const module = { exports: {} };
  const subscriptions = [];
  let writes = 0;
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module, exports: module.exports, console, Error, fetch: fetchImpl,
    require: (id) => id === 'test-mmkv' ? { mmkvStorage: {
      getItem: (key) => disk.get(key) ?? null,
      setItem: (key, value) => { writes++; disk.set(key, value); },
      removeItem: (key) => disk.delete(key),
    } } : id === 'test-ws' ? {
      subscribeAllMids: (dexes) => { subscriptions.push([...dexes]); return () => {}; },
      hlSocket: {},
    } : nativeRequire(id),
  });
  return { ...module.exports, subscriptions, writes: () => writes };
}
const instrument = (symbol, dex = 'xyz') => ({
  id: dex === 'default' ? `hl:perp:${symbol}` : `hl:${dex}:${symbol}`,
  source: 'hyperliquid', assetClass: dex === 'default' ? 'crypto-perp' : 'equity-perp',
  symbol, name: symbol, coinKey: dex === 'default' ? symbol : `${dex}:${symbol}`,
});
const catalog = [instrument('SP500'), instrument('XYZ100'), instrument('10Y', 'para'),
  instrument('TLT'), instrument('GOLD'), instrument('AAPL'), instrument('SMH'),
  instrument('EUR'), instrument('BTC', 'default'), instrument('HYPE', 'default')];
const ctx = (markPx = '100') => ({ markPx, prevDayPx: '99', dayNtlVlm: '1000000', funding: '0.00001' });
const meta = (names) => [{ universe: names.map((name) => ({ name, szDecimals: 1 })) }, names.map(() => ctx())];

test('themes classify rates, indices and FX correctly, including old cached catalogs', () => {
  const app = launch();
  for (const symbol of ['SP500', 'XYZ100', 'JP225', 'KR200']) assert.equal(app.classifyTradfiSymbol(symbol), 'index');
  for (const symbol of ['10Y', 'US10Y', 'TLT']) assert.equal(app.classifyTradfiSymbol(symbol), 'rates');
  for (const symbol of ['CL', 'BRENTOIL', 'GOLD']) assert.equal(app.classifyTradfiSymbol(symbol), 'commodity');
  for (const symbol of ['EUR', 'JPY', 'GBP', 'EURUSD']) assert.equal(app.classifyTradfiSymbol(symbol), 'fx');
  assert.equal(app.classifyTradfiSymbol('MINIMAX'), 'equity-perp');
  assert.equal(app.classifyTradfiSymbol('KIOXIA'), 'equity-perp');
  assert.equal(app.watchlistThemeFor(instrument('SMH')), 'etfs');
  assert.equal(app.watchlistThemeFor(instrument('SP500')), 'indices');
  assert.equal(app.watchlistThemeFor({ ...instrument('BTC'), assetClass: 'crypto-spot', coinKey: '@1' }), null);
});

test('upgrading adds themes without changing saved lists, ordering or active selection', () => {
  const saved = [{ id: 'main', name: 'My list', symbolIds: ['hl:xyz:NVDA', 'hl:perp:ZEC'] },
    { id: 'custom', name: 'Long term', symbolIds: ['hl:xyz:AMZN'] }];
  const disk = new Map([['watchlists-v3', JSON.stringify({ version: 1, state: { lists: saved, activeId: 'custom' } })]]);
  const { useWatchlists } = launch(disk);
  useWatchlists.getState().syncThemes(catalog);
  assert.deepEqual(plain(useWatchlists.getState().lists.slice(0, 2)), saved);
  assert.equal(useWatchlists.getState().activeId, 'custom');
  assert.equal(useWatchlists.getState().lists.length, 9);
  assert.deepEqual(plain(useWatchlists.getState().lists.find((list) => list.theme === 'rates').symbolIds), ['hl:para:10Y', 'hl:xyz:TLT']);
  useWatchlists.getState().setActive('theme_rates');
  assert.equal(launch(disk).useWatchlists.getState().activeId, 'theme_rates');
});

test('new listings append while removed symbols, deleted lists, names and manual order stay saved', () => {
  const disk = new Map();
  const first = launch(disk).useWatchlists;
  first.getState().syncThemes(catalog);
  first.getState().toggle('theme_stocks', 'hl:xyz:AAPL');
  first.getState().renameList('theme_stocks', 'Companies');
  first.getState().reorder('theme_indices', ['hl:xyz:XYZ100', 'hl:xyz:SP500']);
  first.getState().deleteList('theme_rates');
  const reopened = launch(disk);
  reopened.useWatchlists.getState().syncThemes([...catalog, instrument('MSFT'), instrument('2Y', 'para')]);
  const lists = reopened.useWatchlists.getState().lists;
  assert.equal(lists.some((list) => list.theme === 'rates'), false);
  assert.deepEqual(plain(lists.find((list) => list.theme === 'indices').symbolIds), ['hl:xyz:XYZ100', 'hl:xyz:SP500']);
  assert.equal(lists.find((list) => list.theme === 'stocks').name, 'Companies');
  assert.deepEqual(plain(lists.find((list) => list.theme === 'stocks').symbolIds), ['hl:xyz:MSFT']);
  const before = reopened.writes();
  reopened.useWatchlists.getState().syncThemes([...catalog, instrument('MSFT'), instrument('2Y', 'para')]);
  assert.equal(reopened.writes(), before, 'unchanged catalog does not rewrite persisted lists');
});

test('partial first loads can add missing themes later without duplicating or switching lists', () => {
  const { useWatchlists } = launch();
  useWatchlists.getState().syncThemes([instrument('BTC', 'default')]);
  useWatchlists.getState().setActive('theme_crypto');
  useWatchlists.getState().syncThemes(catalog);
  useWatchlists.getState().syncThemes(catalog);
  assert.equal(useWatchlists.getState().lists.length, 8);
  assert.equal(useWatchlists.getState().activeId, 'theme_crypto');
  useWatchlists.getState().deleteList('theme_rates');
  useWatchlists.getState().resetDefaults();
  assert.equal(useWatchlists.getState().lists.some((list) => list.theme === 'rates'), true);
});

test('Paragon rates retain their exchange identity and skip delisted or unrelated markets', () => {
  const { buildPerps } = launch();
  const input = meta(['para:10Y', 'para:2Y', 'para:AAPL', 'xyz:TLT']);
  input[0].universe[1].isDelisted = true;
  const output = buildPerps(input, 'para');
  assert.equal(output.instruments.length, 1);
  assert.equal(output.instruments[0].id, 'hl:para:10Y');
  assert.equal(output.instruments[0].coinKey, 'para:10Y');
  assert.equal(output.instruments[0].assetClass, 'rates');
  assert.equal(output.instruments[0].venue, 'Paragon');
  assert.equal(output.instruments[0].supportsPriceAlerts, false);
  assert.equal(output.quotes['hl:para:10Y'].last, 100);
});

test('a rates-feed outage retains its last quote without blocking the XYZ or crypto catalogs', async () => {
  const app = launch(new Map(), async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.dex === 'para') throw new Error('Rates feed unavailable');
    const result = body.type === 'metaAndAssetCtxs' ? meta(body.dex === 'xyz' ? ['xyz:TLT'] : ['BTC'])
      : body.type === 'spotMetaAndAssetCtxs' ? [{ universe: [], tokens: [] }, []]
        : { questions: [], outcomes: [] };
    return { ok: true, json: async () => result };
  });
  const next = await app.hyperliquidProvider.loadMarkets();
  assert.deepEqual(plain(next.instruments.map((item) => item.id)), ['hl:perp:BTC', 'hl:xyz:TLT']);
  assert.equal(next.marketErrors['hyperliquid:para'], 'Rates feed unavailable');
  const previous = { instruments: [instrument('10Y', 'para')], quotes: { 'hl:para:10Y': { last: 4.9, ts: 100 } } };
  const retained = app.retainUnavailableMarkets(next, previous, next.marketErrors);
  assert.equal(retained.quotes['hl:para:10Y'].ts, 100);
  assert.equal(retained.instruments.length, 3);
  app.hyperliquidProvider.subscribePrices(['para:10Y', 'xyz:TLT', 'BTC', 'para:10Y'], () => {});
  assert.equal(app.subscriptions[0].length, 3);
  assert.equal(app.subscriptions[0].includes('para'), true);
  assert.equal(app.subscriptions[0].includes('xyz'), true);
});
