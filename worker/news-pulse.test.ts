import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXECUTIVE_SUMMARY_ATTEMPT_KEY,
  EXECUTIVE_SUMMARY_KEY,
  NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION,
  executiveSummaryScheduleSlot,
  hydrateExecutiveSummary,
  runScheduledExecutiveSummary,
  selectExecutiveSummaryItems,
  shouldGenerateExecutiveSummary,
  type NewsItem,
} from './news-pulse';

const now = Date.parse('2026-07-12T20:00:00.000Z');
const items: NewsItem[] = [
  {
    id: '123',
    source: 'x',
    author: { name: 'Primary source' },
    text: 'A material market update with supporting context.',
    publishedAt: '2026-07-12T19:30:00.000Z',
    url: 'https://x.com/source/status/123',
  },
  {
    id: '124',
    source: 'x',
    author: { name: 'Primary Source' },
    text: 'A follow-up from the same publisher.',
    publishedAt: '2026-07-12T19:31:00.000Z',
    url: 'https://x.com/source/status/124',
  },
];

const claudeSummary = {
  headline: 'Markets digest a material update',
  overview: 'The latest verified development is the dominant signal in an otherwise noisy hour.',
  pulse: { label: 'event-driven', summary: 'Price discovery is centered on one new catalyst.' },
  bullets: Array.from({ length: 3 }, (_, index) => ({
    headline: `The verified update leads ${index + 1}`,
    summary: 'One primary-source item contains the only material new information.',
    marketImpact: 'It can change near-term expectations while reposts add no evidence.',
    details: 'The primary source published the update during the current window.',
    change: 'new',
    confidence: 'confirmed',
    sourceKeys: ['x:123', 'x:124', 'x:missing'],
  })),
  secondarySignals: ['A lower-priority development remains unconfirmed.'],
  watchNext: ['Watch for direct confirmation and market follow-through.'],
  noiseSummary: 'Duplicate reactions and unsupported takes were excluded.',
};

function memoryKV(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    values,
    async get(key: string) {
      const value = values.get(key);
      return value === undefined ? null : JSON.parse(value);
    },
    async put(key: string, value: string) { values.set(key, value); },
  } as unknown as KVNamespace & { values: Map<string, string> };
}

test('hydrates only valid, publisher-distinct source references', () => {
  const result = hydrateExecutiveSummary(claudeSummary, items, { now, model: 'claude-opus-5-5' });
  assert.equal(result.bullets[0].sources.length, 1);
  assert.equal(result.bullets[0].sources[0].itemKey, 'x:123');
  assert.equal(result.model, 'claude-opus-5-5');
  assert.equal(result.reasoningEffort, 'xhigh');
  assert.equal(result.formatVersion, NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION);
  assert.equal(result.bullets.length, 3);
  assert.equal(result.bullets[0].marketImpact, claudeSummary.bullets[0].marketImpact);
  assert.deepEqual(result.sourceCounts, { x: 2, telegram: 0, digg: 0, paste: 0 });
});

test('rejects a summary without three sourced bullets', () => {
  const unsourced = {
    ...claudeSummary,
    bullets: claudeSummary.bullets.map((bullet, index) => index === 0 ? { ...bullet, sourceKeys: ['x:missing'] } : bullet),
  };
  assert.throws(() => hydrateExecutiveSummary(unsourced, items, { now }), /did not pass validation/);
});

test('enforces editorial word limits after generation', () => {
  const wordy = { ...claudeSummary, headline: 'one two three four five six seven eight nine ten eleven' };
  assert.equal(hydrateExecutiveSummary(wordy, items, { now }).headline, 'one two three four five six seven eight nine');
});

test('runs after the New York open and close on weekdays', () => {
  const beforeOpen = Date.parse('2026-07-13T13:34:59.000Z');
  const afterOpen = Date.parse('2026-07-13T13:35:00.000Z');
  const beforeClose = Date.parse('2026-07-13T20:04:59.000Z');
  const afterClose = Date.parse('2026-07-13T20:05:00.000Z');

  assert.equal(executiveSummaryScheduleSlot(beforeOpen), undefined);
  assert.equal(executiveSummaryScheduleSlot(afterOpen), '2026-07-13:open');
  assert.equal(executiveSummaryScheduleSlot(beforeClose), '2026-07-13:open');
  assert.equal(executiveSummaryScheduleSlot(afterClose), '2026-07-13:close');
  assert.equal(shouldGenerateExecutiveSummary(undefined, beforeOpen), false);
  assert.equal(shouldGenerateExecutiveSummary(undefined, afterOpen), true);

  const summary = {
    formatVersion: NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION,
    generatedAt: new Date(afterOpen).toISOString(),
  };
  assert.equal(shouldGenerateExecutiveSummary(summary, beforeClose), false);
  assert.equal(shouldGenerateExecutiveSummary(summary, afterClose), true);
  assert.equal(shouldGenerateExecutiveSummary({ ...summary, formatVersion: 1 }, beforeClose), true);
});

