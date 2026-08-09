import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION,
  NEWS_EXECUTIVE_SUMMARY_SCHEDULE,
  NEWS_EXECUTIVE_SUMMARY_TIME_ZONE,
  NewsExecutiveSummaryService,
  executiveSummaryScheduleSlot,
  hydrateCodexSummary,
  selectExecutiveSummaryItems,
  shouldGenerateExecutiveSummary,
} from './news-executive-summary.mjs';

const now = Date.parse('2026-07-12T20:00:00.000Z');
const items = [
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

const codexSummary = {
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

test('hydrates only valid source references and records the xhigh Codex run', () => {
  const result = hydrateCodexSummary(codexSummary, items, { now });
  assert.equal(result.bullets[0].sources.length, 1);
  assert.equal(result.bullets[0].sources[0].itemKey, 'x:123');
  assert.equal(result.model, 'gpt-5.6-sol');
  assert.equal(result.reasoningEffort, 'xhigh');
  assert.equal(result.formatVersion, NEWS_EXECUTIVE_SUMMARY_FORMAT_VERSION);
  assert.equal(result.bullets.length, 3);
  assert.equal(result.bullets[0].marketImpact, codexSummary.bullets[0].marketImpact);
  assert.deepEqual(result.sourceCounts, { x: 2, telegram: 0, digg: 0, paste: 0 });
});

test('runs after the New York open and close on weekdays', () => {
  assert.equal(NEWS_EXECUTIVE_SUMMARY_TIME_ZONE, 'America/New_York');
  assert.deepEqual(NEWS_EXECUTIVE_SUMMARY_SCHEDULE, [
    { id: 'open', hour: 9, minute: 35 },
    { id: 'close', hour: 16, minute: 5 },
  ]);

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
  assert.equal(shouldGenerateExecutiveSummary(fridayCloseSummary, Date.parse('2026-07-12T20:05:00.000Z')), false);
  assert.equal(shouldGenerateExecutiveSummary(fridayCloseSummary, Date.parse('2026-07-13T13:34:59.000Z')), false);
  assert.equal(shouldGenerateExecutiveSummary(fridayCloseSummary, Date.parse('2026-07-13T13:35:00.000Z')), true);

  assert.equal(
    executiveSummaryScheduleSlot(Date.parse('2026-01-05T14:35:00.000Z')),
    '2026-01-05:open',
  );
  assert.equal(
    executiveSummaryScheduleSlot(Date.parse('2026-01-05T21:05:00.000Z')),
    '2026-01-05:close',
  );
});

test('keeps overnight and weekend context for the next scheduled pulse', () => {
  const mondayOpen = Date.parse('2026-07-13T13:35:00.000Z');
  const sourceItem = (id, publishedAt) => ({
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

test('does not repeat a persisted attempt after a service restart', async (context) => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), 'news-summary-schedule-'));
  context.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const scheduledAt = '2026-07-13T13:35:00.000Z';
  await writeFile(
    path.join(stateDirectory, 'executive-summary-attempt.json'),
    `${JSON.stringify({ slot: '2026-07-13:open', attemptedAt: scheduledAt })}\n`,
  );

  const service = new NewsExecutiveSummaryService({ stateDirectory });
  const result = await service.refresh(items, { now: Date.parse(scheduledAt) });
  assert.equal(result, undefined);
  assert.equal(service.getStatus().lastAttemptSlot, '2026-07-13:open');
});
