import { useState } from 'react';

import { EquityCurve } from '@/components/EquityCurve';
import { useHlPortfolio } from '@/data/useHlAccount';
import { accountReadState } from '@/lib/accountReadState';
import { signedUsd, usd } from '@/lib/format';
import type { HlPortfolioPeriodKey } from '@/lib/hyperliquid/info';
import { portfolioWindowMetrics, rebasedPnl } from '@/lib/portfolioMetrics';

export const PORTFOLIO_PERIODS: { key: HlPortfolioPeriodKey; label: string }[] = [
  { key: 'day', label: '24H' }, { key: 'week', label: '7D' }, { key: 'month', label: '30D' }, { key: 'allTime', label: 'All' },
];
export type PortfolioChartMode = 'account' | 'pnl' | 'perps';
export const PORTFOLIO_MODES: { key: PortfolioChartMode; label: string }[] = [
  { key: 'account', label: 'Account value' }, { key: 'pnl', label: 'PNL' }, { key: 'perps', label: 'Perps PNL' },
];

export function PortfolioCard({ hidden }: { hidden: boolean; compact?: boolean }) {
  const query = useHlPortfolio();
  const readState = accountReadState(query, 120_000);
  const [period, setPeriod] = useState<HlPortfolioPeriodKey>('month');
  const [mode, setMode] = useState<PortfolioChartMode>('account');
  const reportedWindow = mode === 'perps' ? query.data?.perps?.[period] : query.data?.[period];
  const window = reportedWindow?.available === true ? reportedWindow : undefined;
  const metrics = portfolioWindowMetrics(window);
  const points = mode === 'account' ? window?.accountValue ?? [] : rebasedPnl(window?.pnl ?? []);
  const color = mode === 'account' || (metrics.pnl ?? 0) >= 0 ? 'var(--web-accent)' : 'var(--web-down)';
  const amount = (value: number | null, signed = false) => value == null ? '—' : hidden ? '••••' : signed ? signedUsd(value) : `${value < 0 ? '−' : ''}${usd(value)}`;

  return (
    <section className="account-chart-card">
      <header className="account-chart-toolbar">
        <div className="account-chart-modes" aria-label="Portfolio chart metric">{PORTFOLIO_MODES.map((item) => <button type="button" key={item.key} aria-pressed={mode === item.key} className={mode === item.key ? 'is-active' : ''} onClick={() => setMode(item.key)}>{item.label}</button>)}</div>
        <div className="account-chart-periods" aria-label="Portfolio chart period">{PORTFOLIO_PERIODS.map((item) => <button type="button" key={item.key} aria-pressed={period === item.key} className={period === item.key ? 'is-active' : ''} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>
      </header>
      <div className="account-chart-metrics">
        <div><span>Period PNL</span><strong className={metrics.pnl == null ? '' : metrics.pnl >= 0 ? 'is-up' : 'is-down'}>{amount(metrics.pnl, true)}</strong></div>
        <div><span>Volume</span><strong>{amount(metrics.volume)}</strong></div>
      </div>
      {query.isPending ? <div className="account-chart-empty">Loading portfolio history…</div> : points.length >= 2 ? <EquityCurve points={points} color={color} hidden={hidden} /> : <div className="account-chart-empty"><span>{query.isError ? 'Portfolio history unavailable' : !window ? 'This history is unavailable' : 'Not enough history yet'}</span>{query.isError || !window ? <button type="button" onClick={() => void query.refetch()}>Retry</button> : null}</div>}
      {readState === 'stale' && points.length >= 2 ? <div className="account-read-status is-stale"><span>Showing the last available portfolio history.</span><button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry</button></div> : null}
      <footer className="account-chart-footer"><p>{mode === 'account' ? 'Account value includes deposits and withdrawals.' : 'PNL shows the change in performance for this period.'}</p><span>Max PNL decline <strong>{amount(metrics.maxPnlDrawdown)}</strong></span></footer>
    </section>
  );
}
