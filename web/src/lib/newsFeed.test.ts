import { expect, test } from 'bun:test';
import { parseNewsFeed } from './newsFeed';

const item = { id: 'story', source: 'digg', text: 'A story\n\nIts summary.', publishedAt: '2026-10-03T12:00:00Z', author: { name: 'Digg', handle: 'digg' }, url: 'https://digg.com/world-business/example', media: [] };
const updatedAt = '2026-10-03T12:05:00Z';

test('keeps all supported news sources and their original links', () => {
  const sources = ['x', 'telegram', 'digg', 'paste'];
  const feed = parseNewsFeed({ items: sources.map(source => ({ ...item, source })), notices: [], updatedAt });
  expect(feed.items.map(item => item.source)).toEqual(sources);
  expect(feed.items[2].url).toBe(item.url);
  expect(feed.updatedAt).toBe(updatedAt);
});

test('rejects broken entries and duplicate stories without dropping other sources', () => {
  const feed = parseNewsFeed({ items: [item, item, { ...item, source: 'x' }, { ...item, source: 'unknown' }, { ...item, id: 'bad-date', publishedAt: 'invalid' }, { ...item, id: 'bad-author', author: null }], updatedAt });
  expect(feed.items.map(item => `${item.source}:${item.id}`)).toEqual(['digg:story', 'x:story']);
});

test('keeps source notices and removes unsafe links and media', () => {
  const feed = parseNewsFeed({ items: [{ ...item, url: 'javascript:alert(1)', author: { name: 'Digg', avatarUrl: 'data:text/html,unsafe' }, media: [{ type: 'image', previewUrl: 'https://images.example/photo.jpg' }, { type: 'video', previewUrl: 'javascript:alert(1)' }] }], notices: [{ id: 'telegram:unavailable', source: 'telegram', message: 'Channel unavailable.' }, { id: 'bad', source: 'unknown', message: 'Unsupported.' }], updatedAt });
  expect(feed.items[0].url).toBeUndefined();
  expect(feed.items[0].author.avatarUrl).toBeUndefined();
  expect(feed.items[0].media).toEqual([{ type: 'image', previewUrl: 'https://images.example/photo.jpg' }]);
  expect(feed.notices).toEqual([{ id: 'telegram:unavailable', source: 'telegram', message: 'Channel unavailable.' }]);
});

test('does not invent a fresh timestamp for an invalid snapshot', () => {
  expect(() => parseNewsFeed({ items: [item] })).toThrow('Invalid news feed response');
  expect(() => parseNewsFeed({ items: [item], updatedAt: 'invalid' })).toThrow('Invalid news feed response');
  expect(() => parseNewsFeed({ items: 'invalid', updatedAt })).toThrow('Invalid news feed response');
});
