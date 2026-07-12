import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateExecution } from '../src/domain/execution.ts';

const book = {
  coin: 'xyz:SNDK',
  timestamp: 1,
  bids: [
    { price: 99, size: 1, orders: 1 },
    { price: 98, size: 2, orders: 2 },
  ],
  asks: [
    { price: 101, size: 1, orders: 1 },
    { price: 102, size: 2, orders: 2 },
  ],
};

test('estimates a volume-weighted market buy and visible spread', () => {
  const estimate = estimateExecution(book, true, 2);
  assert.ok(estimate);
  assert.equal(estimate.bestPrice, 101);
  assert.equal(estimate.averagePrice, 101.5);
  assert.equal(estimate.filledSize, 2);
  assert.equal(estimate.sufficientDepth, true);
  assert.equal(estimate.spreadPct, 2);
  assert.ok(Math.abs(estimate.priceImpactPct - 0.4950495) < 1e-6);
});

test('flags when the visible book cannot fill the requested size', () => {
  const estimate = estimateExecution(book, false, 5);
  assert.ok(estimate);
  assert.equal(estimate.filledSize, 3);
  assert.equal(estimate.requestedSize, 5);
  assert.equal(estimate.sufficientDepth, false);
  assert.equal(estimate.averagePrice, (99 + 98 * 2) / 3);
});
