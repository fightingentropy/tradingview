import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmedOrderStatus, createOrderRecovery, newClientOrderId, recoveryComplete } from '../src/lib/orderRecovery.ts';
import { accountReadState } from '../src/lib/accountReadState.ts';

const ADDRESS = `0x${'1'.repeat(40)}`;
const OTHER = `0x${'2'.repeat(40)}`;
const ID = `0x${'a'.repeat(32)}`;
const CHILD = `0x${'b'.repeat(32)}`;
const attempt = (legs = [{ clientId: ID, label: 'Order', status: null }]) => ({ id: ID, network: 'mainnet', accountAddress: ADDRESS, coin: 'xyz:TEST', startedAt: 1000, legs });
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
const found = (id, status = 'filled', coin = 'xyz:TEST') => ({ status: 'order', order: { status, order: { cloid: id, coin } } });

test('journal is durable before POST and blocks the same account after restart', () => {
  const disk = storage();
  const first = createOrderRecovery(disk);
  first.begin(attempt());
  const restart = createOrderRecovery(disk);
  assert.throws(() => restart.assertCanSubmit('mainnet', ADDRESS.toUpperCase()), /previous order/);
  assert.doesNotThrow(() => restart.assertCanSubmit('testnet', ADDRESS));
  assert.doesNotThrow(() => restart.assertCanSubmit('mainnet', OTHER));
  assert.throws(() => restart.acknowledge(ID), /still unknown/);
});

test('lost response and arbitrarily repeated missing-order responses never permit a duplicate', async () => {
  const journal = createOrderRecovery(storage());
  journal.begin(attempt());
  for (let i = 0; i < 20; i++) {
    await journal.reconcile('mainnet', ADDRESS, async () => ({ status: 'unknownOid' }));
  }
  assert.throws(() => journal.assertCanSubmit('mainnet', ADDRESS), /previous order/);
  assert.equal(recoveryComplete(journal.getSnapshot().attempts[0]), false);
  await assert.rejects(journal.reconcile('mainnet', ADDRESS, async () => { throw new Error('offline'); }), /offline/);
  assert.throws(() => journal.assertCanSubmit('mainnet', ADDRESS), /previous order/);
});

test('late accepted response resolves only after an exact lookup and explicit review; review survives restart', async () => {
  const disk = storage();
  let journal = createOrderRecovery(disk);
  journal.begin(attempt());
  await journal.reconcile('mainnet', ADDRESS, async () => ({ status: 'unknownOid' }));
  journal = createOrderRecovery(disk);
  await journal.reconcile('mainnet', ADDRESS, async (a, id) => {
    assert.equal(a.accountAddress, ADDRESS);
    return found(id);
  });
  assert.equal(recoveryComplete(journal.getSnapshot().attempts[0]), true);
  assert.throws(() => journal.assertCanSubmit('mainnet', ADDRESS), /previous order/);
  journal = createOrderRecovery(disk);
  journal.acknowledge(ID);
  assert.doesNotThrow(() => createOrderRecovery(disk).assertCanSubmit('mainnet', ADDRESS));
});

test('partial bracket acknowledgement retains lock until the unknown protection leg is confirmed', async () => {
  const journal = createOrderRecovery(storage());
  journal.begin(attempt([{ clientId: ID, label: 'Order', status: null }, { clientId: CHILD, label: 'Stop loss', status: null }]));
  journal.recordAcknowledgements(ID, ['filled']);
  await journal.reconcile('mainnet', ADDRESS, async (a, id) => {
    assert.equal(id, CHILD, 'confirmed parent must not be looked up again');
    return { status: 'unknownOid' };
  });
  assert.throws(() => journal.acknowledge(ID), /still unknown/);
  await journal.reconcile('mainnet', ADDRESS, async (a, id) => found(id, 'open'));
  assert.equal(recoveryComplete(journal.getSnapshot().attempts[0]), true);
});

test('a conclusive rejected or successful direct response clears the journal', () => {
  const journal = createOrderRecovery(storage());
  journal.begin(attempt());
  journal.recordAcknowledgements(ID, ['error']);
  journal.assertCanSubmit('mainnet', ADDRESS);
  journal.begin(attempt());
  journal.recordAcknowledgements(ID, ['filled']);
  journal.assertCanSubmit('mainnet', ADDRESS);
});

test('wrong identity/coin, malformed and unknown statuses cannot unlock an attempt', async () => {
  for (const raw of [null, {}, found(CHILD), found(ID, 'filled', 'OTHER'), found(ID, 'newUnknownStatus'), { status: 'order', order: { status: 'filled', order: { cloid: null } } }]) {
    assert.equal(confirmedOrderStatus(raw, ID, 'xyz:TEST'), null);
  }
  const journal = createOrderRecovery(storage());
  journal.begin(attempt());
  let requests = 0;
  await journal.reconcile('testnet', ADDRESS, async () => { requests++; return found(ID); });
  await journal.reconcile('mainnet', OTHER, async () => { requests++; return found(ID); });
  assert.equal(requests, 0);
});

