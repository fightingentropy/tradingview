import { expect, test } from 'bun:test';
import { PORTFOLIO_PERIODS, livePortfolioPerformance, paperPortfolioPerformance, portfolioSnapshot, type PortfolioSnapshots, type PaperPortfolioTrade } from './portfolioPerformance';
import { loadPortfolioPreferences, savePortfolioPreferences } from '../data/portfolioPreferences';

const snapshot = (pnl: number, volume = 100, equity = 1000) => ({
  accountValueHistory: [{ time: 1, value: equity - pnl }, { time: 2, value: equity }],
  pnlHistory: [{ time: 1, value: 5000 }, { time: 2, value: 5000 + pnl }], volume,
});

test('each period and account scope selects its own exchange history and volume', () => {
  const snapshots: PortfolioSnapshots = {};
  PORTFOLIO_PERIODS.forEach((period, index) => {
    snapshots[period.combined] = snapshot((index + 1) * 100, (index + 1) * 1000, 20000);
    snapshots[period.perps] = snapshot((index + 1) * -50, (index + 1) * 300, 12000);
  });
  PORTFOLIO_PERIODS.forEach((period, index) => {
    const combined = livePortfolioPerformance(portfolioSnapshot(snapshots, period.id, 'all'));
    const perps = livePortfolioPerformance(portfolioSnapshot(snapshots, period.id, 'perps'));
    expect(combined.pnl).toBe((index + 1) * 100);
    expect(perps.pnl).toBe((index + 1) * -50);
    expect(combined.volume).toBe((index + 1) * 1000);
    expect(perps.volume).toBe((index + 1) * 300);
    expect(combined.equity).toBe(20000);
    expect(perps.equity).toBe(12000);
  });
});

test('period PnL is the change from its first sample, rather than lifetime cumulative PnL', () => {
  const input = snapshot(0);
  input.pnlHistory = [{ time: 3, value: 4800 }, { time: 1, value: 5000 }, { time: 2, value: 5100 }, { time: 2, value: 5200 }];
  const result = livePortfolioPerformance(input);
  expect(result.pnl).toBe(-200);
  expect(result.pnlHistory).toEqual([{ time: 1, value: 0 }, { time: 2, value: 200 }, { time: 3, value: -200 }]);
  expect(input.pnlHistory[0].value).toBe(4800);
});

test('drawdown follows peaks in the selected account curve and missing history stays unavailable', () => {
  const input = snapshot(0);
  input.accountValueHistory = [100, 120, 90, 110, 80].map((value, time) => ({ time, value }));
  expect(livePortfolioPerformance(input).drawdown).toBeCloseTo(100 / 3, 8);
  const empty = livePortfolioPerformance(undefined);
  expect(empty.pnl).toBeUndefined();
  expect(empty.drawdown).toBeUndefined();
  expect(empty.volume).toBeUndefined();
  const single = livePortfolioPerformance({ ...input, accountValueHistory: [{ time: 1, value: 100 }], pnlHistory: [{ time: 1, value: 50 }] });
  expect(single.pnl).toBeUndefined();
  expect(single.drawdown).toBeUndefined();
  expect(single.equity).toBe(100);
});

const now = Date.parse('2026-10-11T12:00:00Z');
const day = 86_400_000;
const trade = (overrides: Partial<PaperPortfolioTrade> = {}): PaperPortfolioTrade => ({ createdAt: now - 1000, symbol: 'BTC', pnl: 100, fee: 2, notional: 500, ...overrides });
const equity = { totalEquity: 10000, perpsEquity: 8000 };

test('paper PnL and volume follow the same rolling time range as the chart, including fees', () => {
  const trades = [trade({ createdAt: now - 2 * day, pnl: 300 }), trade(), trade({ symbol: 'HYPE/USDC', pnl: 25, fee: 1, notional: 200 }), trade({ createdAt: now + 1, pnl: 999 })];
  const daily = paperPortfolioPerformance(trades, equity, '24h', now);
  expect(daily.pnl).toBe(122);
  expect(daily.volume).toBe(700);
  expect(daily.pnlHistory[0]).toEqual({ time: now - day, value: 0 });
  expect(daily.pnlHistory.at(-1)?.value).toBe(122);
  expect(daily.accountValueHistory.at(-1)?.value).toBe(10000);
  expect(daily.estimatedEquity).toBe(true);
  expect(daily.drawdown).toBeUndefined();
  const weekly = paperPortfolioPerformance(trades, equity, '7d', now);
  expect(weekly.pnl).toBe(420);
  expect(weekly.volume).toBe(1200);
});

test('paper base-symbol trades retain combined volume without guessing a market type', () => {
  const result = paperPortfolioPerformance([trade(), trade({ symbol: 'HYPE', pnl: 0, notional: 900, fee: 0 })], equity, '7d', now);
  expect(result.pnl).toBe(98);
  expect(result.volume).toBe(1400);
  expect(result.equity).toBe(10000);
});

test('all-time paper history starts before the earliest trade even when returned newest first', () => {
  const result = paperPortfolioPerformance([trade(), trade({ createdAt: now - 100 * day, pnl: 50 })], equity, 'all', now);
  expect(result.pnl).toBe(146);
  expect(result.pnlHistory[0]).toEqual({ time: now - 100 * day - 1, value: 0 });
  expect(result.pnlHistory.at(-1)?.value).toBe(result.pnl);
});

test('capped paper history never masquerades as full-period performance', () => {
  const trades = [trade({ createdAt: now - 2 * day }), trade({ createdAt: now - day }), trade()];
  const all = paperPortfolioPerformance(trades, equity, 'all', now, 3);
  expect(all.incomplete).toBe(true);
  expect(all.pnl).toBeUndefined();
  expect(all.pnlHistory).toEqual([]);
  expect(all.equity).toBe(10000);
  expect(paperPortfolioPerformance(trades, equity, '7d', now, 3).incomplete).toBe(true);
  expect(paperPortfolioPerformance(trades, equity, '24h', now, 3).pnl).toBe(196);
  const boundary = [trade({ createdAt: now - day }), trade(), trade()];
  expect(paperPortfolioPerformance(boundary, equity, '24h', now, 3).incomplete).toBe(true);
});

test('a missing paper account is unavailable while an empty known account has zero period activity', () => {
  expect(paperPortfolioPerformance([], null, '30d', now).pnl).toBeUndefined();
  const empty = paperPortfolioPerformance([], equity, '30d', now);
  expect(empty.pnl).toBe(0);
  expect(empty.volume).toBe(0);
  expect(empty.accountValueHistory.every(point => point.value === 10000)).toBe(true);
});

test('saved portfolio choices round-trip, and corrupt or unavailable storage uses usable defaults', () => {
  let saved = '';
  savePortfolioPreferences({ period: '7d', scope: 'perps', chart: 'pnl' }, { setItem: (_key, value) => { saved = value; } });
  expect(loadPortfolioPreferences({ getItem: () => saved })).toEqual({ period: '7d', scope: 'perps', chart: 'pnl' });
  expect(loadPortfolioPreferences({ getItem: () => '{broken' })).toEqual({ period: '30d', scope: 'all', chart: 'accountValue' });
  expect(loadPortfolioPreferences({ getItem: () => '{"period":"invalid","scope":"perps","chart":17}' })).toEqual({ period: '30d', scope: 'perps', chart: 'accountValue' });
  expect(loadPortfolioPreferences({ getItem: () => { throw Error('blocked'); } }).period).toBe('30d');
});
