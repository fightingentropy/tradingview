import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NEWS_EXECUTIVE_SUMMARY_INTERVAL_MS,
  hydrateCodexSummary,
  shouldGenerateExecutiveSummary,
} from './news-executive-summary.mjs';

const now = Date.parse('2026-07-12T20:00:00.000Z');
const items = [{
  id: '123',
  source: 'x',
  author: { name: 'Primary source' },
  text: 'A material market update with supporting context.',
  publishedAt: '2026-07-12T19:30:00.000Z',
  url: 'https://x.com/source/status/123',
}];

const codexSummary = {
  headline: 'Markets digest a material update',
  overview: 'The latest verified development is the dominant signal in an otherwise noisy hour.',
  pulse: { label: 'event-driven', summary: 'Price discovery is centered on one new catalyst.' },
  bullets: Array.from({ length: 3 }, (_, index) => ({
    headline: `The verified update leads ${index + 1}`,
    summary: 'One primary-source item contains the only material new information.',
    whyItMatters: 'It can change near-term expectations while reposts add no evidence.',
    details: 'The primary source published the update during the current window.',
    sourceKeys: ['x:123', 'x:missing'],
  })),
  watchNext: ['Watch for direct confirmation and market follow-through.'],
  noiseSummary: 'Duplicate reactions and unsupported takes were excluded.',
};

test('hydrates only valid source references and records the xhigh Codex run', () => {
  const result = hydrateCodexSummary(codexSummary, items, { now });
  assert.equal(result.bullets[0].sources.length, 1);
  assert.equal(result.bullets[0].sources[0].itemKey, 'x:123');
  assert.equal(result.model, 'gpt-5.6-sol');
  assert.equal(result.reasoningEffort, 'xhigh');
  assert.deepEqual(result.sourceCounts, { x: 1, telegram: 0, digg: 0, paste: 0 });
});

test('runs immediately without a pulse, then once per hour', () => {
  assert.equal(shouldGenerateExecutiveSummary(undefined, now), true);
  const summary = { generatedAt: new Date(now).toISOString() };
  assert.equal(shouldGenerateExecutiveSummary(summary, now + NEWS_EXECUTIVE_SUMMARY_INTERVAL_MS - 1), false);
  assert.equal(shouldGenerateExecutiveSummary(summary, now + NEWS_EXECUTIVE_SUMMARY_INTERVAL_MS), true);
});
