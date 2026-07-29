import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_NEWS_NOTIFICATION_SOURCE_IDS,
  buildNewsPushNotificationContent,
  filterNewsItemsByNotificationSources,
  filterUnseenNewsNotificationItems,
  mergeNewsNotificationSeenKeys,
  newsNotificationItemKey,
  normalizeNewsNotificationSeenKeys,
  newsNotificationSourceIdForItem,
  normalizeNewsNotificationSourceIds,
  parseNewsNotificationItemId,
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
const removedTradeXyzItem = {
  source: 'telegram',
  author: { name: 'TradeXYZ', handle: '@tradexyz_announcements' },
};
const completeXItem = {
  id: '191234567890',
  source: 'x',
  text: 'Stocks rise after the latest release.',
  author: { name: 'Market account', handle: 'account' },
  url: 'https://example.com/x-item',
};
const completeTelegramItem = {
  id: 'tradfi_t3:93214',
  source: 'telegram',
  text: 'Central bank decision published.',
  author: { name: 'TradFi', handle: '@tradfi_t3' },
  url: 'https://example.com/telegram-item',
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
  assert.equal(newsNotificationSourceIdForItem(removedTradeXyzItem), undefined);
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

test('parses a notification item target without truncating colons in the feed ID', () => {
  assert.deepEqual(parseNewsNotificationItemId('telegram:tradfi_t3:93214'), {
    itemId: 'telegram:tradfi_t3:93214',
    source: 'telegram',
  });
  assert.deepEqual(parseNewsNotificationItemId('x:191234567890'), {
    itemId: 'x:191234567890',
    source: 'x',
  });
  assert.equal(parseNewsNotificationItemId('news:summary'), undefined);
  assert.equal(parseNewsNotificationItemId('telegram:'), undefined);
  assert.equal(parseNewsNotificationItemId(undefined), undefined);
});

test('keeps a bounded durable set of previously notified item keys', () => {
  assert.equal(newsNotificationItemKey(completeTelegramItem), 'telegram:tradfi_t3:93214');
  assert.deepEqual(
    normalizeNewsNotificationSeenKeys([
      'x:191234567890',
      'invalid',
      'x:191234567890',
    ]),
    ['x:191234567890'],
  );
  assert.deepEqual(
    mergeNewsNotificationSeenKeys(
      [completeTelegramItem],
      ['x:191234567890'],
      2,
    ),
    ['telegram:tradfi_t3:93214', 'x:191234567890'],
  );
  assert.deepEqual(
    filterUnseenNewsNotificationItems(
      [completeTelegramItem, completeXItem],
      ['x:191234567890'],
    ),
    [completeTelegramItem],
  );
});

test('builds at most one notification for each selected update batch', () => {
  assert.deepEqual(buildNewsPushNotificationContent([completeXItem]), {
    title: 'X · Market account',
    body: 'Stocks rise after the latest release.',
    itemId: 'x:191234567890',
    itemUrl: 'https://example.com/x-item',
  });
  assert.deepEqual(
    buildNewsPushNotificationContent([completeTelegramItem, completeXItem]),
    {
      title: '2 new selected news updates',
      body: 'Latest — TradFi: Central bank decision published.',
      itemId: 'news:summary',
    },
  );
  assert.equal(buildNewsPushNotificationContent([]), undefined);
});
