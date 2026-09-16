import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/web-app.mjs';

const request = (suffix = '', method = 'GET') => new Request(`https://trade.erlin.org/api/daily-briefs${suffix}`, { method });
const assets = { fetch: () => { throw new Error('API must not fall through to the SPA'); } };

test('serves a brief index and an independently stored edition', async () => {
  const keys = [];
  const env = { ASSETS: assets, DAILY_BRIEFS: { get: async (key, options) => {
    keys.push(key);
    assert.equal(options.type, 'stream');
    return new Response(JSON.stringify({ key })).body;
  } } };
  for (const suffix of ['', '/2026-09-16']) {
    const response = await worker.fetch(request(suffix), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { key: keys.at(-1) });
  }
  assert.deepEqual(keys, ['index:v1', 'edition:v1:2026-09-16']);
});

test('does not expose writes or arbitrary KV keys', async () => {
  const env = { ASSETS: assets, DAILY_BRIEFS: { get: () => { throw new Error('Storage should not be read'); } } };
  assert.equal((await worker.fetch(request('', 'POST'), env)).status, 405);
  assert.equal((await worker.fetch(request('/some-secret'), env)).status, 404);
  assert.equal((await worker.fetch(request('/2026-09-16/extra'), env)).status, 404);
});

test('missing publications and failed storage return honest, uncached errors', async (context) => {
  context.mock.method(console, 'error', () => {});
  const missing = { ASSETS: assets, DAILY_BRIEFS: { get: async () => null } };
  assert.equal((await worker.fetch(request(), missing)).status, 503);
  assert.equal((await worker.fetch(request('/2026-09-16'), missing)).status, 404);
  const failed = await worker.fetch(request(), { ASSETS: assets, DAILY_BRIEFS: { get: async () => { throw new Error('Unavailable'); } } });
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await failed.json(), { error: 'brief_unavailable' });
});

test('HEAD checks publication availability without returning a body', async () => {
  const response = await worker.fetch(request('', 'HEAD'), { ASSETS: assets, DAILY_BRIEFS: { get: async () => new Response('index').body } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});
