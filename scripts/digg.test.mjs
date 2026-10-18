import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDigg } from './digg.ts';

test('parses the homepage trending feed across topics, preserving rank and each story link', () => {
  const story = {
    clusterId: 'business-story',
    clusterUrlId: 'business123',
    topicSlug: 'world-business',
    summary: { title: 'A business development', description: 'A useful summary.' },
    createdAt: '2026-10-03T08:00:00Z',
  };
  const payload = {
    feedGroups: [{
      topicSlug: 'tech',
      initialPage: { view: 'top', posts: [{ ...story, clusterId: 'sidebar-story' }] },
    }],
    initialPage: {
      view: 'trending',
      posts: [
        story,
        { ...story, clusterId: 'sports-story', clusterUrlId: 'sports456', topicSlug: 'sports', createdAt: '2026-10-03T12:00:00Z' },
        { ...story, clusterId: 'ai-story', clusterUrlId: 'ai789', topicSlug: 'ai' },
      ],
    },
  };
  const html = `<head><link rel="icon" href="/icon.svg"></head>
    <script>self.__next_f.push(${JSON.stringify([1, `19:${JSON.stringify(payload)}`])})</script>`;
  const items = parseDigg(html);

  assert.deepEqual(items.map(item => item.id), ['business-story', 'sports-story', 'ai-story']);
  assert.deepEqual(items.map(item => item.url), [
    'https://digg.com/world-business/business123',
    'https://digg.com/sports/sports456',
    'https://digg.com/ai/ai789',
  ]);
  assert.equal(items[0].publishedAt, '2026-10-03T08:00:00.000Z');
  assert.equal(items[0].text, 'A business development\n\nA useful summary.');
  assert.deepEqual(items[0].author, { name: 'Digg', handle: 'digg', avatarUrl: 'https://digg.com/icon.svg' });
});

test('skips homepage stories whose topic cannot produce a valid category link', () => {
  const story = {
    clusterId: 'missing-topic',
    clusterUrlId: 'abc123',
    summary: { title: 'A story' },
    createdAt: '2026-10-03T08:00:00Z',
  };
  const payload = { initialPage: { view: 'trending', posts: [
    story,
    { ...story, clusterId: 'unsafe-topic', topicSlug: '../tech' },
    { ...story, clusterId: 'valid-topic', topicSlug: 'world-business' },
  ] } };
  const html = `<script>self.__next_f.push(${JSON.stringify([1, `19:${JSON.stringify(payload)}`])})</script>`;
  const items = parseDigg(html);
  assert.deepEqual(items.map(item => item.id), ['valid-topic']);
  assert.equal(items[0].url, 'https://digg.com/world-business/abc123');
});

test('parses the current initialPage feed, preserving rank and topic links', () => {
  const story = {
    type: 'cluster',
    clusterId: 'rank-one',
    clusterUrlId: 'first123',
    summary: { title: 'First ranked story', description: 'A useful summary.' },
    createdAt: '2026-09-12T11:32:36.230723+00:00',
  };
  const payload = ['$', '$Llayout', null, {
    children: ['$', '$Lfeed', null, {
      basePath: '/tech',
      defaultView: 'top',
      topicSlug: 'tech',
      initialPage: {
        view: 'top',
        posts: [
          story,
          { ...story, clusterId: 'missing-slug', clusterUrlId: null },
          { ...story, clusterId: 'bad-date', createdAt: 'invalid' },
          null,
          {
            ...story,
            clusterId: 'rank-two',
            clusterUrlId: 'second456',
            summary: { title: 'Second ranked story' },
            createdAt: '2026-09-12T12:00:00Z',
          },
        ],
      },
    }],
  }];
  const html = `<head><link rel="icon" href="/icon.svg?current"></head>
    <script>self.__next_f.push(${JSON.stringify([1, `19:${JSON.stringify(payload)}\n`])})</script>`;

  assert.deepEqual(parseDigg(html), [
    {
      id: 'rank-one',
      source: 'digg',
      author: { name: 'Digg', handle: 'digg', avatarUrl: 'https://digg.com/icon.svg?current' },
      text: 'First ranked story\n\nA useful summary.',
      publishedAt: '2026-09-12T11:32:36.230Z',
      url: 'https://digg.com/tech/first123',
      media: [],
    },
    {
      id: 'rank-two',
      source: 'digg',
      author: { name: 'Digg', handle: 'digg', avatarUrl: 'https://digg.com/icon.svg?current' },
      text: 'Second ranked story',
      publishedAt: '2026-09-12T12:00:00.000Z',
      url: 'https://digg.com/tech/second456',
      media: [],
    },
  ]);
});

