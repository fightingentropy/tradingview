import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import {
  EXECUTIVE_SUMMARY_KEY,
  NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION,
  executiveSummaryScheduleSlot,
  generateExecutiveSummary,
  hydrateExecutiveSummary,
  pulseInstanceId,
  scheduleExecutiveSummary,
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
  pulse: { label: 'event-driven' },
  bullets: Array.from({ length: 3 }, (_, index) => ({
    headline: `The verified update leads ${index + 1}`,
    summary: 'One primary-source item holds the only new information, which can shift near-term expectations.',
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
  assert.equal(result.bullets[0].summary, claudeSummary.bullets[0].summary);
  assert.equal(result.bullets[0].marketImpact, undefined);
  assert.equal(result.pulse.summary, undefined);
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
  assert.equal(hydrateExecutiveSummary(wordy, items, { now }).headline, 'one two three four five six seven eight nine…');
});

test('keeps the short format to its word limits', () => {
  // The 19 Oct 2026 close overview ran to 44 words; the take now stops at 25.
  const overview = 'US stocks closed higher, Nasdaq up 1.1%, while WTI rose 1.5% after Houthis claimed strikes on Saudi oil sites and Paris imposed a curfew. Brent above $110 keeps pressure on yields, testing a tech bounce that follows hedge funds\' fastest technology selling in months.';
  assert.equal(hydrateExecutiveSummary({ ...claudeSummary, overview }, items, { now }).overview.split(' ').length, 25);
  const watchNext = ['one two three four five six seven eight nine ten eleven twelve'];
  assert.deepEqual(hydrateExecutiveSummary({ ...claudeSummary, watchNext }, items, { now }).watchNext, ['one two three four five six seven eight nine ten…']);
});

test('cuts an over-long field at a word boundary, never mid-word', () => {
  const words = Array.from({ length: 24 }, (_, index) => `word${index}`.padEnd(10, 'x'));
  const result = hydrateExecutiveSummary({ ...claudeSummary, overview: words.join(' ') }, items, { now });
  assert.ok(result.overview.endsWith('…') && result.overview.length <= 200, result.overview);
  for (const word of result.overview.slice(0, -1).split(' ')) assert.ok(words.includes(word), word);
  const unbroken = { ...claudeSummary, headline: 'y'.repeat(100) };
  assert.equal(hydrateExecutiveSummary(unbroken, items, { now }).headline, `${'y'.repeat(79)}…`);
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

function fakeWorkflow(statuses = new Map<string, string>()) {
  const created: { id: string }[] = [];
  return {
    created,
    statuses,
    async get(id: string) {
      if (!statuses.has(id)) throw new Error('instance.not_found');
      return { status: async () => ({ status: statuses.get(id) }) };
    },
    async create(options: { id: string }) { created.push(options); statuses.set(options.id, 'running'); return {}; },
  } as unknown as Workflow<never> & { created: { id: string }[]; statuses: Map<string, string> };
}

test('the cron starts one Workflow per slot, only when a pulse is due and the feed is fresh', async () => {
  const openSlot = Date.parse('2026-07-13T13:40:00.000Z');
  const feed = { items, updatedAt: new Date(openSlot - 60_000).toISOString() };
  const loadFeed = async () => feed;
  const env = (initial?: Record<string, unknown>, workflow = fakeWorkflow()) => ({
    NEWS_RELAY_KV: memoryKV(initial),
    NEWS_PULSE_WORKFLOW: workflow,
  });
  const due = { [EXECUTIVE_SUMMARY_KEY]: { formatVersion: NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION, generatedAt: '2026-07-10T20:05:00.000Z' } };
  const freshFeed = async () => ({ ...feed, items: items.map((item) => ({ ...item, publishedAt: '2026-07-13T13:00:00.000Z' })) });

  assert.equal(await scheduleExecutiveSummary(env(), loadFeed, Date.parse('2026-07-11T15:00:00.000Z')), 'outside-schedule');
  assert.equal(await scheduleExecutiveSummary(env({
    [EXECUTIVE_SUMMARY_KEY]: { formatVersion: NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION, generatedAt: '2026-07-13T13:35:05.000Z' },
  }), loadFeed, openSlot), 'already-generated');
  // The legacy Mac mini pulse in the feed counts until the first cloud pulse.
  assert.equal(await scheduleExecutiveSummary(env(), async () => ({
    ...feed,
    executiveSummary: { formatVersion: NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION, generatedAt: '2026-07-13T13:35:05.000Z' } as never,
  }), openSlot), 'already-generated');
  assert.equal(await scheduleExecutiveSummary(env(due), async () => ({ ...feed, updatedAt: '2026-07-13T09:00:00.000Z' }), openSlot), 'feed-stale');

  const workflow = fakeWorkflow();
  assert.equal(await scheduleExecutiveSummary(env(due, workflow), freshFeed, openSlot), 'started');
  assert.deepEqual(workflow.created, [{ id: 'news-pulse-2026-07-13-open', params: { slot: '2026-07-13:open', scheduledAt: openSlot } }]);
  assert.equal(await scheduleExecutiveSummary(env(due, workflow), freshFeed, openSlot + 5 * 60_000), 'already-started');
  assert.equal(pulseInstanceId('2026-07-13:close'), 'news-pulse-2026-07-13-close');

  // An errored run (20 Oct 2026: Claude returned 403 on all three attempts) must not hold the slot.
  workflow.statuses.set('news-pulse-2026-07-13-open', 'errored');
  assert.equal(await scheduleExecutiveSummary(env(due, workflow), freshFeed, openSlot + 15 * 60_000), 'retried');
  assert.equal(await scheduleExecutiveSummary(env(due, workflow), freshFeed, openSlot + 20 * 60_000), 'already-started');
  workflow.statuses.set('news-pulse-2026-07-13-open-2', 'errored');
  assert.equal(await scheduleExecutiveSummary(env(due, workflow), freshFeed, openSlot + 30 * 60_000), 'retried');
  workflow.statuses.set('news-pulse-2026-07-13-open-3', 'errored');
  assert.equal(await scheduleExecutiveSummary(env(due, workflow), freshFeed, openSlot + 45 * 60_000), 'slot-failed');
  assert.deepEqual(workflow.created.map(({ id }) => id), [
    'news-pulse-2026-07-13-open',
    'news-pulse-2026-07-13-open-2',
    'news-pulse-2026-07-13-open-3',
  ]);
});

function fakeClaude(responses: Array<Record<string, unknown>>) {
  const requests: Array<Record<string, unknown>> = [];
  const client = { beta: { messages: { stream(request: Record<string, unknown>) {
    requests.push(request);
    const next = responses.shift();
    if (!next) throw new Error('No more fake responses');
    return { finalMessage: async () => ({
      model: 'claude-opus-5-5',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      ...next,
    }) };
  } } } };
  return { client: client as unknown as Anthropic, requests };
}

const submitPulse = (id: string, input: unknown) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'submit_pulse', input }] });

