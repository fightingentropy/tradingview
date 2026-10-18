import { expect, test } from 'bun:test';
import { calculateAccountStats, statsCsv, statsDayKey, statsDayStart, statsRangeStart, statsRowValues, type StatsFill, type StatsHistory, type StatsInterest } from './accountStats';
const now = Date.parse('2026-10-11T12:00:00Z');
const day = Date.parse('2026-10-11T09:00:00Z');
const history = (overrides: Partial<StatsHistory> = {}): StatsHistory => ({ user: 'account', updatedAt: now, fills: [], funding: [], interest: [], fillCoverageStart: 0, fillsLimited: false, fillsComplete: true, fundingCoverageStart: 0, fundingComplete: true, interestCoverageStart: 0, interestComplete: true, ...overrides });
const fill = (overrides: Partial<StatsFill> = {}): StatsFill => ({ id: 'BTC:1', time: day, symbol: 'BTC', market: 'futures', side: 'sell', direction: 'Close Long', price: 150, size: 1, startPosition: 1, closedPnl: 50, fee: 2, feeToken: 'USDC', ...overrides });
const spot = (overrides: Partial<StatsFill> = {}): StatsFill => fill({ id: '@1:1', symbol: 'HYPE/USDC', market: 'spot', direction: 'Buy', side: 'buy', startPosition: 0, closedPnl: 0, ...overrides });

test('funding is signed cash flow, bounded by London days and never counted twice', () => {
  const received = { id: 'received', time: day, symbol: 'BTC', amount: 12 };
  const stats = calculateAccountStats(history({ funding: [received, received, { id: 'paid', time: day, symbol: 'BTC', amount: -4 }, { id: 'old', time: statsRangeStart(7, now) - 1, symbol: 'BTC', amount: 999 }, { id: 'future', time: now + 1, symbol: 'BTC', amount: 999 }] }), 7, now);
  expect(stats.totals.funding).toBe(8);
  expect(stats.totals.fundingReceived).toBe(12);
  expect(stats.totals.fundingPaid).toBe(4);
  expect(stats.days).toHaveLength(7);
  expect(stats.days[0].date).toBe('2026-10-05');
  expect(stats.days.at(-1)?.funding).toBe(8);
  expect(stats.net).toBe(8);
});

test('London calendar boundaries handle summer time, 23-hour and 25-hour days', () => {
  expect(statsDayKey(Date.parse('2026-10-10T23:30:00Z'))).toBe('2026-10-11');
  expect(statsDayStart('2026-10-11')).toBe(Date.parse('2026-10-10T23:00:00Z'));
  expect(statsDayStart('2026-03-30') - statsDayStart('2026-03-29')).toBe(23 * 3_600_000);
  expect(statsDayStart('2026-10-26') - statsDayStart('2026-10-25')).toBe(25 * 3_600_000);
});

test('futures subtract opening and closing fees once, including rebates', () => {
  const stats = calculateAccountStats(history({ fills: [fill({ id: 'open', direction: 'Open Long', side: 'buy', closedPnl: 0, fee: 3 }), fill({ id: 'close', fee: -1 }), fill({ id: 'loss', closedPnl: -10, fee: 2 })] }), 1, now);
  expect(stats.totals.futuresGross).toBe(40);
  expect(stats.totals.fees).toBe(4);
  expect(stats.totals.futures).toBe(36);
  expect(stats.totals.closes).toBe(2);
  expect(stats.totals.wins).toBe(1);
  expect(stats.net).toBe(36);
});

test('spot FIFO uses purchases before the selected period and capitalizes their fees', () => {
  const stats = calculateAccountStats(history({ fills: [spot({ id: 'buy1', time: day - 10 * 86_400_000, price: 100, size: 2, fee: 2 }), spot({ id: 'buy2', time: day - 9 * 86_400_000, price: 200, size: 1, startPosition: 2, fee: 1 }), spot({ id: 'sell', side: 'sell', time: day, price: 250, size: 2.5, startPosition: 3, fee: 5 })] }), 7, now);
  // FIFO cost: 202 + half of 201. Sale proceeds: 625 - 5.
  expect(stats.totals.spot).toBeCloseTo(317.5, 8);
  expect(stats.totals.fees).toBe(5);
  expect(stats.totals.fills).toBe(1);
  expect(stats.net).toBeCloseTo(317.5, 8);
});

