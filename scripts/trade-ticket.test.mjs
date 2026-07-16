import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultTradeSizeMode,
  shouldDismissTradeTicket,
  shouldStartTradeTicketDismiss,
} from '../src/lib/tradeTicket.ts';

test('new trade tickets default to the asset unit', () => {
  assert.equal(defaultTradeSizeMode(), 'coin');
});

test('only starts a downward ticket drag from the top while idle', () => {
  assert.equal(shouldStartTradeTicketDismiss(2, 18, 0, false), true);
  assert.equal(shouldStartTradeTicketDismiss(2, -18, 0, false), false);
  assert.equal(shouldStartTradeTicketDismiss(2, 18, 20, false), false);
  assert.equal(shouldStartTradeTicketDismiss(2, 18, 0, true), false);
  assert.equal(shouldStartTradeTicketDismiss(20, 18, 0, false), false);
});

test('dismisses after a committed pull or a downward flick', () => {
  assert.equal(shouldDismissTradeTicket(72, 0.1), true);
  assert.equal(shouldDismissTradeTicket(28, 1.2), true);
  assert.equal(shouldDismissTradeTicket(40, 0.4), false);
  assert.equal(shouldDismissTradeTicket(12, 2), false);
});