test('write failures prevent POST and malformed/rejected persistence remains locked after startup', () => {
  const unavailable = createOrderRecovery({ getItem: () => null, setItem: () => { throw new Error('full disk'); } });
  let posted = false;
  assert.throws(() => { unavailable.begin(attempt()); posted = true; }, /could not be saved/);
  assert.equal(posted, false);
  for (const contents of ['invalid json', '{}', '[null]']) {
    const corrupt = createOrderRecovery({ getItem: () => contents, setItem: () => {} });
    assert.throws(() => corrupt.assertCanSubmit('mainnet', ADDRESS), /could not be loaded/);
  }
});

test('client IDs have the required 128-bit wire shape', () => {
  assert.match(newClientOrderId(), /^0x[0-9a-f]{32}$/);
  assert.notEqual(newClientOrderId(1000), newClientOrderId(1000));
});

test('account reads distinguish missing, failed, cached and truly empty results', () => {
  const read = { data: undefined, isError: false, isFetching: true, dataUpdatedAt: 0 };
  assert.equal(accountReadState(read, 100, 1000), 'loading');
  assert.equal(accountReadState({ ...read, isError: true, isFetching: false }, 100, 1000), 'error');
  assert.equal(accountReadState({ ...read, data: [], dataUpdatedAt: 990, isFetching: false }, 100, 1000), 'ready');
  assert.equal(accountReadState({ ...read, data: [], dataUpdatedAt: 990, isError: true }, 100, 1000), 'stale');
  assert.equal(accountReadState({ ...read, data: [{ oid: 1 }], dataUpdatedAt: 800 }, 100, 1000), 'stale');
});

test('an already-open second client refreshes the journal before allowing another submission', () => {
  const disk = storage();
  const first = createOrderRecovery(disk);
  const second = createOrderRecovery(disk);
  first.begin(attempt());
  assert.throws(() => second.assertCanSubmit('mainnet', ADDRESS), /previous order/);
  assert.throws(() => second.begin(attempt()), /previous order/);
  assert.equal(createOrderRecovery(disk).getSnapshot().attempts.length, 1);
});

test('death after response but before saving acknowledgement is recovered from the original IDs', async () => {
  const disk = storage();
  let rejectWrites = false;
  const journal = createOrderRecovery({ ...disk, setItem: (key, value) => {
    if (rejectWrites) throw new Error('process terminated during write');
    disk.setItem(key, value);
  } });
  journal.begin(attempt());
  rejectWrites = true;
  assert.throws(() => journal.recordAcknowledgements(ID, ['filled']), /could not be saved/);
  const restarted = createOrderRecovery(disk);
  assert.throws(() => restarted.assertCanSubmit('mainnet', ADDRESS), /previous order/);
  await restarted.reconcile('mainnet', ADDRESS, async (_, id) => found(id, 'filled'));
  assert.equal(restarted.getSnapshot().attempts[0].legs[0].status, 'filled');
});

test('an unknown acknowledgement cannot unlock even when a generic success string arrives', () => {
  for (const acknowledgement of ['success', 'unknown', 'futureStatus']) {
    const journal = createOrderRecovery(storage());
    journal.begin(attempt());
    journal.recordAcknowledgements(ID, [acknowledgement]);
    assert.throws(() => journal.assertCanSubmit('mainnet', ADDRESS), /previous order/);
  }
});

test('a conclusively rejected bracket leg is preserved while another leg is unknown', async () => {
  const THIRD = `0x${'c'.repeat(32)}`;
  const journal = createOrderRecovery(storage());
  journal.begin(attempt([
    { clientId: ID, label: 'Order', status: null },
    { clientId: CHILD, label: 'Take profit', status: null },
    { clientId: THIRD, label: 'Stop loss', status: null },
  ]));
  journal.recordAcknowledgements(ID, ['filled', 'error', 'unknown']);
  await journal.reconcile('mainnet', ADDRESS, async (_, id) => {
    assert.equal(id, THIRD);
    return found(id, 'siblingFilledCanceled');
  });
  assert.deepEqual(journal.getSnapshot().attempts[0].legs.map((leg) => leg.status), ['filled', 'error', 'siblingFilledCanceled']);
  assert.equal(recoveryComplete(journal.getSnapshot().attempts[0]), true);
});

test('invalid persisted status and disappeared pending journal fail closed', () => {
  const invalid = { ...attempt(), legs: [{ clientId: ID, label: 'Order', status: 'unproven' }] };
  const journal = createOrderRecovery({ getItem: () => JSON.stringify([invalid]), setItem: () => {} });
  assert.throws(() => journal.assertCanSubmit('mainnet', ADDRESS), /could not be loaded/);
  let contents = null;
  const vanished = createOrderRecovery({ getItem: () => contents, setItem: (_, value) => { contents = value; } });
  vanished.begin(attempt());
  contents = null;
  assert.throws(() => vanished.assertCanSubmit('mainnet', ADDRESS), /could not be loaded/);
});