test('selects the top initialPage instead of unrelated feeds and uses topicSlug', () => {
  const story = {
    clusterId: 'top-story',
    clusterUrlId: 'abc123',
    summary: { title: 'Top story' },
    createdAt: '2026-09-12T11:00:00Z',
  };
  const payload = [
    { topicSlug: 'news', initialPage: { view: 'latest', posts: [{ ...story, clusterId: 'latest-story' }] } },
    { topicSlug: 'ai', initialPage: { view: 'top', posts: [story] } },
  ];
  const html = `<script>self.__next_f.push(${JSON.stringify([1, `19:${JSON.stringify(payload)}`])})</script>`;
  const items = parseDigg(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'top-story');
  assert.equal(items[0].url, 'https://digg.com/ai/abc123');
});

test('parses ranked Digg stories from the previous storiesByFilter payload', () => {
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
              summary: {
                title: 'Current tech story',
                description: 'A useful current summary.',
              },
              createdAt: '2026-07-19T08:04:15.230903+00:00',
            },
            {
              type: 'cluster',
              clusterId: 'missing-slug',
              summary: { title: 'Incomplete story' },
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

  assert.deepEqual(parseDigg(html), [
    {
      id: 'story-current',
      source: 'digg',
      author: {
        name: 'Digg',
        handle: 'digg',
        avatarUrl: 'https://digg.com/icon.svg?current',
      },
      text: 'Current tech story\n\nA useful current summary.',
      publishedAt: '2026-07-19T08:04:15.230Z',
      url: 'https://digg.com/ai/abc123',
      media: [],
    },
  ]);
});

test('still accepts legacy title/tldr fields on structured Digg posts', () => {
  const payload = [
    '$',
    '$Lfeed',
    null,
    {
      topic: 'tech',
      storiesByFilter: {
        top: {
          posts: [
            {
              type: 'cluster',
              clusterId: 'story-legacy',
              clusterUrlId: 'legacy123',
              title: 'Legacy tech story',
              tldr: 'Legacy summary.',
              createdAt: '2026-07-19T08:04:15.230903+00:00',
            },
          ],
        },
      },
    },
  ];
  const nextData = JSON.stringify([1, `2b:${JSON.stringify(payload)}`]);
  const html = `<script>self.__next_f.push(${nextData})</script>`;

  assert.deepEqual(parseDigg(html), [
    {
      id: 'story-legacy',
      source: 'digg',
      author: { name: 'Digg', handle: 'digg' },
      text: 'Legacy tech story\n\nLegacy summary.',
      publishedAt: '2026-07-19T08:04:15.230Z',
      url: 'https://digg.com/tech/legacy123',
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

  assert.deepEqual(parseDigg(html), [
    {
      id: 'story-one',
      source: 'digg',
      author: {
        name: 'Digg',
        handle: 'digg',
        avatarUrl: 'https://digg.com/icon.svg?current',
      },
      text: 'First tech story\n\nA useful summary.',
      publishedAt: '2026-07-11T08:04:15.230Z',
      url: 'https://digg.com/tech/abc123',
      media: [],
    },
  ]);
});
