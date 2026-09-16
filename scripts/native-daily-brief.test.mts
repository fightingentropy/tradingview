import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, mock, test } from 'node:test';
import { loadBriefEdition, loadBriefIndex } from '../src/providers/briefs/client.ts';

const entry = { id: '2026-09-16', title: 'The Fed restarts tightening; breadth weakens.', generated: '2026-09-16 21:59' };
const markdown = readFileSync(new URL('../web/src/data/briefs/2026-09-16.md', import.meta.url), 'utf8');
afterEach(() => mock.restoreAll());

test('native reader receives the exact published Markdown, source links and cutoff', async () => {
  const urls: string[] = [];
  mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return Response.json(url.endsWith(entry.id) ? { title: entry.title, markdown } : { version: 1, publishedAt: '2026-09-16T21:00:00Z', editions: [entry] });
  });
  const index = await loadBriefIndex();
  const edition = await loadBriefEdition(index.editions[0]);
  assert.equal(edition.raw, markdown.trim());
  assert.equal(edition.sections.length, 8);
  assert.ok(edition.sources.length >= 5);
  assert.match(edition.cutoff, /16 September/);
  assert.deepEqual(urls, ['https://trade.erlin.org/api/daily-briefs', 'https://trade.erlin.org/api/daily-briefs/2026-09-16']);
});

test('rejects mismatched edition bodies instead of displaying them under another date', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ title: entry.title, markdown }));
  await assert.rejects(loadBriefEdition({ ...entry, id: '2026-09-17', generated: '2026-09-17 08:00' }), /does not match/);
});

test('network and malformed-feed failures remain errors, not empty or fabricated editions', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(loadBriefIndex(), /503/);
  fetchMock.mock.mockImplementation(async () => Response.json({ version: 1, editions: [] }));
  await assert.rejects(loadBriefIndex(), /Invalid brief index/);
});

test('refuses invalid dates before making a request and propagates cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls += 1;
    assert.equal(options.signal?.aborted, true);
    throw new DOMException('Aborted', 'AbortError');
  });
  await assert.rejects(loadBriefEdition({ ...entry, id: '../settings' }), /Invalid brief edition date/);
  assert.equal(calls, 0);
  await assert.rejects(loadBriefIndex(controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