test('skips weekends and follows New York daylight-saving time', () => {
  const fridayCloseSummary = {
    formatVersion: NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION,
    generatedAt: '2026-07-10T20:05:00.000Z',
  };
  assert.equal(shouldGenerateExecutiveSummary(undefined, Date.parse('2026-07-11T15:00:00.000Z')), false);
  assert.equal(shouldGenerateExecutiveSummary(fridayCloseSummary, Date.parse('2026-07-13T13:34:59.000Z')), false);
  assert.equal(shouldGenerateExecutiveSummary(fridayCloseSummary, Date.parse('2026-07-13T13:35:00.000Z')), true);
  assert.equal(executiveSummaryScheduleSlot('2026-01-05T14:35:00.000Z'), '2026-01-05:open');
  assert.equal(executiveSummaryScheduleSlot('2026-01-05T21:05:00.000Z'), '2026-01-05:close');
  assert.equal(executiveSummaryScheduleSlot('2026-12-14T14:35:00.000Z'), '2026-12-14:open');
});

test('keeps overnight and weekend context for the next scheduled pulse', () => {
  const mondayOpen = Date.parse('2026-07-13T13:35:00.000Z');
  const sourceItem = (id: string, publishedAt: string): NewsItem => ({
    id,
    source: 'x',
    author: { name: 'Source' },
    text: `Update ${id}`,
    publishedAt,
    url: `https://x.com/source/status/${id}`,
  });
  const selected = selectExecutiveSummaryItems([
    sourceItem('inside', new Date(mondayOpen - 71 * 60 * 60_000).toISOString()),
    sourceItem('outside', new Date(mondayOpen - 73 * 60 * 60_000).toISOString()),
  ], mondayOpen);
  assert.deepEqual(selected.map(({ id }) => id), ['inside']);
});

test('the cron skips generation it does not need, without calling Claude', async () => {
  const openSlot = Date.parse('2026-07-13T13:40:00.000Z');
  const feed = { items, updatedAt: new Date(openSlot - 60_000).toISOString() };
  const loadFeed = async () => feed;
  const env = (initial?: Record<string, unknown>) => ({ NEWS_RELAY_KV: memoryKV(initial) });

  assert.equal(await runScheduledExecutiveSummary(env(), loadFeed, Date.parse('2026-07-11T15:00:00.000Z')), 'outside-schedule');
  assert.equal(await runScheduledExecutiveSummary(env({
    [EXECUTIVE_SUMMARY_KEY]: { formatVersion: NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION, generatedAt: '2026-07-13T13:35:05.000Z' },
  }), loadFeed, openSlot), 'already-generated');
  // The legacy Mac mini pulse in the feed counts until the first cloud pulse.
  assert.equal(await runScheduledExecutiveSummary(env(), async () => ({
    ...feed,
    executiveSummary: { formatVersion: NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION, generatedAt: '2026-07-13T13:35:05.000Z' } as never,
  }), openSlot), 'already-generated');
  assert.equal(await runScheduledExecutiveSummary(env({
    [EXECUTIVE_SUMMARY_ATTEMPT_KEY]: { slot: '2026-07-13:open', attempts: 1, startedAt: '2026-07-13T13:35:00.000Z', state: 'failed' },
  }), loadFeed, openSlot), 'cooling-down');
  assert.equal(await runScheduledExecutiveSummary(env({
    [EXECUTIVE_SUMMARY_ATTEMPT_KEY]: { slot: '2026-07-13:open', attempts: 3, startedAt: '2026-07-13T12:00:00.000Z', state: 'failed' },
  }), loadFeed, openSlot), 'attempts-exhausted');
  assert.equal(await runScheduledExecutiveSummary(env(), async () => ({
    ...feed,
    updatedAt: '2026-07-13T09:00:00.000Z',
  }), openSlot), 'feed-stale');
});

test('a failed generation records the attempt for the cooldown', async () => {
  const openSlot = Date.parse('2026-07-13T13:40:00.000Z');
  const kv = memoryKV();
  const feed = { items: items.map((item) => ({ ...item, publishedAt: '2026-07-13T13:00:00.000Z' })), updatedAt: '2026-07-13T13:39:00.000Z' };
  await assert.rejects(
    runScheduledExecutiveSummary({ NEWS_RELAY_KV: kv }, async () => feed, openSlot),
    /ANTHROPIC_API_KEY is not configured/,
  );
  const attempt = JSON.parse(kv.values.get(EXECUTIVE_SUMMARY_ATTEMPT_KEY)!);
  assert.equal(attempt.slot, '2026-07-13:open');
  assert.equal(attempt.attempts, 1);
  assert.equal(attempt.state, 'failed');
});
