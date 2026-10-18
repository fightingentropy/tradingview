import { PORTFOLIO_PERIODS, type PortfolioPeriod, type PortfolioScope, type PortfolioChart } from '../lib/portfolioPerformance';

export const PORTFOLIO_PREFERENCES_KEY = 'tradingview.portfolio.view.v1';
export type PortfolioPreferences = { period: PortfolioPeriod; scope: PortfolioScope; chart: PortfolioChart };
export function loadPortfolioPreferences(storage?: Pick<Storage, 'getItem'>): PortfolioPreferences {
  const defaults: PortfolioPreferences = { period: '30d', scope: 'all', chart: 'accountValue' };
  try {
    const raw = (storage ?? window.localStorage).getItem(PORTFOLIO_PREFERENCES_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
    return {
      period: PORTFOLIO_PERIODS.some(option => option.id === saved.period) ? saved.period : defaults.period,
      scope: saved.scope === 'all' || saved.scope === 'perps' ? saved.scope : defaults.scope,
      chart: saved.chart === 'accountValue' || saved.chart === 'pnl' ? saved.chart : defaults.chart,
    };
  } catch { return defaults; }
}
export function savePortfolioPreferences(preferences: PortfolioPreferences, storage?: Pick<Storage, 'setItem'>) {
  try { (storage ?? window.localStorage).setItem(PORTFOLIO_PREFERENCES_KEY, JSON.stringify(preferences)); }
  catch { /* Selection still works when storage is unavailable. */ }
}
