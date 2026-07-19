import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDiggTech } from './digg-tech.mjs';

test('parses ranked Digg Tech stories from the current structured payload', () => {
  const payload = [
    '$',
    '$Lfeed',
    null,
    {
      basePath: '/tech',
      topic: 'ai',
      storiesByFilter: {
        top: {
          posts: [
            {
              type: 'cluster',
              clusterId: 'story-current',
              clusterUrlId: 'abc123',
              title: 'Current tech story',
              tldr: 'A useful current summary.',
              createdAt: '2026-07-19T08:04:15.230903+00:00',
            },
            {
              type: 'cluster',
              clusterId: 'missing-slug',
              title: 'Incomplete story',
              createdAt: '2026-07-19T09:04:15+00:00',
            },
          ],
        },
      },
    },
  ];
  const nextData = JSON.stringify([1, `2b:${JSON.stringify(payload)}`]);
  const html = `
    <head><link rel="icon" href="/icon.svg?current"></head>
    <script>self.__next_f.push(${nextData})</script>
  `;

  assert.deepEqual(parseDiggTech(html), [
    {
      id: 'story-current',
      source: 'digg',
      author: {
        name: 'Digg Tech',
        handle: 'tech',
        avatarUrl: 'https://digg.com/icon.svg?current',
      },
      text: 'Current tech story\n\nA useful current summary.',
      publishedAt: '2026-07-19T08:04:15.230Z',
      url: 'https://digg.com/ai/abc123',
      media: [],
    },
  ]);
});

test('keeps the legacy ranked-story parser as a fallback', () => {
  const html = `
    <head><link rel="icon" href="/icon.svg?current"></head>
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
      author: {
        name: 'Digg Tech',
        handle: 'tech',
        avatarUrl: 'https://digg.com/icon.svg?current',
      },
      text: 'First tech story\n\nA useful summary.',
      publishedAt: '2026-07-11T08:04:15.230Z',
      url: 'https://digg.com/tech/abc123',
      media: [],
    },
  ]);
});
