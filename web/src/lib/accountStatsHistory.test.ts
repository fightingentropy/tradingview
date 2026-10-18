import { expect, test } from 'bun:test';
import { fetchAccountStatsHistory, paginateStatsHistory } from './accountStatsHistory';
import { statsRangeStart } from './accountStats';
const signal = () => new AbortController().signal;

test('pagination keeps every event at inclusive timestamp boundaries and deduplicates overlap', async () => {
  const data = [{ id: 'a', time: 1 }, { id: 'b', time: 2 }, { id: 'c', time: 2 }, { id: 'd', time: 3 }];
  const cursors: number[] = [];
  const result = await paginateStatsHistory({ fetchPage: async start => { cursors.push(start); return data.filter(item => item.time >= start).slice(0, 3); }, key: item => item.id, start: 0, end: 10, pageLimit: 3, maxRows: 100, signal: signal() });
  expect(result.items.map(item => item.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(cursors).toEqual([0, 2, 3]);
  expect(result.complete).toBe(true);
});

test('a full page stuck at a single timestamp is marked incomplete instead of skipping events', async () => {
  const result = await paginateStatsHistory({ fetchPage: async () => [{ id: 'a', time: 1 }, { id: 'b', time: 1 }], key: item => item.id, start: 1, end: 10, pageLimit: 2, maxRows: 100, signal: signal() });
  expect(result.complete).toBe(false);
});

test('an exact row cap is verified with an inclusive boundary probe, including the end timestamp', async () => {
  const data = [{ id: 'a', time: 1 }, { id: 'b', time: 2 }, { id: 'c', time: 3 }], cursors: number[] = [];
  const result = await paginateStatsHistory({ fetchPage: async start => { cursors.push(start); return data.filter(item => item.time >= start).slice(0, 3); }, key: item => item.id, start: 0, end: 3, pageLimit: 3, maxRows: 3, signal: signal() });
  expect(result.items).toEqual(data);
  expect(result.complete).toBe(true);
  expect(cursors).toEqual([0, 3]);
});

test('a full page at the end timestamp is not assumed to contain every event', async () => {
  const result = await paginateStatsHistory({ fetchPage: async () => [{ id: 'a', time: 3 }, { id: 'b', time: 3 }], key: item => item.id, start: 0, end: 3, pageLimit: 2, maxRows: 100, signal: signal() });
  expect(result.complete).toBe(false);
});

test('pagination is bounded and cancellation prevents requests', async () => {
  const result = await paginateStatsHistory({ fetchPage: async start => [{ id: String(start + 1), time: start + 1 }], key: item => item.id, start: 0, end: 100, pageLimit: 2, maxRows: 3, signal: signal() });
  expect(result.items).toHaveLength(3);
  expect(result.complete).toBe(false);
  const controller = new AbortController(); controller.abort();
  let called = false;
  await expect(paginateStatsHistory({ fetchPage: async () => { called = true; return []; }, key: item => item.id, start: 0, end: 10, pageLimit: 2, maxRows: 10, signal: controller.signal })).rejects.toThrow();
  expect(called).toBe(false);
});

test('incremental refresh uses the previous timestamp, preserves history and isolates accounts', async () => {
  const now = Date.parse('2026-10-11T12:00:00Z'), requests: Array<{ type: string; start: number }> = [];
  const client: Parameters<typeof fetchAccountStatsHistory>[0] = {
    userFillsByTime: async params => { requests.push({ type: 'fills', start: Number(params.startTime) }); return []; },
    userFunding: async params => { requests.push({ type: 'funding', start: Number(params.startTime) }); return []; },
    userBorrowLendInterest: async params => { requests.push({ type: 'interest', start: Number(params.startTime) }); return []; },
  };
  const user = `0x${'1'.repeat(40)}` as `0x${string}`;
  const first = await fetchAccountStatsHistory(client, { user, now, converter: null, signal: signal() });
  expect(requests[0]).toEqual({ type: 'fills', start: 0 });
  expect(requests[1]).toEqual({ type: 'funding', start: statsRangeStart(90, now) });
  expect(requests[2]).toEqual({ type: 'interest', start: statsRangeStart(90, now) });
  requests.length = 0;
  const funding = { id: 'old', time: now - 3600000, symbol: 'BTC', amount: 10 };
  const next = await fetchAccountStatsHistory(client, { user, now: now + 60000, converter: null, signal: signal(), previous: { ...first, funding: [funding] } });
  expect(next.funding).toEqual([funding]);
  expect(requests[0].start).toBe(now - 120000);
  expect(requests[1].start).toBe(now - 120000);
  expect(requests[2].start).toBe(now - 120000);
  requests.length = 0;
  const changed = await fetchAccountStatsHistory(client, { user: `0x${'2'.repeat(40)}`, now, converter: null, signal: signal(), previous: next });
  expect(requests[0].start).toBe(0);
  expect(changed.funding).toEqual([]);
  requests.length = 0;
  await fetchAccountStatsHistory(client, { user, now: now + 60000, converter: null, signal: signal(), previous: { ...first, fillsComplete: false, fundingComplete: false, interestComplete: false } });
  expect(requests[0].start).toBe(0);
  expect(requests[1].start).toBe(statsRangeStart(90, now + 60000));
  expect(requests[2].start).toBe(statsRangeStart(90, now + 60000));
});

test('interest is normalized, cached without duplicates, and never shared with another account', async () => {
  const now = Date.parse('2026-10-13T12:00:00Z'), user = `0x${'1'.repeat(40)}` as `0x${string}`;
  const client: Parameters<typeof fetchAccountStatsHistory>[0] = {
    userFillsByTime: async () => [], userFunding: async () => [],
    userBorrowLendInterest: async params => params.user === user ? [{ time: now - 1000, token: 'USDC', borrow: '3.50', supply: '0.10' }, { time: now - 1000, token: 'USDT0', borrow: '0', supply: '0.0001' }] : [],
  };
  const first = await fetchAccountStatsHistory(client, { user, now, converter: null, signal: signal() });
  expect(first.interestComplete).toBe(true);
  expect(first.interest).toHaveLength(2);
  expect(first.interest[0]).toMatchObject({ asset: 'USDC', borrow: 3.5, supply: .1 });
  const second = await fetchAccountStatsHistory(client, { user, now: now + 1000, converter: null, signal: signal(), previous: first });
  expect(second.interest).toEqual(first.interest);
  const changed = await fetchAccountStatsHistory(client, { user: `0x${'2'.repeat(40)}`, now, converter: null, signal: signal(), previous: first });
  expect(changed.interest).toEqual([]);
});

test('an interest outage preserves independent results, marks costs unavailable, and retries full coverage', async () => {
  const now = Date.parse('2026-10-13T12:00:00Z'), user = `0x${'1'.repeat(40)}` as `0x${string}`;
  let fail = true, interestStart = -1;
  const client: Parameters<typeof fetchAccountStatsHistory>[0] = {
    userFillsByTime: async () => [], userFunding: async () => [],
    userBorrowLendInterest: async params => { interestStart = Number(params.startTime); if (fail) throw new Error('Unavailable'); return []; },
  };
  const failed = await fetchAccountStatsHistory(client, { user, now, converter: null, signal: signal() });
  expect(failed.fillsComplete).toBe(true);
  expect(failed.fundingComplete).toBe(true);
  expect(failed.interestComplete).toBe(false);
  fail = false;
  const recovered = await fetchAccountStatsHistory(client, { user, now: now + 60000, converter: null, signal: signal(), previous: failed });
  expect(interestStart).toBe(statsRangeStart(90, now + 60000));
  expect(recovered.interestComplete).toBe(true);
});
