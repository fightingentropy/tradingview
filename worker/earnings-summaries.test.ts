import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { earningsSummaryKey, type EarningsReport } from '../src/domain/earningsCalendar';
import {
  MIN_SUMMARY_MARKET_CAP,
  fetchEarningsSources,
  reportsNeedingSummary,
  runEarningsSummaries,
  storyText,
  summaryDates,
  type EarningsSummaryDay,
} from './earnings-summaries';

const now = Date.parse('2026-10-22T22:00:00.000Z');
const figure = (actual: number | null, estimate: number | null, surprise: number | null) => ({ actual, estimate, surprise });
const report = (overrides: Partial<EarningsReport> = {}): EarningsReport => ({
  symbol: 'NYSE:PG', ticker: 'PG', name: 'Procter & Gamble', logo: null, exchange: 'NYSE',
  marketCap: 350e9, currency: 'USD', date: '2026-10-22', time: '2026-10-22T10:55:00.000Z', timing: 'before_open',
  reported: true, period: 'Q1 2027', eps: figure(2, 1.88, 6.2), revenue: figure(23.28e9, 22.8e9, 2.1),
  context: { kind: 'next', period: 'Q2 2027', eps: figure(null, 1.9, null), revenue: figure(null, 24e9, null) },
  ...overrides,
});
const stored = (entries: EarningsSummaryDay = {}) => new Map([['2026-10-22', entries]]);
const summary = (overrides: Partial<EarningsSummaryDay[string]> = {}) => ({
  bullets: ['One.', 'Two.', 'Three.'], generatedAt: '2026-10-22T21:00:00.000Z', checkedAt: '2026-10-22T21:00:00.000Z',
  sources: { report: true, call: true, wires: 1 }, model: 'claude-sonnet-5-5', ...overrides,
});

test('covers today in New York and the three trading days before it', () => {
  assert.deepEqual(summaryDates(Date.parse('2026-10-23T02:00:00.000Z')), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
});

test('summarises reported $10B+ companies first, then rechecks for the call write-up', () => {
  const small = report({ symbol: 'NYSE:SML', marketCap: MIN_SUMMARY_MARKET_CAP - 1 });
  const upcoming = report({ symbol: 'NYSE:UPC', reported: false });
  const done = report({ symbol: 'NYSE:DONE' });
  const waitingForCall = report({ symbol: 'NYSE:WAIT', marketCap: 900e9 });
  const fresh = report({ symbol: 'NYSE:NEW', marketCap: 20e9 });
  const failed = report({ symbol: 'NYSE:FAIL' });
  const due = reportsNeedingSummary([small, upcoming, done, waitingForCall, fresh, failed], stored({
    'NYSE:DONE': summary(),
    'NYSE:WAIT': summary({ sources: { report: true, call: false, wires: 0 } }),
    'NYSE:FAIL': summary({ bullets: [], failures: 3 }),
  }), now);
  assert.deepEqual(due.map((entry) => entry.symbol), ['NYSE:NEW', 'NYSE:WAIT']);
  const justChecked = reportsNeedingSummary([waitingForCall], stored({
    'NYSE:WAIT': summary({ sources: { report: true, call: false, wires: 0 }, checkedAt: new Date(now - 60_000).toISOString() }),
  }), now);
  assert.deepEqual(justChecked, []);
});

test('flattens a story and drops the AI disclaimer and footers', () => {
  const story = { astDescription: { type: 'root', children: [
    { type: 'p', children: ['Organic sales rose 4.0%.'] },
    { type: 'p', children: ['Based on '] },
    { type: 'p', children: ['This is an AI-generated summary and may contain inaccuracies.'] },
  ] } };
  assert.equal(storyText(story), 'Organic sales rose 4.0%.');
  assert.equal(storyText({ shortDescription: 'Short text.' }), 'Short text.');
});

function fakeFetch(headlines: unknown[], stories: Record<string, unknown> = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/headlines')) return Response.json({ items: headlines });
    const story = stories[url.searchParams.get('id') ?? ''];
    return story ? Response.json(story) : new Response('missing', { status: 404 });
  }) as typeof fetch;
}