test('spot fees paid in the base token reduce acquired inventory', () => {
  const stats = calculateAccountStats(history({ fills: [spot({ id: 'buy', price: 100, size: 1, fee: .01, feeToken: 'HYPE' }), spot({ id: 'sell', time: day + 1000, side: 'sell', price: 120, size: .99, startPosition: .99, fee: 0 })] }), 1, now);
  expect(stats.totals.spot).toBeCloseTo(18.8, 8);
  expect(stats.spotComplete).toBe(true);
});

test('spot sell fees paid in the base token consume additional cost basis', () => {
  const stats = calculateAccountStats(history({ fills: [spot({ id: 'buy', price: 100, size: 2, fee: 0 }), spot({ id: 'sell', time: day + 1000, side: 'sell', price: 150, size: 1, startPosition: 2, fee: .01, feeToken: 'HYPE' })] }), 1, now);
  expect(stats.totals.spot).toBeCloseTo(49, 8);
  expect(stats.totals.fees).toBeCloseTo(1.5, 8);
});

test('missing purchase history never turns spot sale proceeds into profit', () => {
  const stats = calculateAccountStats(history({ fills: [fill(), spot({ side: 'sell', startPosition: 2, size: 1 })] }), 1, now);
  expect(stats.totals.unknownSpotSales).toBe(1);
  expect(stats.spotComplete).toBe(false);
  expect(stats.futuresComplete).toBe(true);
  expect(stats.net).toBeUndefined();
  const row = statsCsv(stats).split('\r\n')[1].split(',');
  expect(row[4]).toBe('48.00000000');
  expect(row[5]).toBe('');
  expect(row[6]).toBe('');
});

test('deposited spot inventory has unknown cost and withdrawals are not earnings', () => {
  const stats = calculateAccountStats(history({ fills: [spot({ id: 'buy', price: 100, size: 2, fee: 0 }), spot({ id: 'sell1', time: day + 1000, side: 'sell', price: 150, size: 2, startPosition: 3, fee: 0 }), spot({ id: 'sell2', time: day + 2000, side: 'sell', price: 150, size: 1, startPosition: 1, fee: 0 })] }), 1, now);
  expect(stats.totals.spot).toBe(100);
  expect(stats.totals.unknownSpotSales).toBe(1);
  expect(stats.net).toBeUndefined();
  const withdrawn = calculateAccountStats(history({ fills: [spot({ id: 'buy', price: 100, size: 2, fee: 0 }), spot({ id: 'sell', time: day + 1000, side: 'sell', price: 150, size: 1, startPosition: 1, fee: 0 })] }), 1, now);
  expect(withdrawn.totals.spot).toBe(50);
});

test('non-USDC spot trades do not make futures totals unavailable', () => {
  const stats = calculateAccountStats(history({ fills: [fill(), spot({ symbol: 'HYPE/BTC', feeToken: 'BTC' })] }), 1, now);
  expect(stats.futuresComplete).toBe(true);
  expect(stats.spotComplete).toBe(false);
  expect(stats.net).toBeUndefined();
});

test('truncated trade history and incomplete funding hide dependent totals', () => {
  const input = history({ fillCoverageStart: day, fillsLimited: true, fills: [fill()], funding: [{ id: 'f', time: day, amount: 2, symbol: 'BTC' }] });
  const stats = calculateAccountStats(input, 30, now);
  expect(stats.tradingComplete).toBe(false);
  expect(stats.fundingComplete).toBe(true);
  expect(stats.net).toBeUndefined();
  const fundingMissing = calculateAccountStats(history({ fundingComplete: false, fills: [fill()] }), 1, now);
  expect(fundingMissing.futuresComplete).toBe(true);
  expect(fundingMissing.fundingComplete).toBe(false);
  expect(fundingMissing.net).toBeUndefined();
});

test('unfinished trade pagination never becomes zero earnings for a later period', () => {
  const stats = calculateAccountStats(history({ fillsComplete: false, fillCoverageStart: 0 }), 1, now);
  expect(stats.tradingComplete).toBe(false);
  expect(stats.futuresComplete).toBe(false);
  expect(stats.spotComplete).toBe(false);
  expect(stats.fundingComplete).toBe(true);
  expect(stats.net).toBeUndefined();
  expect(statsCsv(stats).split('\r\n')[1].split(',').slice(4)).toEqual(['', '', '', '0.00000000', '0.00000000', '']);
});

