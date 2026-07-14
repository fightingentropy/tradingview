import assert from 'node:assert/strict';
import test from 'node:test';

import { materiallyDifferentMid } from '../src/lib/tradePreflight.ts';

test('accepts an unchanged or modestly moved midpoint within the reviewed window', () => {
  assert.equal(materiallyDifferentMid(100, 100, 0.005), false);
  assert.equal(materiallyDifferentMid(100, 100.49, 0.005), false);
});

test('requires review when the midpoint moves beyond the guarded slippage window', () => {
  assert.equal(materiallyDifferentMid(100, 100.51, 0.005), true);
  assert.equal(materiallyDifferentMid(100, 100.11, 0.0001), true);
});

test('fails closed for invalid midpoint data', () => {
  assert.equal(materiallyDifferentMid(0, 100, 0.005), true);
  assert.equal(materiallyDifferentMid(100, Number.NaN, 0.005), true);
});