test('picks the Quartr write-ups and wire stories released around the report', async () => {
  const at = (hours: number) => (Date.parse('2026-10-22T10:55:00.000Z') + hours * 3_600_000) / 1000;
  const impl = fakeFetch([
    { id: 'urn:summary_document_report:quartr.com:1:0', title: 'PG: sales grew 4%', provider: 'quartr', published: at(9) },
    { id: 'urn:summary_document_transcript:quartr.com:2:0', title: 'PG: guidance kept', provider: 'quartr', published: at(4) },
    { id: 'reuters:1', title: 'P&G beats', provider: 'reuters', published: at(1) },
    { id: 'benzinga:1', title: 'Opinion', provider: 'benzinga', published: at(2) },
    { id: 'reuters:old', title: 'Last quarter', provider: 'reuters', published: at(-72) },
  ], {
    'urn:summary_document_report:quartr.com:1:0': { shortDescription: 'Net sales increased 4%.' },
    'reuters:1': { shortDescription: 'Beat on EPS.' },
  });
  const sources = await fetchEarningsSources(report(), impl);
  assert.deepEqual(sources.map((source) => [source.kind, source.text]), [
    ['report', 'Net sales increased 4%.'], ['call', ''], ['wire', 'Beat on EPS.'],
  ]);
});

function memoryKV(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    values,
    kv: {
      async get(key: string) { const value = values.get(key); return value === undefined ? null : JSON.parse(value); },
      async put(key: string, value: string) { values.set(key, value); },
    } as unknown as KVNamespace,
  };
}

function fakeSonnet(reply: string) {
  const requests: Array<Record<string, unknown>> = [];
  const client = { beta: { messages: { stream(request: Record<string, unknown>) {
    requests.push(request);
    return { finalMessage: async () => ({
      model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: reply }],
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }) };
  } } } };
  return { client: client as unknown as Anthropic, requests };
}

test('writes a summary once there is material and waits when there is none', async () => {
  const { kv, values } = memoryKV();
  const reports = [report(), report({ symbol: 'NYSE:QUIET', ticker: 'QUIET', marketCap: 50e9 })];
  const headlines = (symbol: string) => symbol === 'NYSE:PG'
    ? [{ id: 'urn:summary_document_report:quartr.com:1:0', title: 'PG: sales grew 4%', provider: 'quartr', published: Date.parse('2026-10-22T12:00:00Z') / 1000 }]
    : [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/headlines')) return Response.json({ items: headlines(url.searchParams.get('symbol') ?? '') });
    return Response.json({ shortDescription: 'Net sales increased 4%.' });
  }) as typeof fetch;
  const sonnet = fakeSonnet(JSON.stringify({ bullets: ['EPS $2.00 beat.', 'Guidance kept.', 'Margins fell.'] }));
  const result = await runEarningsSummaries({ EARNINGS_SUMMARIES: kv }, now, {
    fetchImpl: impl, client: sonnet.client, loadReports: async () => reports,
  });
  assert.deepEqual(result, { due: 2, written: 1, waiting: 1, failed: 0 });
  const day = JSON.parse(values.get(earningsSummaryKey('2026-10-22'))!) as EarningsSummaryDay;
  assert.deepEqual(day['NYSE:PG']!.bullets, ['EPS $2.00 beat.', 'Guidance kept.', 'Margins fell.']);
  assert.deepEqual(day['NYSE:QUIET']!.bullets, []);
  assert.equal(sonnet.requests[0]!.model, 'claude-sonnet-5-5');
  assert.match(String((sonnet.requests[0]!.messages as Array<{ content: string }>)[0]!.content), /EPS \$2\.00 against a \$1\.88 consensus \(\+6\.2% surprise\)/);
});

test('a bad reply counts as a failure instead of storing junk', async () => {
  const { kv, values } = memoryKV();
  const impl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/headlines')) return Response.json({ items: [{ id: 'reuters:1', title: 'P&G beats', provider: 'reuters', published: Date.parse('2026-10-22T12:00:00Z') / 1000 }] });
    return Response.json({ shortDescription: 'Beat.' });
  }) as typeof fetch;
  const result = await runEarningsSummaries({ EARNINGS_SUMMARIES: kv }, now, {
    fetchImpl: impl, client: fakeSonnet('not json').client, loadReports: async () => [report()],
  });
  assert.equal(result.failed, 1);
  const day = JSON.parse(values.get(earningsSummaryKey('2026-10-22'))!) as EarningsSummaryDay;
  assert.deepEqual(day['NYSE:PG'], { ...day['NYSE:PG'], bullets: [], failures: 1 });
});