test('daily and market breakdowns reconcile with totals, including zero days', () => {
  const stats = calculateAccountStats(history({ fills: [fill(), fill({ id: 'ETH:1', symbol: 'ETH', time: day - 86_400_000, closedPnl: -20 })], funding: [{ id: 'f', time: day, symbol: 'BTC', amount: 4 }], interest: [{ id: 'i', time: day, asset: 'USDC', borrow: 5, supply: 2 }] }), 30, now);
  expect(stats.days).toHaveLength(30);
  for (const key of ['futures', 'spot', 'funding', 'fees', 'volume', 'fills', 'borrowInterest', 'lendInterest'] as const) {
    expect(stats.days.reduce((sum, row) => sum + row[key], 0)).toBeCloseTo(stats.totals[key], 8);
    expect(stats.markets.reduce((sum, row) => sum + row[key], 0)).toBeCloseTo(stats.totals[key], 8);
  }
  expect(statsCsv(stats).split('\r\n')).toHaveLength(31);
  for (const rows of [stats.days, stats.markets]) {
    expect(rows.reduce((sum, row) => sum + statsRowValues(row, stats).beforeInterest!, 0)).toBeCloseTo(stats.beforeInterest!, 8);
    expect(rows.reduce((sum, row) => sum + statsRowValues(row, stats).net!, 0)).toBeCloseTo(stats.net!, 8);
  }
});

const interest = (overrides: Partial<StatsInterest> = {}): StatsInterest => ({ id: 'interest', time: day, asset: 'USDC', borrow: 20, supply: 2, ...overrides });

test('before-interest earnings and net after interest reconcile without subtracting trading fees twice', () => {
  const stats = calculateAccountStats(history({ fills: [fill()], funding: [{ id: 'f', time: day, symbol: 'BTC', amount: 100 }], interest: [interest()] }), 1, now);
  expect(stats.beforeInterest).toBe(148); // 100 funding + 50 closed PnL - 2 trading fee.
  expect(stats.net).toBe(130); // 148 - 20 borrowed + 2 supplied.
  expect(statsRowValues(stats.totals, stats).net).toBe(130);
  const csv = statsCsv(stats).split('\r\n').map(row => row.split(','));
  expect(csv[0].slice(6)).toEqual(['Realized before interest (USDC)', 'Borrowing interest paid (USDC)', 'Lending interest earned (USDC)', 'Realized after interest (USDC)']);
  expect(csv[1].slice(6)).toEqual(['148.00000000', '20.00000000', '2.00000000', '130.00000000']);
});

test('interest respects inclusive London boundaries and deduplicates paginated entries', () => {
  const boundary = interest({ id: 'start', time: statsRangeStart(7, now) });
  const stats = calculateAccountStats(history({ interest: [boundary, boundary, interest({ id: 'old', time: boundary.time - 1 }), interest({ id: 'future', time: now + 1 })] }), 7, now);
  expect(stats.totals.borrowInterest).toBe(20);
  expect(stats.totals.lendInterest).toBe(2);
  expect(stats.days[0].borrowInterest).toBe(20);
  expect(stats.net).toBe(-18);
});

test('other-asset interest stays in native units and never silently becomes USDC', () => {
  const stats = calculateAccountStats(history({ interest: [interest(), interest({ id: 'usdt', asset: 'USDT0', borrow: 9, supply: .00082485 })] }), 1, now);
  expect(stats.net).toBe(-18);
  expect(stats.interestByAsset).toEqual([{ asset: 'USDC', borrow: 20, supply: 2 }, { asset: 'USDT0', borrow: 9, supply: .00082485 }]);
  expect(stats.markets.map(row => row.symbol)).toEqual(['USDC interest']);
});

test('missing interest keeps before-interest earnings visible and never masquerades as zero costs', () => {
  for (const overrides of [{ interestComplete: false }, { interestCoverageStart: day }]) {
    const stats = calculateAccountStats(history({ ...overrides, fills: [fill()], interest: [interest()] }), 7, now);
    expect(stats.beforeInterest).toBe(48);
    expect(stats.interestComplete).toBe(false);
    expect(stats.net).toBeUndefined();
    expect(statsRowValues(stats.totals, stats).borrowInterest).toBeUndefined();
    const row = statsCsv(stats).split('\r\n').at(-1)!.split(',');
    expect(row.slice(6)).toEqual(['48.00000000', '', '', '']);
  }
  const knownEmpty = calculateAccountStats(history(), 1, now);
  expect(knownEmpty.net).toBe(0);
  expect(knownEmpty.interestComplete).toBe(true);
});

test('invalid interest does not reverse a borrowing cost into a profit', () => {
  for (const bad of [{ borrow: -1 }, { supply: -1 }, { borrow: NaN }, { asset: '' }]) {
    expect(() => calculateAccountStats(history({ interest: [interest(bad)] }), 1, now)).toThrow('interest');
  }
});
