import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultTradeSizeMode } from '../src/lib/tradeTicket.ts';

test('new trade tickets default to the asset unit', () => {
  assert.equal(defaultTradeSizeMode(), 'coin');
});
