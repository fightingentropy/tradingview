import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { legacyWebPath } from '../worker/web-app.mjs';

test('old web links resolve to the imported terminal without guessing unsupported instruments', () => {
  for (const [path, expected] of [
    ['/account/', '/portfolio'],
    ['/economic-calendar', '/calendar'],
    ['/news', '/brief'],
    ['/markets', '/trade'],
    ['/symbol/hl%3Aperp%3ABTC', '/trade/BTC'],
    ['/symbol/hl:xyz:NVDA', '/trade/NVDA'],
    ['/symbol/hl:spot:@107', '/trade'],
    ['/symbol/cboe:VIX', '/trade'],
    ['/symbol/%E0%A4%A', '/trade'],
    ['/symbol/hl:perp:%2F%2Fevil.example', '/trade'],
    ['/portfolio', null],
    ['/trade/xyz:NVDA', null],
  ]) assert.equal(legacyWebPath(path), expected, path);
});

test('legacy redirects preserve the current origin and query, and reject unsafe methods', async () => {
  const env = { ASSETS: { fetch: () => { throw new Error('assets must not run'); } } };
  const response = await worker.fetch(new Request('https://terminal.example/account?view=history'), env);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://terminal.example/portfolio?view=history');
  const post = await worker.fetch(new Request('https://terminal.example/account', { method: 'POST' }), env);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('unknown API paths stay JSON errors instead of falling through to the trading UI', async () => {
  const response = await worker.fetch(new Request('https://terminal.example/api/missing'), {
    ASSETS: { fetch: () => { throw new Error('assets must not run'); } },
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
});

test('terminal routes and assets are handed to the SPA asset binding unchanged', async () => {
  for (const path of ['/trade/BTC', '/portfolio', '/brief', '/calendar', '/assets/app.js']) {
    const request = new Request(`https://terminal.example${path}`);
    const expected = new Response('asset', { headers: { 'X-Content-Type-Options': 'nosniff' } });
    const actual = await worker.fetch(request, { ASSETS: { fetch: (incoming) => {
      assert.equal(incoming, request);
      return expected;
    } } });
    assert.equal(actual, expected);
  }
});
