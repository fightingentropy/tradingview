import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/web-app.mjs';

const request = (query = '', method = 'GET') => new Request(`https://trade.erlin.org/api/news${query}`, { method });
const assets = { fetch: () => { throw new Error('API must not fall through to the SPA'); } };
const item = (source, id) => ({ id, source, text: `${source} ${id}`, author: { name: source }, publishedAt: '2026-10-18T20:00:00Z' });
const snapshot = {
  items: [item('x', '1'), item('telegram', '2'), item('x', '3')],
  notices: [{ id: 'digg:unavailable', source: 'digg', message: 'Digg is temporarily unavailable.' }],
  executiveSummary: { id: 'legacy' },
  updatedAt: '2026-10-18T20:01:00Z',
};
const storage = (values) => ({ get: async (key, options) => {
  assert.equal(options.type, 'json');
  return values[key] ?? null;
} });

test('serves the relay snapshot with the stored pulse, without a relay token', async () => {
  const env = { ASSETS: assets, NEWS_RELAY_KV: storage({ 'feed:all': snapshot, 'summary:executive': { id: 'cloud' } }) };
  const response = await worker.fetch(request('?source=all&limit=200'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const body = await response.json();
  assert.deepEqual(body.items.map(({ id }) => id), ['1', '2', '3']);
  assert.equal(body.executiveSummary.id, 'cloud');
  assert.equal(body.updatedAt, snapshot.updatedAt);
});

test('filters by source, caps the limit and falls back to the legacy pulse', async () => {
  const env = { ASSETS: assets, NEWS_RELAY_KV: storage({ 'feed:all': snapshot }) };
  const filtered = await (await worker.fetch(request('?source=x&limit=1'), env)).json();
  assert.deepEqual(filtered.items.map(({ id }) => id), ['1']);
  assert.deepEqual(filtered.notices, []);
  assert.equal(filtered.executiveSummary, undefined);
  assert.equal((await (await worker.fetch(request(), env)).json()).executiveSummary.id, 'legacy');
});

test('rejects writes and unknown sources, and reports a missing snapshot', async () => {
  const env = { ASSETS: assets, NEWS_RELAY_KV: storage({}) };
  assert.equal((await worker.fetch(request('', 'POST'), env)).status, 405);
  assert.equal((await worker.fetch(request('?source=secrets'), env)).status, 400);
  assert.equal((await worker.fetch(request(), env)).status, 503);
  assert.equal((await worker.fetch(request(), { ASSETS: assets })).status, 503);
});
