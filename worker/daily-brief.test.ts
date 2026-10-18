import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';

import {
  briefRelayItemAllowed,
  hyperliquidMarksEvidence,
  loadPublicationContext,
  publishDailyBrief,
  relayEvidence,
  handleDailyBriefRunRequest,
  researchDailyBrief,
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

test('applies the BRIEF.md feed rules before items reach Claude', () => {
  const base = { id: '1', text: 'Story', publishedAt: '2026-09-16T07:00:00Z', author: { name: 'Feed' } };
  assert.equal(briefRelayItemAllowed({ ...base, source: 'telegram', author: { name: 'Chain', handle: 'chain_alerts' } }), false);
  assert.equal(briefRelayItemAllowed({ ...base, source: 'telegram', author: { name: 'TradFi', handle: 'tradfi_t3' } }), true);
  for (const section of ['ai', 'tech', 'world-business']) {
    assert.equal(briefRelayItemAllowed({ ...base, source: 'digg', url: `https://digg.com/${section}/story` }), true);
  }
  assert.equal(briefRelayItemAllowed({ ...base, source: 'digg', url: 'https://digg.com/sports/story' }), false);
  assert.equal(briefRelayItemAllowed({ ...base, source: 'x', url: 'https://x.com/desk/status/1' }), true);
});

test('formats Hyperliquid marks with 24-hour changes and reports a missing feed', () => {
  const payload = [
    { universe: [{ name: 'BTC' }, { name: 'ETH' }, { name: 'HYPE' }] },
    [{ markPx: '80842.0', prevDayPx: '81605.0' }, { markPx: '2344.1', prevDayPx: '2419.5' }, { markPx: '76.371', prevDayPx: '79.227' }],
  ];
  const evidence = hyperliquidMarksEvidence(payload, new Date('2026-10-18T20:45:00Z'));
  assert.match(evidence, /^Hyperliquid perp marks at 2026-10-18T20:45:00.000Z: BTC mark 80842 \(-0\.93% over 24 hours\); ETH mark 2344\.1/);
  assert.match(evidence, /HYPE mark 76\.371 \(-3\.60% over 24 hours\)\.$/);
  assert.match(hyperliquidMarksEvidence(null, new Date()), /unavailable/);
});

test('returns a brief without confidence tags for correction', async () => {
  const untagged = markdown.replaceAll(/\s*\[(?:High|Med|Low)\]/g, '');
  const { client, requests } = fakeClaude([
    submit('call-1', { title, markdown: untagged }),
    submit('call-2', { title, markdown }),
  ]);
  await researchDailyBrief({ apiKey: undefined, contract: 'c', day: '2026-09-16', previousEdition: undefined, feed: null, client, now: () => submittedAt });
  const [result] = (requests[1]!.messages as Array<{ content: unknown }>)[2]!.content as Array<{ content: string }>;
  assert.match(result!.content, /\[High\], \[Med\] or \[Low\]/);
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

test('an on-demand run replaces the day\'s edition and loads it for comparison', async () => {
  const kv = memoryKV({ 'index:v1': priorIndex });
  await publishDailyBrief(kv, { title, markdown }, submittedAt);
  await assert.rejects(publishDailyBrief(kv, { title: 'Evening headline', markdown }, submittedAt), /Refusing to overwrite/);
  assert.equal(await publishDailyBrief(kv, { title: 'Evening headline', markdown }, submittedAt, { replace: true }), '2026-09-16');
  assert.equal(JSON.parse(kv.values.get('edition:v1:2026-09-16')!).title, 'Evening headline');
  assert.equal(JSON.parse(kv.values.get('index:v1')!).editions[0].title, 'Evening headline');
  const context = await loadPublicationContext(kv, '2026-09-16', { replace: true });
  assert.equal(context.published, false);
  assert.match(context.previousEdition!, /PM Bottom Line/);
});

test('runs start only with the access token, one at a time, and report their status', async () => {
  const instances = new Map<string, { status: string }>();
  const env = {
    APP_ACCESS_TOKEN: 'test-token',
    DAILY_BRIEFS: memoryKV(),
    DAILY_BRIEF_WORKFLOW: {
      async get(id: string) {
        const instance = instances.get(id);
        if (!instance) throw new Error('instance.not_found');
        return { status: async () => ({ status: instance.status, output: { title: 'Fresh brief' } }) };
      },
      async create({ id, params }: { id: string; params: { replace: boolean } }) {
        assert.equal(params.replace, true);
        instances.set(id, { status: 'running' });
        return {};
      },
    },
  } as unknown as DailyBriefEnv;
  const call = (method: string, token?: string) => handleDailyBriefRunRequest(new Request('https://trade.erlin.org/api/daily-briefs/run', {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {},
  }), env);

  assert.deepEqual(await (await call('GET')).json(), { status: 'idle' });
  assert.equal((await call('POST')).status, 401);
  assert.equal((await call('POST', 'wrong-token')).status, 401);
  const started = await call('POST', 'test-token');
  assert.equal(started.status, 202);
  const run = await started.json() as { id: string; status: string };
  assert.match(run.id, /^daily-brief-\d{4}-\d{2}-\d{2}-\d{6}$/);
  assert.equal((await call('POST', 'test-token')).status, 409);
  instances.get(run.id)!.status = 'complete';
  const status = await (await call('GET')).json() as { status: string; title: string };
  assert.equal(status.status, 'complete');
  assert.equal(status.title, 'Fresh brief');
  assert.equal((await call('POST', 'test-token')).status, 202);
  assert.equal((await call('DELETE', 'test-token')).status, 405);
});
