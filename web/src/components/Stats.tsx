import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack, type Component } from 'solid-js';
import { calculateAccountStats, formatStatsAssetAmount, formatStatsDate, formatStatsUsd, statsCsv, statsDayKey, statsPeriodLabel, statsRowValues, STATS_PERIODS, type StatsHistory, type StatsPeriod, type StatsTotals } from '../lib/accountStats';
import { hyperliquidAccountRefreshError, hyperliquidConnection, hyperliquidPositions, isHyperliquidConnected, loadHyperliquidStatsHistory, refreshHyperliquidAccount } from '../stores/hyperliquidExecution';
import { openSettings } from '../stores/settings';
import { usePageActive } from './PageView';
import './Stats.css';

const tone = (value?: number) => value === undefined || Math.abs(value) < .005 ? 'neutral' : value > 0 ? 'positive' : 'negative';
const Money: Component<{ value?: number; signed?: boolean }> = props => <span class="stats-money" data-tone={tone(props.value)}>{formatStatsUsd(props.value, props.signed ?? true)}</span>;

export const StatsView: Component<{ history: StatsHistory; unrealized?: number }> = props => {
  const [period, setPeriod] = createSignal<StatsPeriod>(30);
  const [chartMetric, setChartMetric] = createSignal<'funding' | 'beforeInterest' | 'net'>('net');
  const chartLabel = () => chartMetric() === 'funding' ? 'net funding' : chartMetric() === 'beforeInterest' ? 'before interest' : 'net after interest';
  const [hoveredDay, setHoveredDay] = createSignal<string>();
  const [chartWidth, setChartWidth] = createSignal(900);
  const observeChart = (element: SVGSVGElement) => {
    const observer = new ResizeObserver(([entry]) => setChartWidth(Math.max(200, entry.contentRect.width)));
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };
  const stats = createMemo(() => calculateAccountStats(props.history, period(), props.history.updatedAt));
  const summary = createMemo(() => statsRowValues(stats().totals, stats()));
  const fundingPeriods = createMemo(() => ([1, 7, 30] as const).map(days => {
    const result = calculateAccountStats(props.history, days, props.history.updatedAt);
    return { days, value: result.fundingComplete ? result.totals.funding : undefined };
  }));
  const rangeLabel = () => `${formatStatsDate(stats().days[0].date)} – ${formatStatsDate(statsDayKey(props.history.updatedAt))}`;
  const activeDay = () => stats().days.find(day => day.date === hoveredDay()) ?? stats().days.at(-1)!;
  const chartReady = () => chartMetric() === 'funding' ? stats().fundingComplete : chartMetric() === 'beforeInterest' ? stats().beforeInterestComplete : stats().netComplete;
  const chart = createMemo(() => {
    const days = stats().days.map(day => ({ day, value: statsRowValues(day, stats())[chartMetric()] ?? 0 }));
    const low = Math.min(0, ...days.map(point => point.value)), high = Math.max(0, ...days.map(point => point.value));
    const padding = Math.max((high - low) * .12, .01), min = low - padding, max = high + padding;
    const y = (value: number) => 18 + (max - value) / (max - min) * 182;
    const step = (chartWidth() - 84) / days.length;
    return { days: days.map((point, index) => ({ ...point, x: 72 + index * step + step * .16, y: Math.min(y(point.value), y(0)), width: step * .68, height: Math.max(1, Math.abs(y(point.value) - y(0))) })),
      baseline: y(0), ticks: [max, (max + min) / 2, min].map(value => ({ value, y: y(value) })) };
  });
  createEffect(on(period, () => setHoveredDay(undefined)));
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([statsCsv(stats())], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `trading-stats-${stats().days[0].date}-${statsDayKey(props.history.updatedAt)}.csv`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const values = (row: StatsTotals) => statsRowValues(row, stats());
  const winRate = () => stats().futuresComplete && stats().totals.closes > 0 ? `${(stats().totals.wins / stats().totals.closes * 100).toFixed(1)}%` : '—';

  return <>
    <section aria-labelledby="stats-funding-title" class="stats-funding-section">
      <div class="stats-section-heading"><h2 id="stats-funding-title">Funding income</h2><span>Before borrowing costs</span></div>
      <div class="stats-funding-cards"><For each={fundingPeriods()}>{entry => <button class="stats-funding-card" aria-pressed={period() === entry.days} onClick={() => setPeriod(entry.days)}>
        <span>{statsPeriodLabel(entry.days)}</span><strong><Money value={entry.value} /></strong><span class="stats-card-note">Received minus paid</span>
      </button>}</For></div>
    </section>

    <div class="stats-period-row"><div><h2>Performance</h2><p>{rangeLabel()} <span>· London time, including today</span></p></div>
      <div class="stats-periods" role="group" aria-label="Statistics period"><For each={STATS_PERIODS}>{days => <button aria-pressed={period() === days} onClick={() => setPeriod(days)}>{days === 1 ? 'Today' : `${days}D`}</button>}</For></div>
    </div>
    <Show when={!props.history.fillsComplete}><p class="stats-notice" role="status">Trade history is incomplete. Trading and combined totals are unavailable.</p></Show>
    <Show when={props.history.fillsComplete && !stats().tradingComplete}><p class="stats-notice" role="status">Available trade history starts on {formatStatsDate(statsDayKey(props.history.fillCoverageStart))}. Trading totals for the full selected period are unavailable.</p></Show>
    <Show when={stats().totals.unknownSpotSales > 0}><p class="stats-notice" role="status">Purchase cost is missing for {stats().totals.unknownSpotSales} spot {stats().totals.unknownSpotSales === 1 ? 'sale' : 'sales'}. Spot and combined totals are unavailable for affected days.</p></Show>
    <Show when={stats().totals.unpricedFutures + stats().totals.unpricedSpot + stats().totals.unpricedFees > 0}><p class="stats-notice" role="status">Some trades or fees use currencies other than USDC or the traded spot asset. Totals that need those conversions are unavailable.</p></Show>
    <Show when={!stats().fundingComplete}><p class="stats-notice" role="status">Funding history is incomplete. Funding and combined totals are unavailable.</p></Show>
    <Show when={!stats().interestComplete}><p class="stats-notice" role="status">Interest history is incomplete. Borrowing costs, lending income and net after interest are unavailable. Before-interest earnings are shown where their history is complete.</p></Show>
    <div class="stats-results" aria-label="Realized USDC earnings">
      <div class="stats-result"><span>Before interest</span><strong><Money value={summary().beforeInterest} /></strong><small>Funding + realized trading, after fees</small></div>
      <div class="stats-result"><span>Borrowing interest</span><strong><Money value={summary().borrowInterest === undefined ? undefined : -summary().borrowInterest!} /></strong><small>USDC borrowing costs</small></div>
      <div class="stats-result"><span>Lending interest</span><strong><Money value={summary().lendInterest} /></strong><small>USDC interest earned</small></div>
      <div class="stats-result stats-result-total"><span>Net after interest</span><strong><Money value={summary().net} /></strong><small>Before interest − borrowing + lending</small></div>
    </div>
    <p class="stats-result-note">Realized USDC results. Open-position value changes are excluded. Portfolio PnL includes those changes and uses the exchange’s snapshot dates.</p>

    <div class="stats-analysis-grid">
      <section class="stats-chart-panel" aria-labelledby="stats-chart-title">
        <div class="stats-panel-heading"><h2 id="stats-chart-title">Daily performance</h2><div role="group" aria-label="Daily chart metric" class="stats-chart-switch">
          <button aria-pressed={chartMetric() === 'funding'} onClick={() => setChartMetric('funding')}>Funding</button><button aria-pressed={chartMetric() === 'beforeInterest'} onClick={() => setChartMetric('beforeInterest')}>Before interest</button><button aria-pressed={chartMetric() === 'net'} onClick={() => setChartMetric('net')}>After interest</button>
        </div></div>
        <Show when={chartReady()} fallback={<div class="stats-chart-empty">Complete history is needed for this chart.</div>}>
          <svg ref={observeChart} class="stats-chart" height="232" viewBox={`0 0 ${chartWidth()} 232`} role="img" aria-label={`Daily ${chartLabel()} in USDC`}>
            <For each={chart().ticks}>{tick => <g><line x1="72" x2={chartWidth() - 12} y1={tick.y} y2={tick.y} class="stats-grid-line" /><text x="60" y={tick.y + 4} text-anchor="end">{formatStatsUsd(tick.value, false)}</text></g>}</For>
            <line x1="72" x2={chartWidth() - 12} y1={chart().baseline} y2={chart().baseline} class="stats-zero-line" />
            <For each={chart().days}>{point => <rect x={point.x} y={point.y} width={point.width} height={point.height} rx="1.5" class="stats-bar" data-tone={tone(point.value)} data-selected={hoveredDay() === point.day.date} tabindex="0"
              aria-label={`${formatStatsDate(point.day.date)}: ${formatStatsUsd(point.value)}`} onPointerEnter={() => setHoveredDay(point.day.date)} onFocus={() => setHoveredDay(point.day.date)}>
              <title>{formatStatsDate(point.day.date)}: {formatStatsUsd(point.value)}</title></rect>}</For>
            <text x="72" y="225">{formatStatsDate(stats().days[0].date)}</text><text x={(chartWidth() + 60) / 2} y="225" text-anchor="middle">{period() > 1 ? formatStatsDate(stats().days[Math.floor(period() / 2)].date) : ''}</text><text x={chartWidth() - 12} y="225" text-anchor="end">{period() > 1 ? formatStatsDate(stats().days.at(-1)!.date) : ''}</text>
          </svg>
          <div class="stats-chart-readout" aria-live="polite"><span>{formatStatsDate(activeDay().date)}</span><strong><Money value={values(activeDay())[chartMetric()]} /></strong><span>{chartLabel()}</span></div>
        </Show>
      </section>
      <section class="stats-details" aria-labelledby="stats-details-title"><h2 id="stats-details-title">At a glance</h2><dl>
        <div><dt>Futures trading <span title="Closed PnL less trading fees, including fees for opening positions.">ⓘ</span></dt><dd><Money value={summary().futures} /></dd></div>
        <div><dt>Spot trading <span title="Realized first-in, first-out profit, including fees attributed to sold units.">ⓘ</span></dt><dd><Money value={summary().spot} /></dd></div>
        <div><dt>Funding received</dt><dd><Money value={stats().fundingComplete ? stats().totals.fundingReceived : undefined} signed={false} /></dd></div>
        <div><dt>Funding paid</dt><dd>{formatStatsUsd(stats().fundingComplete ? stats().totals.fundingPaid : undefined, false)}</dd></div>
        <div><dt>Funding per day</dt><dd><Money value={stats().fundingComplete ? stats().totals.funding / period() : undefined} /></dd></div>
        <div><dt>Trading fees <span title="Includes maker rebates. Spot fees paid in the base asset are valued at the fill price.">ⓘ</span></dt><dd>{formatStatsUsd(summary().fees, false)}</dd></div>
        <div><dt>Trading volume</dt><dd>{formatStatsUsd(stats().tradingComplete && !stats().totals.unpricedFutures && !stats().totals.unpricedSpot ? stats().totals.volume : undefined, false)}</dd></div>
        <div><dt>Futures win rate <span title="Share of profitable closing fills, before fees. Partial closes count separately.">ⓘ</span></dt><dd>{winRate()}</dd></div>
        <div><dt>Trade fills</dt><dd>{stats().tradingComplete ? stats().totals.fills.toLocaleString('en-GB') : '—'}</dd></div>
        <div class="stats-open-pnl"><dt>Open futures PnL <span title="Current unrealized PnL. Excluded from realized earnings and unaffected by the selected history period.">ⓘ</span></dt><dd><Money value={props.unrealized} /></dd></div>
      </dl></section>
    </div>

    <section class="stats-table-section" aria-labelledby="stats-daily-title"><div class="stats-panel-heading"><div><h2 id="stats-daily-title">Day by day</h2><p>Realized USDC results, with interest separated</p></div><button class="stats-text-button" onClick={exportCsv}>Export CSV <span aria-hidden="true">↗</span></button></div>
      <div class="stats-table-scroll"><table><thead><tr><th scope="col">Date</th><th scope="col">Funding received</th><th scope="col">Funding paid</th><th scope="col">Net funding</th><th scope="col">Futures</th><th scope="col">Spot</th><th scope="col">Before interest</th><th scope="col">Borrowing costs</th><th scope="col">Lending income</th><th scope="col">Net after interest</th></tr></thead>
        <tbody><For each={[...stats().days].reverse()}>{day => <tr><th scope="row">{formatStatsDate(day.date)}<Show when={day.date === statsDayKey(props.history.updatedAt)}><span class="stats-today">Today</span></Show></th>
          <td>{formatStatsUsd(stats().fundingComplete ? day.fundingReceived : undefined, false)}</td><td>{formatStatsUsd(stats().fundingComplete ? day.fundingPaid : undefined, false)}</td>
          <td><Money value={values(day).funding} /></td><td><Money value={values(day).futures} /></td><td><Money value={values(day).spot} /></td><td><Money value={values(day).beforeInterest} /></td><td>{formatStatsUsd(values(day).borrowInterest, false)}</td><td><Money value={values(day).lendInterest} /></td><td><Money value={values(day).net} /></td></tr>}</For></tbody>
        <tfoot><tr><th scope="row">Total</th><td>{formatStatsUsd(stats().fundingComplete ? stats().totals.fundingReceived : undefined, false)}</td><td>{formatStatsUsd(stats().fundingComplete ? stats().totals.fundingPaid : undefined, false)}</td><td><Money value={summary().funding} /></td><td><Money value={summary().futures} /></td><td><Money value={summary().spot} /></td><td><Money value={summary().beforeInterest} /></td><td>{formatStatsUsd(summary().borrowInterest, false)}</td><td><Money value={summary().lendInterest} /></td><td><Money value={summary().net} /></td></tr></tfoot>
      </table></div>
    </section>
    <Show when={stats().markets.length}><section class="stats-table-section" aria-labelledby="stats-markets-title"><div class="stats-panel-heading"><h2 id="stats-markets-title">By market and interest asset</h2><span>{statsPeriodLabel(period())}</span></div><div class="stats-table-scroll"><table><thead><tr><th scope="col">Market / asset</th><th scope="col">Net funding</th><th scope="col">Futures</th><th scope="col">Spot</th><th scope="col">Before interest</th><th scope="col">Borrowing costs</th><th scope="col">Lending income</th><th scope="col">Net after interest</th><th scope="col">Fills</th></tr></thead><tbody><For each={stats().markets}>{market => <tr><th scope="row">{market.symbol}</th><td><Money value={values(market).funding} /></td><td><Money value={values(market).futures} /></td><td><Money value={values(market).spot} /></td><td><Money value={values(market).beforeInterest} /></td><td>{formatStatsUsd(values(market).borrowInterest, false)}</td><td><Money value={values(market).lendInterest} /></td><td><Money value={values(market).net} /></td><td>{market.fills}</td></tr>}</For></tbody></table></div></section></Show>
    <Show when={stats().interestByAsset.length}><section class="stats-table-section" aria-labelledby="stats-interest-title"><div class="stats-panel-heading"><div><h2 id="stats-interest-title">Interest by asset</h2><p>Native asset amounts. Only USDC interest is included in the earnings totals above.</p></div></div><div class="stats-table-scroll"><table><thead><tr><th scope="col">Asset</th><th scope="col">Borrowing paid</th><th scope="col">Lending earned</th><th scope="col">Net interest</th></tr></thead><tbody><For each={stats().interestByAsset}>{asset => <tr><th scope="row">{asset.asset}</th><td>{formatStatsAssetAmount(stats().interestComplete ? asset.borrow : undefined)}</td><td>{formatStatsAssetAmount(stats().interestComplete ? asset.supply : undefined)}</td><td>{formatStatsAssetAmount(stats().interestComplete ? asset.supply - asset.borrow : undefined)}</td></tr>}</For></tbody></table></div></section></Show>
    <footer class="stats-methodology"><strong>How these numbers work</strong><p>Headline amounts and CSV totals are in USDC. Before interest is net funding plus realized futures and spot results after their trading fees. Net after interest subtracts USDC borrowing costs and adds USDC lending income. Interest in other assets appears in its native units in Interest by asset; it is not converted or included in the USDC totals.</p><p>Periods use London calendar days and exchange entry timestamps, including today. Older funding and interest entries may be daily aggregates. Futures results subtract fees from closed PnL; opening fees count on their trade date. Spot results use first-in, first-out purchase costs and include fees attributed to sold units. Deposits, withdrawals and open-position value changes are excluded. Portfolio includes open value changes and uses different snapshot boundaries, so its PnL can differ.</p><p>Missing history or purchase costs show as —, including in dependent totals. Trading fees are already included and are not subtracted twice. Funding per day includes days with no payments.</p></footer>
  </>;
};

const Stats: Component = () => {
  const active = usePageActive();
  const [history, setHistory] = createSignal<StatsHistory>();
  const [loading, setLoading] = createSignal(false), [error, setError] = createSignal('');
  let controller: AbortController | undefined;
  createEffect(on(() => hyperliquidConnection()?.masterAddress, () => { controller?.abort(); setHistory(undefined); setError(''); setLoading(false); }));
  const refresh = async (force = false) => {
    const account = hyperliquidConnection();
    if (!account || !isHyperliquidConnected() || loading()) return;
    const previous = history();
    if (!force && previous && Date.now() - previous.updatedAt < 60_000) return;
    const request = new AbortController(); controller = request; setLoading(true);
    void refreshHyperliquidAccount();
    try {
      const snapshot = await loadHyperliquidStatsHistory(request.signal, previous);
      if (!request.signal.aborted && hyperliquidConnection()?.masterAddress === account.masterAddress && isHyperliquidConnected()) { setHistory(snapshot); setError(''); }
    } catch {
      if (!request.signal.aborted) setError('Could not refresh account statistics. Please try again.');
    } finally { if (controller === request) setLoading(false); }
  };
  createEffect(() => {
    if (!active() || !isHyperliquidConnected()) return;
    hyperliquidConnection()?.masterAddress;
    untrack(() => void refresh());
    const timer = window.setInterval(() => void refresh(), 60_000);
    const focus = () => void refresh(); window.addEventListener('focus', focus);
    onCleanup(() => { window.clearInterval(timer); window.removeEventListener('focus', focus); controller?.abort(); controller = undefined; setLoading(false); });
  });
  const unrealized = () => hyperliquidAccountRefreshError() ? undefined : hyperliquidPositions().reduce((sum, position) => sum + position.unrealizedPnl, 0);
  return <main class="stats-page" aria-labelledby="stats-title"><div class="stats-frame">
    <header class="stats-masthead"><div><h1 id="stats-title">Stats</h1><p>Funding & trading performance <Show when={hyperliquidConnection()}>{account => <span>· {account().masterAddress.slice(0, 6)}…{account().masterAddress.slice(-4)}</span>}</Show></p></div><Show when={isHyperliquidConnected()}><div class="stats-refresh-area"><Show when={history()}>{snapshot => <span>Updated {new Date(snapshot().updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}</span>}</Show><button class="stats-refresh" onClick={() => void refresh(true)} disabled={loading()}>{loading() ? 'Refreshing…' : 'Refresh'}</button></div></Show></header>
    <Show when={isHyperliquidConnected()} fallback={<div class="stats-connect"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 20h16M7 16v-5M12 16V5M17 16V8" /></svg><h2>Your performance, in one place</h2><p>Connect your Hyperliquid account to see funding, trading results, borrowing costs, and earnings before and after interest.</p><button onClick={openSettings}>Connect account</button></div>}>
      <Show when={error()}><p class="stats-notice" role="status">{error()}<Show when={history()}> Showing the last loaded statistics.</Show><button onClick={() => void refresh(true)} disabled={loading()}>Retry</button></p></Show>
      <Show when={history()} fallback={<Show when={loading()}><div class="stats-loading" role="status"><span class="stats-spinner" />Loading funding, trade and interest history…</div></Show>}>{snapshot => <StatsView history={snapshot()} unrealized={unrealized()} />}</Show>
    </Show>
  </div></main>;
};
export default Stats;
