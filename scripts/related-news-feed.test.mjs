import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { build } from 'esbuild';

async function bundledModule(options) {
  const result = await build({ bundle: true, write: false, format: 'esm', platform: 'node', ...options });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('ticker news finds mentions through post 200 without reusing the 40-post cache', async (t) => {
  const [{ default: relay }, client] = await Promise.all([
    bundledModule({ entryPoints: ['worker/news-relay.ts'] }),
    bundledModule({
      stdin: {
        contents: `
          export { loadNewsFeed } from './src/providers/news/client';
          export { queryKeys } from './src/lib/queryKeys';
          export { createRelatedNewsMatcher } from './src/domain/relatedNews';
          export { RELATED_NEWS_FEED_LIMIT } from './src/domain/news';
        `,
        resolveDir: process.cwd(),
      },
      define: {
        __DEV__: 'false',
        'process.env.EXPO_PUBLIC_NEWS_FEED_URL': JSON.stringify('https://news.example/feed'),
        'process.env.EXPO_PUBLIC_NEWS_RELAY_ACCESS_TOKEN': JSON.stringify('test-access-token'),
      },
    }),
  ]);
  const items = Array.from({ length: 201 }, (_, index) => ({
    id: String(index + 1),
    source: 'x',
    text: index >= 199 ? 'Nvidia earnings' : 'General market update',
    author: { name: 'Reporter' },
    publishedAt: new Date(Date.UTC(2026, 8, 12, 12) - index * 60_000).toISOString(),
    url: `https://example.com/posts/${index + 1}`,
  }));
  const env = {
    APP_ACCESS_TOKEN: 'test-access-token',
    NEWS_RELAY_KV: {
      get: async (key) => {
        assert.equal(key, 'feed:all');
        return { items, notices: [], updatedAt: '2026-09-12T12:00:00Z' };
      },
    },
  };
  t.mock.method(globalThis, 'fetch', (input, init) => relay.fetch(new Request(input, init), env, {}));

  const matcher = client.createRelatedNewsMatcher([{ id: 'hl:xyz:NVDA', symbol: 'NVDA', name: 'Nvidia', assetClass: 'equity' }]);
  const regular = await client.loadNewsFeed('all');
  assert.equal(regular.items.length, 40);
  assert.equal(matcher(regular.items).length, 0);

  const related = await client.loadNewsFeed('all', undefined, client.RELATED_NEWS_FEED_LIMIT);
  assert.equal(related.items.length, 200);
  assert.deepEqual(matcher(related.items).map(({ item }) => item.id), ['200']);
  assert.notDeepEqual(client.queryKeys.newsFeed('all'), client.queryKeys.newsFeed('all', client.RELATED_NEWS_FEED_LIMIT));

  const capped = await client.loadNewsFeed('all', undefined, 1_000);
  assert.equal(capped.items.length, 200);
});
