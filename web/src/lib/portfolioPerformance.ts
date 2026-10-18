import type { HyperliquidPortfolioPeriod, HyperliquidPortfolioSnapshot } from './hyperliquidExecutionTypes';

export const PORTFOLIO_PERIODS = [
  { id: '24h', label: '24h', combined: 'day', perps: 'perpDay', rangeMs: 86_400_000 },
  { id: '7d', label: '7D', combined: 'week', perps: 'perpWeek', rangeMs: 7 * 86_400_000 },
  { id: '30d', label: '30D', combined: 'month', perps: 'perpMonth', rangeMs: 30 * 86_400_000 },
  { id: 'all', label: 'All-time', combined: 'allTime', perps: 'perpAllTime', rangeMs: undefined },
] as const;
export type PortfolioPeriod = typeof PORTFOLIO_PERIODS[number]['id'];
export type PortfolioScope = 'all' | 'perps';
export type PortfolioChart = 'accountValue' | 'pnl';
export type PortfolioPoint = { time: number; value: number };
export type PortfolioSnapshots = Partial<Record<HyperliquidPortfolioPeriod, HyperliquidPortfolioSnapshot>>;
export type PaperPortfolioTrade = { createdAt: number; symbol: string; pnl: number; fee: number; notional: number };
export type PaperPortfolioEquity = { totalEquity: number; perpsEquity: number };
export type PortfolioPerformanceData = {
  accountValueHistory: PortfolioPoint[]; pnlHistory: PortfolioPoint[];
  pnl?: number; volume?: number; drawdown?: number; equity?: number;
  incomplete: boolean; estimatedEquity: boolean;
};

export const portfolioPeriod = (id: PortfolioPeriod) => PORTFOLIO_PERIODS.find(option => option.id === id)!;
export function portfolioSnapshot(snapshots: PortfolioSnapshots, period: PortfolioPeriod, scope: PortfolioScope) {
  const option = portfolioPeriod(period);
  return snapshots[scope === 'perps' ? option.perps : option.combined];
}

export function orderedPortfolioHistory(points: PortfolioPoint[]): PortfolioPoint[] {
  return [...new Map(points.filter(point => Number.isFinite(point.time) && Number.isFinite(point.value))
    .map(point => [point.time, point])).values()].sort((a, b) => a.time - b.time);
}

export function portfolioDrawdown(history: PortfolioPoint[]): number | undefined {
  if (history.length < 2) return undefined;
  let peak = 0, largest = 0;
  for (const point of history) {
    peak = Math.max(peak, point.value);
    if (peak > 0) largest = Math.max(largest, (peak - point.value) / peak);
  }
  return peak > 0 ? largest * 100 : undefined;
}

export function livePortfolioPerformance(snapshot: HyperliquidPortfolioSnapshot | undefined): PortfolioPerformanceData {
  const accountValueHistory = orderedPortfolioHistory(snapshot?.accountValueHistory ?? []);
  const cumulativePnl = orderedPortfolioHistory(snapshot?.pnlHistory ?? []);
  const baseline = cumulativePnl[0]?.value ?? 0;
  const pnlHistory = cumulativePnl.length > 1 ? cumulativePnl.map(point => ({ ...point, value: point.value - baseline })) : [];
  return {
    accountValueHistory, pnlHistory, pnl: pnlHistory.at(-1)?.value,
    volume: snapshot && Number.isFinite(snapshot.volume) ? snapshot.volume : undefined,
    drawdown: portfolioDrawdown(accountValueHistory), equity: accountValueHistory.at(-1)?.value,
    incomplete: false, estimatedEquity: false,
  };
}

export function paperPortfolioPerformance(trades: PaperPortfolioTrade[], equity: PaperPortfolioEquity | null | undefined,
  period: PortfolioPeriod, now: number, historyLimit = 500): PortfolioPerformanceData {
  const empty: PortfolioPerformanceData = { accountValueHistory: [], pnlHistory: [], incomplete: false, estimatedEquity: false };
  if (!equity) return empty;
  const available = trades.filter(trade => Number.isFinite(trade.createdAt) && trade.createdAt <= now).slice().sort((a, b) => a.createdAt - b.createdAt);
  const range = portfolioPeriod(period).rangeMs;
  const start = range ? now - range : (available[0] ? available[0].createdAt - 1 : now - 30 * 86_400_000);
  const incomplete = trades.length >= historyLimit && (!range || (available[0]?.createdAt ?? now) >= start);
  const currentEquity = equity.totalEquity;
  if (incomplete) return { ...empty, equity: currentEquity, incomplete: true };
  const selected = available.filter(trade => trade.createdAt >= start);
  let pnl = 0, volume = 0;
  const pnlHistory: PortfolioPoint[] = [{ time: start, value: 0 }];
  for (const trade of selected) {
    pnl += trade.pnl - trade.fee;
    volume += trade.notional;
    pnlHistory.push({ time: trade.createdAt, value: pnl });
  }
  pnlHistory.push({ time: now, value: pnl });
  // Paper accounts have trade history, but no historical equity snapshots.
  const accountValueHistory = pnlHistory.map(point => ({ ...point, value: currentEquity - pnl + point.value }));
  return { accountValueHistory, pnlHistory, pnl, volume, equity: currentEquity, incomplete: false, estimatedEquity: true };
}
