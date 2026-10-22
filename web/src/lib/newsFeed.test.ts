import { expect, test } from 'bun:test';
import { formatPulseTime, parseNewsFeed } from './newsFeed';
import { formatPulseMarketChange, formatPulseMarketPrice } from '../../../src/domain/news';

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

const reference = (author: string, url = `https://x.com/${author}/status/1`) => ({ itemKey: `x:${author}`, source: 'x', title: `${author} headline\n\nbody`, author, publishedAt: '2026-10-19T17:06:33Z', url });
const bullet = (headline: string, sources: unknown[] = [reference('DeItaone')]) => ({ headline, summary: 'What happened.', marketImpact: 'Why it moves markets.', details: 'The evidence.', change: 'changed', confidence: 'reported', sources });
const pulse = {
  formatVersion: 2, id: 'pulse:2026-10-19T20:05:56.024Z', generatedAt: '2026-10-19T20:05:56.024Z', windowStart: '2026-10-19T13:35:30.396Z', windowEnd: '2026-10-19T20:05:56.024Z',
  headline: 'Tech rebound holds', overview: 'Stocks closed higher.', pulse: { label: 'mixed', summary: 'Oil keeps yields up.' },
  bullets: [bullet('One'), bullet('Two'), bullet('Three')], secondarySignals: ['Gold flat'], watchNext: ['CPI on Thursday'],
  noiseSummary: 'Ignored repeats.', analyzedItems: 180, sourceCounts: { x: 120, telegram: 40, digg: 15, paste: 5 }, model: 'claude-opus-5-5', reasoningEffort: 'xhigh',
};

test('reads the Claude pulse alongside the feed', () => {
  const summary = parseNewsFeed({ items: [item], executiveSummary: pulse, updatedAt }).executiveSummary;
  expect(summary?.headline).toBe('Tech rebound holds');
  expect(summary?.pulse).toEqual({ label: 'mixed', summary: 'Oil keeps yields up.' });
  expect(summary?.bullets.map(bullet => bullet.headline)).toEqual(['One', 'Two', 'Three']);
  expect(summary?.bullets[0].sources[0]).toEqual(reference('DeItaone'));
  expect(summary?.watchNext).toEqual(['CPI on Thursday']);
  expect(summary?.analyzedItems).toBe(180);
});

test('reads the short version 3 pulse without the version 2 fields', () => {
  const { marketImpact: _, ...short } = bullet('Short');
  const summary = parseNewsFeed({ items: [], updatedAt, executiveSummary: {
    ...pulse, formatVersion: 3, pulse: { label: 'risk-off' }, bullets: [short, short, short],
  } }).executiveSummary;
  expect(summary?.formatVersion).toBe(3);
  expect(summary?.pulse).toEqual({ label: 'risk-off' });
  expect(summary?.bullets).toHaveLength(3);
  expect(summary?.bullets[0]).not.toHaveProperty('marketImpact');
});

test('reads the version 4 price strip, feed sentiment and asset tags', () => {
  const markets = [
    { key: 'BTC', label: 'BTC', price: 81900, change: -3.2, unit: 'pct' },
    { key: 'US10Y', label: 'US 10Y', price: 4.97, change: -16.3, unit: 'bp' },
    { key: 'BAD', label: 'Bad', price: -1, change: 0, unit: 'pct' },
  ];
  const tagged = { ...bullet('Tagged'), assets: [{ asset: 'Nasdaq', direction: 'down' }, { asset: 'Nasdaq', direction: 'up' }, { asset: 'Dogecoin', direction: 'up' }] };
  const summary = parseNewsFeed({ items: [], updatedAt, executiveSummary: {
    ...pulse, formatVersion: 4, pulse: { label: 'risk-off' }, feedSentiment: 'Traders are fading the bounce.',
    markets, marketsAt: '2026-10-22T20:05:00Z', bullets: [tagged, bullet('Two'), bullet('Three')],
  } }).executiveSummary;
  expect(summary?.markets?.map(market => market.key)).toEqual(['BTC', 'US10Y']);
  expect(summary?.feedSentiment).toBe('Traders are fading the bounce.');
  expect(summary?.bullets[0].assets).toEqual([{ asset: 'Nasdaq', direction: 'down' }]);
  expect(summary?.bullets[1]).not.toHaveProperty('assets');
  expect(parseNewsFeed({ items: [], updatedAt, executiveSummary: { ...pulse, markets } }).executiveSummary).not.toHaveProperty('markets');
});

