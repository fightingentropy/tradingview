import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDiggTech } from './digg-tech.mjs';

test('parses only ranked Digg Tech stories with stable timestamps', () => {
  const html = `
    <div data-testid="top-stories-stack">
      <div data-story-row="true" data-story-id="story-one">
        <a href="/tech/abc123"><h3>First tech story</h3></a>
        <p>A useful summary.</p>
      </div>
      <div data-story-row="true" data-story-id="missing-timestamp">
        <a href="/tech/nope"><h3>Incomplete story</h3></a>
      </div>
    </div>
    <div data-story-row="true" data-story-id="outside-stack">
      <a href="/tech/outside"><h3>Not a top story</h3></a>
    </div>
    <script>self.__next_f.push([1, "{\\"clusterId\\":\\"story-one\\",\\"title\\":\\"First tech story\\",\\"createdAt\\":\\"2026-07-11T08:04:15.230903+00:00\\"}"])</script>
  `;

  assert.deepEqual(parseDiggTech(html), [
    {
      id: 'story-one',
      source: 'digg',
      author: { name: 'Digg Tech', handle: 'tech' },
      text: 'First tech story\n\nA useful summary.',
      publishedAt: '2026-07-11T08:04:15.230Z',
      url: 'https://digg.com/tech/abc123',
      media: [],
    },
  ]);
});