test('generation offers web lookups and accepts a pulse submitted through the tool', async () => {
  const { client, requests } = fakeClaude([submitPulse('call-1', claudeSummary)]);
  const summary = await generateExecutiveSummary({ apiKey: undefined, items, previousSummary: undefined, now, client });
  assert.equal(summary.bullets.length, 3);
  const tools = (requests[0]!.tools as Array<{ type?: string; name: string; max_uses?: number }>);
  assert.deepEqual(tools.map(({ name }) => name), ['web_search', 'web_fetch', 'submit_pulse']);
  assert.equal(tools[0]!.max_uses, 5);
});

test('an unsourced pulse is returned once for correction, then fails', async () => {
  const unsourced = { ...claudeSummary, bullets: claudeSummary.bullets.map((bullet) => ({ ...bullet, sourceKeys: ['x:missing'] })) };
  const repaired = fakeClaude([submitPulse('call-1', unsourced), submitPulse('call-2', claudeSummary)]);
  await generateExecutiveSummary({ apiKey: undefined, items, previousSummary: undefined, now, client: repaired.client });
  const followUp = repaired.requests[1]!.messages as Array<{ role: string; content: unknown }>;
  const [result] = followUp.at(-1)!.content as Array<{ tool_use_id: string; is_error: boolean; content: string }>;
  assert.equal(result!.tool_use_id, 'call-1');
  assert.equal(result!.is_error, true);

  const failing = fakeClaude([submitPulse('call-1', unsourced), submitPulse('call-2', unsourced)]);
  await assert.rejects(
    generateExecutiveSummary({ apiKey: undefined, items, previousSummary: undefined, now, client: failing.client }),
    /The pulse failed validation/,
  );
  const silent = fakeClaude([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'No pulse today.' }] }]);
  await assert.rejects(
    generateExecutiveSummary({ apiKey: undefined, items, previousSummary: undefined, now, client: silent.client }),
    /ended without submitting a pulse: No pulse today/,
  );
});
