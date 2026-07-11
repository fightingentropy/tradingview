import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NEWS_SCHEDULER_INTERVAL_MS,
  NEWS_SOURCE_REFRESH_INTERVAL_MS,
  isNewsSourceCacheFresh,
} from './news-refresh-policy.mjs';

test('uses the configured per-source refresh intervals', () => {
  assert.deepEqual(NEWS_SOURCE_REFRESH_INTERVAL_MS, {
    x: 3_600_000,
    telegram: 300_000,
    digg: 3_600_000,
  });
  assert.equal(NEWS_SCHEDULER_INTERVAL_MS, 60_000);
});

test('expires each source cache at its own refresh boundary', () => {
  const fetchedAt = 1_000_000;
  assert.equal(isNewsSourceCacheFresh('telegram', fetchedAt, fetchedAt + 299_999), true);
  assert.equal(isNewsSourceCacheFresh('telegram', fetchedAt, fetchedAt + 300_000), false);
  assert.equal(isNewsSourceCacheFresh('x', fetchedAt, fetchedAt + 300_000), true);
  assert.equal(isNewsSourceCacheFresh('digg', fetchedAt, fetchedAt + 3_600_000), false);
});
