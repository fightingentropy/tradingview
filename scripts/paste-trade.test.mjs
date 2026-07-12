import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchPasteTrade,
  normalizePasteShow,
  resetPasteTradeCache,
  selectActivePasteShows,
} from './paste-trade.mjs';

const NOW = Date.parse('2026-07-12T20:00:00.000Z');

test('selects only recently active Paste shows in newest-first order', () => {
  const selected = selectActivePasteShows({
    items: [
      { id: 'older', name: 'Older', latest_published_at: '2026-07-10T12:00:00.000Z' },
      { id: 'newer', name: 'Newer', latest_published_at: '2026-07-12T18:00:00.000Z' },
      { id: 'stale', name: 'Stale', latest_published_at: '2026-05-01T12:00:00.000Z' },
      { id: 'empty', name: 'Empty', latest_published_at: null },
    ],
  }, NOW);

  assert.deepEqual(selected.map(({ id }) => id), ['newer', 'older']);
});

test('normalizes a Paste source into one compact trade-call card', () => {
  assert.deepEqual(normalizePasteShow({
    show: { id: 'macro-show', name: 'Macro Show' },
    sources: [{
      source: {
        id: 'source-123',
        title: 'The new macro setup',
        published_at: '2026-07-12T18:00:00.000Z',
        source_images: ['https://images.example/thumb.jpg'],
      },
      author: {
        name: 'Macro Host',
        handle: 'macrohost',
        avatar_url: '/api/avatars/macrohost',
      },
      trades: [
        { display_ticker: 'NVDA', direction: 'long', thesis: 'Demand is accelerating.' },
        { ticker: 'BTC', direction: 'short', headline_quote: 'Liquidity is tightening.' },
      ],
    }],
  }), [{
    id: 'source-123',
    source: 'paste',
    author: {
      name: 'Macro Host',
      handle: 'macrohost',
      avatarUrl: 'https://app.paste.trade/api/avatars/macrohost',
    },
    text: 'The new macro setup\n\nLONG NVDA — Demand is accelerating.\n\nSHORT BTC — Liquidity is tightening.',
    publishedAt: '2026-07-12T18:00:00.000Z',
    url: 'https://app.paste.trade/s/source-123',
    media: [{ type: 'image', previewUrl: 'https://images.example/thumb.jpg' }],
  }]);
});

test('reuses unchanged show details while refreshing the Paste show index', async () => {
  resetPasteTradeCache();
  let indexReads = 0;
  let detailReads = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/shows')) {
      indexReads += 1;
      return Response.json({
        items: [{ id: 'macro-show', name: 'Macro Show', latest_published_at: '2026-07-12T18:00:00.000Z' }],
      });
    }
    detailReads += 1;
    return Response.json({
      show: { id: 'macro-show', name: 'Macro Show' },
      sources: [{
        source: { id: 'source-123', title: 'Setup', published_at: '2026-07-12T18:00:00.000Z' },
        author: { name: 'Macro Show', handle: 'macro' },
        trades: [{ ticker: 'HYPE', direction: 'long', thesis: 'Momentum remains strong.' }],
      }],
    });
  };

  const first = await fetchPasteTrade({ fetchImpl, now: NOW });
  const second = await fetchPasteTrade({ fetchImpl, now: NOW });
  assert.equal(first[0].id, 'source-123');
  assert.equal(second[0].id, 'source-123');
  assert.equal(indexReads, 2);
  assert.equal(detailReads, 1);
});
