import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';

import {
  loadPublicationContext,
  publishDailyBrief,
  relayEvidence,
  researchDailyBrief,
  scheduleDailyBrief,
  stampGenerated,
  type DailyBriefEnv,
} from './daily-brief';

const markdown = readFileSync(new URL('../web/src/data/briefs/2026-09-16.md', import.meta.url), 'utf8');
const title = 'The Fed restarts tightening; breadth weakens.';
// 22:30 in London on the edition's day.
const submittedAt = new Date('2026-09-16T21:30:00Z');
const priorIndex = { version: 1, publishedAt: '2026-09-07T07:40:00Z', editions: [{ id: '2026-09-07', title: 'Prior', generated: '2026-09-07 08:30' }] };

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

function fakeClaude(responses: Array<Record<string, unknown>>) {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        stream(request: Record<string, unknown>) {
          requests.push(request);
          const next = responses.shift();
          if (!next) throw new Error('No more fake responses');
          return {
            finalMessage: async () => ({
              model: 'claude-opus-5-5',
              usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              ...next,
            }),
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

const submit = (id: string, input: Record<string, unknown>) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name: 'submit_brief', input }],
});

test('stamps the exact London submission time', () => {
  const stamped = stampGenerated(markdown, submittedAt);
  assert.match(stamped, /^Generated: 2026-09-16 22:30 \(Europe\/London\)$/m);
  assert.doesNotMatch(stamped, /21:59/);
});

test('summarizes fresh relay items and flags a stale or missing relay', () => {
  const now = new Date('2026-09-16T08:00:00Z');
  const item = (id: string, source: 'x' | 'telegram', hoursAgo: number) => ({
    id, source, text: `Item ${id}`, author: { name: 'Desk', handle: 'desk' },
    publishedAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(), url: `https://x.com/desk/status/${id}`,
  });
  const fresh = relayEvidence({ items: [item('1', 'x', 1), item('2', 'telegram', 2), item('3', 'x', 80)], updatedAt: '2026-09-16T07:55:00Z' }, now);
  assert.match(fresh, /x: 1, telegram: 1, digg: 0, paste: 0/);
  assert.match(fresh, /Desk \(@desk\)/);
  assert.doesNotMatch(fresh, /Item 3/);
  assert.match(relayEvidence({ items: [], updatedAt: '2026-09-15T20:00:00Z' }, now), /stale/);
  assert.match(relayEvidence(null, now), /unavailable/);
});

test('returns a failed submission to Claude, then accepts the corrected brief', async () => {
  const { client, requests } = fakeClaude([
    submit('call-1', { title, markdown: markdown.replace('Regime Assessment', 'Missing section') }),
    submit('call-2', { title, markdown }),
  ]);
  const edition = await researchDailyBrief({
    apiKey: undefined, contract: 'contract', day: '2026-09-16', previousEdition: 'prior', feed: null, client, now: () => submittedAt,
  });
  assert.equal(edition.title, title);
  assert.match(edition.markdown, /^Generated: 2026-09-16 22:30/);
  assert.equal(requests.length, 2);
  const followUp = requests[1]!.messages as Array<{ role: string; content: unknown }>;
  assert.deepEqual(followUp.map(({ role }) => role), ['user', 'assistant', 'user']);
  const [result] = followUp[2]!.content as Array<{ type: string; tool_use_id: string; is_error: boolean; content: string }>;
  assert.equal(result!.tool_use_id, 'call-1');
  assert.equal(result!.is_error, true);
  assert.match(result!.content, /eight BRIEF\.md sections/);
});

test('resumes paused server-tool turns and fails when no brief is submitted', async () => {
  const paused = fakeClaude([
    { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'Searching' }] },
    submit('call-1', { title, markdown }),
  ]);
  await researchDailyBrief({ apiKey: undefined, contract: 'c', day: '2026-09-16', previousEdition: undefined, feed: null, client: paused.client, now: () => submittedAt });
  assert.equal(paused.requests.length, 2);

  const declined = fakeClaude([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Primary sources are unavailable.' }] }]);
  await assert.rejects(
    researchDailyBrief({ apiKey: undefined, contract: 'c', day: '2026-09-16', previousEdition: undefined, feed: null, client: declined.client, now: () => submittedAt }),
    /Research ended without a brief: Primary sources are unavailable/,
  );
});

test('publishes once and refuses to overwrite a different edition', async () => {
  const kv = memoryKV({ 'index:v1': priorIndex });
  const edition = { title, markdown };
  assert.equal(await publishDailyBrief(kv, edition, submittedAt), '2026-09-16');
  assert.equal(JSON.parse(kv.values.get('index:v1')!).editions[0].id, '2026-09-16');
  assert.equal(JSON.parse(kv.values.get('edition:v1:2026-09-16')!).title, title);
  // A publication retry with identical content is safe.
  assert.equal(await publishDailyBrief(kv, edition, submittedAt), '2026-09-16');
  await assert.rejects(publishDailyBrief(kv, { title: 'Another headline', markdown }, submittedAt), /Refusing to overwrite/);
});

test('loads the prior edition unless the day is already published', async () => {
  const prior = { title: 'Prior', markdown: markdown.replace('2026-09-16 21:59', '2026-09-07 08:30') };
  const kv = memoryKV({ 'index:v1': priorIndex, 'edition:v1:2026-09-07': prior });
  const context = await loadPublicationContext(kv, '2026-09-16');
  assert.equal(context.published, false);
  assert.match(context.previousEdition!, /2026-09-07 08:30/);
  assert.deepEqual(await loadPublicationContext(kv, '2026-09-07'), { published: true });
});

test('starts at most one Workflow per London day from 08:00', async () => {
  const created: unknown[] = [];
  let existing = false;
  const env = {
    DAILY_BRIEFS: memoryKV({ 'index:v1': priorIndex }),
    DAILY_BRIEF_WORKFLOW: {
      async get() { if (!existing) throw new Error('instance.not_found'); return {}; },
      async create(options: unknown) { created.push(options); existing = true; return {}; },
    },
  } as unknown as DailyBriefEnv;
  assert.equal(await scheduleDailyBrief(env, new Date('2026-09-16T06:00:00Z')), 'before-schedule');
  assert.equal(await scheduleDailyBrief(env, new Date('2026-09-16T07:00:00Z')), 'started');
  assert.deepEqual(created, [{ id: 'daily-brief-2026-09-16', params: { day: '2026-09-16' } }]);
  assert.equal(await scheduleDailyBrief(env, new Date('2026-09-16T08:00:00Z')), 'already-started');
  assert.equal(await scheduleDailyBrief(env, new Date('2026-09-07T09:00:00Z')), 'already-published');
  // In GMT, 07:00 UTC is still before 08:00 London.
  assert.equal(await scheduleDailyBrief(env, new Date('2026-12-07T07:00:00Z')), 'before-schedule');
});
