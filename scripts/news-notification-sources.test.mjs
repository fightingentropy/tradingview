import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_NEWS_NOTIFICATION_SOURCE_IDS,
  filterNewsItemsByNotificationSources,
  newsNotificationSourceIdForItem,
  normalizeNewsNotificationSourceIds,
} from '../src/domain/newsNotificationSources.ts';

const xItem = { source: 'x', author: { name: 'X account', handle: 'account' } };
const watcherGuruItem = {
  source: 'telegram',
  author: { name: 'Watcher.Guru', handle: 'WatcherGuru' },
};
const tradfiItem = {
  source: 'telegram',
  author: { name: 'TradFi', handle: '@tradfi_t3' },
};

test('normalizes, validates, and de-duplicates selected source IDs', () => {
  assert.deepEqual(normalizeNewsNotificationSourceIds(undefined), ALL_NEWS_NOTIFICATION_SOURCE_IDS);
  assert.deepEqual(
    normalizeNewsNotificationSourceIds([
      'telegram:watcherguru',
      'unknown:source',
      'telegram:watcherguru',
    ]),
    ['telegram:watcherguru'],
  );
});

test('maps feed items to stable X-list and Telegram-channel IDs', () => {
  assert.equal(newsNotificationSourceIdForItem(xItem), 'x:list:1933193197817135501');
  assert.equal(newsNotificationSourceIdForItem(watcherGuruItem), 'telegram:watcherguru');
  assert.equal(newsNotificationSourceIdForItem(tradfiItem), 'telegram:tradfi_t3');
  assert.equal(
    newsNotificationSourceIdForItem({ source: 'telegram', author: { name: 'Other' } }),
    undefined,
  );
});

test('filters a mixed batch to only the selected alert sources', () => {
  assert.deepEqual(
    filterNewsItemsByNotificationSources(
      [xItem, watcherGuruItem, tradfiItem],
      ['telegram:watcherguru'],
    ),
    [watcherGuruItem],
  );
  assert.deepEqual(
    filterNewsItemsByNotificationSources([xItem, watcherGuruItem, tradfiItem], [
      'x:list:1933193197817135501',
      'telegram:tradfi_t3',
    ]),
    [xItem, tradfiItem],
  );
});