test('formats strip prices and moves', () => {
  expect(formatPulseMarketPrice({ key: 'BTC', label: 'BTC', price: 81907.5, change: -3.21, unit: 'pct' })).toBe('81,908');
  expect(formatPulseMarketPrice({ key: 'BRENT', label: 'Brent', price: 108.891, change: 2.7, unit: 'pct' })).toBe('108.89');
  expect(formatPulseMarketChange({ key: 'BTC', label: 'BTC', price: 1, change: -3.21, unit: 'pct' })).toBe('−3.2%');
  expect(formatPulseMarketPrice({ key: 'US10Y', label: 'US 10Y', price: 4.9668, change: -16.3, unit: 'bp' })).toBe('4.97%');
  expect(formatPulseMarketChange({ key: 'US10Y', label: 'US 10Y', price: 4.97, change: 16.3, unit: 'bp' })).toBe('+16bp');
});

test('keeps the feed when the pulse is missing, malformed or unusable', () => {
  for (const executiveSummary of [undefined, null, 'pulse', [], { ...pulse, pulse: { label: 'euphoric', summary: 'x' } }, { ...pulse, generatedAt: 'invalid' }, { ...pulse, bullets: [bullet('No sources', [])] }]) {
    const feed = parseNewsFeed({ items: [item], executiveSummary, updatedAt });
    expect(feed.items).toHaveLength(1);
    expect(feed.executiveSummary).toBeUndefined();
  }
});

test('trims the pulse to safe links and its editorial limits', () => {
  const sources = [reference('DeItaone'), reference('DeItaone', 'https://x.com/DeItaone/status/2'), reference('Unsafe', 'javascript:alert(1)'), ...['a', 'b', 'c', 'd'].map(author => reference(author))];
  const summary = parseNewsFeed({ items: [], updatedAt, executiveSummary: {
    ...pulse, bullets: [bullet('One', sources), bullet('Two'), bullet('Three'), bullet('Four')],
    secondarySignals: ['1', '2', '3', '4'], watchNext: ['1', '2', '3'],
  } }).executiveSummary;
  expect(summary?.bullets).toHaveLength(3);
  expect(summary?.bullets[0].sources.map(source => source.author)).toEqual(['DeItaone', 'a', 'b', 'c']);
  expect(summary?.secondarySignals).toHaveLength(3);
  expect(summary?.watchNext).toHaveLength(2);
});

test('accepts an older pulse shape with defaults', () => {
  const { marketImpact: _, ...legacy } = bullet('Legacy');
  const summary = parseNewsFeed({ items: [], updatedAt, executiveSummary: {
    ...pulse, formatVersion: undefined, sourceCounts: undefined, analyzedItems: undefined, secondarySignals: undefined,
    bullets: [{ ...legacy, whyItMatters: 'Older field name.', change: 'unknown', confidence: undefined }],
  } }).executiveSummary;
  expect(summary?.formatVersion).toBe(1);
  expect(summary?.bullets[0]).toMatchObject({ marketImpact: 'Older field name.', change: 'unchanged', confidence: 'reported' });
  expect(summary?.sourceCounts).toEqual({ x: 0, telegram: 0, digg: 0, paste: 0 });
  expect(summary?.secondarySignals).toEqual([]);
});

test('shows pulse times on the London clock, with the date once it is not today', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  expect(formatPulseTime('2026-10-20T13:35:00Z', now)).toBe('14:35');
  expect(formatPulseTime('2026-10-19T23:30:00Z', now)).toBe('00:30');
  expect(formatPulseTime('2026-10-19T20:05:56.024Z', now)).toBe('Mon 19 Oct, 21:05');
  expect(formatPulseTime('2026-12-01T09:00:00Z', Date.parse('2026-12-03T10:00:00Z'))).toBe('Tue 1 Dec, 09:00');
});
