import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';

// Exercise the actual stores and loader. Only native persistence is replaced.
const bundled = await build({
  stdin: { contents: `export { usePreferences } from './src/store/preferences';
    export { useChartSettings } from './src/store/chartSettings';
    export { useHlConnection } from './src/store/hlConnection';
    export { loadMarketCatalog } from './src/lib/loadMarketCatalog';
    export { networkIsOnline } from './src/lib/queryLifecycle';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'native-storage-boundary', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/mmkv$/ }, () => ({ path: 'test-mmkv', external: true }));
  } }],
});
const nativeRequire = createRequire(import.meta.url);
function launch(values = new Map(), secure = { key: null, remove: async function () { this.key = null; } }) {
  const module = { exports: {} };
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module, exports: module.exports, console, setTimeout, clearTimeout,
    require: (id) => id === 'test-mmkv' ? { mmkvStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    } } : id === 'expo-secure-store' ? {
      getItem: () => secure.key,
      setItem: (_name, value) => { secure.key = value; },
      deleteItemAsync: () => secure.remove(),
    } : nativeRequire(id),
  });
  return module.exports;
}

test('returning to Account and reopening the app preserves sections, chart choices and category', () => {
  const disk = new Map();
  const first = launch(disk);
  first.usePreferences.getState().setAccountTab('orders');
  first.usePreferences.getState().setMarketsFilter('stocks');
  first.useChartSettings.getState().setRange('1M');
  first.useChartSettings.getState().setChartType('line');
  first.useChartSettings.getState().toggleRsi();
  const reopened = launch(disk);
  assert.equal(reopened.usePreferences.getState().accountTab, 'orders');
  assert.equal(reopened.usePreferences.getState().marketsFilter, 'stocks');
  assert.equal(reopened.useChartSettings.getState().range, '1M');
  assert.equal(reopened.useChartSettings.getState().chartType, 'line');
  assert.equal(reopened.useChartSettings.getState().rsi, true);
  assert.equal(reopened.useHlConnection.getState().hasKey, false);
});

test('existing installations acquire safe chart defaults without losing their indicators', () => {
  const disk = new Map([['chart-settings-v2', JSON.stringify({ version: 1, state: { smaPeriods: [20, 50], volume: true, range: 'invalid' } })]]);
  const { useChartSettings } = launch(disk);
  const settings = useChartSettings.getState();
  assert.equal(settings.range, '1D');
  assert.equal(settings.chartType, 'candle');
  assert.equal(settings.smaPeriods.join(','), '20,50');
  assert.equal(settings.volume, true);
});

test('disconnect failure stays visible and can be retried without losing the connection', async () => {
  const secure = { key: null, remove: async () => { throw new Error('Keychain is locked'); } };
  const { useHlConnection } = launch(new Map(), secure);
  const address = `0x${'2'.repeat(40)}`;
  useHlConnection.getState().connectVerifiedAccount(address, `0x${'1'.repeat(64)}`);
  await assert.rejects(useHlConnection.getState().disconnect(), /Could not remove/);
  assert.equal(useHlConnection.getState().address, address);
  assert.match(useHlConnection.getState().disconnectError, /Could not remove/);
  assert.equal(useHlConnection.getState().disconnecting, false);
  secure.remove = async () => { secure.key = null; };
  await useHlConnection.getState().disconnect();
  assert.equal(useHlConnection.getState().address, null);
  assert.equal(useHlConnection.getState().hasKey, false);
  assert.equal(secure.key, null);
});

test('first launch outage is an error and a retry loads real markets', async () => {
  const { loadMarketCatalog } = launch();
  const provider = { source: 'hyperliquid', loadMarkets: async () => { throw new Error('Offline'); } };
  await assert.rejects(loadMarketCatalog([provider]), /Markets are unavailable/);
  const btc = { id: 'hl:perp:BTC', source: 'hyperliquid', assetClass: 'crypto-perp', coinKey: 'BTC' };
  provider.loadMarkets = async () => ({ instruments: [btc], quotes: { [btc.id]: { last: 100, ts: 1 } } });
  const live = await loadMarketCatalog([provider]);
  assert.equal(live.instruments[0].id, btc.id);
  provider.loadMarkets = async () => { throw new Error('Offline again'); };
  const cached = await loadMarketCatalog([provider], live);
  assert.equal(cached.instruments[0].id, btc.id);
  assert.equal(cached.quotes[btc.id].ts, 1, 'cached prices must retain their true age');
  assert.ok(cached.marketErrors.hyperliquid);
  provider.loadMarkets = async () => ({ instruments: [btc], quotes: { [btc.id]: { last: 110, ts: 2 } } });
  const recovered = await loadMarketCatalog([provider], cached);
  assert.equal(recovered.quotes[btc.id].last, 110);
  assert.equal(Object.keys(recovered.marketErrors).length, 0);
});

test('a paused first query automatically fetches when connectivity returns', async () => {
  const { networkIsOnline } = launch();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let calls = 0;
  client.mount();
  onlineManager.setOnline(networkIsOnline({ isConnected: false }));
  const observer = new QueryObserver(client, { queryKey: ['reconnect'], queryFn: async () => ++calls });
  let done;
  const recovered = new Promise(resolve => { done = resolve; });
  const unsubscribe = observer.subscribe(result => { if (result.isSuccess) done(); });
  try {
    assert.equal(observer.getCurrentResult().fetchStatus, 'paused');
    assert.equal(observer.getCurrentResult().isLoading, false, 'offline UI must handle paused queries explicitly');
    assert.equal(calls, 0);
    onlineManager.setOnline(networkIsOnline({ isConnected: true, isInternetReachable: true }));
    await recovered;
    assert.equal(observer.getCurrentResult().data, 1);
    assert.equal(calls, 1);
  } finally { unsubscribe(); client.unmount(); client.clear(); onlineManager.setOnline(true); }
});
