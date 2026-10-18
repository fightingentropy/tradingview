import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { loadPortfolioPreferences, savePortfolioPreferences, type PortfolioPreferences } from '../data/portfolioPreferences';
import { PORTFOLIO_PERIODS, livePortfolioPerformance, orderedPortfolioHistory, paperPortfolioPerformance, portfolioPeriod, portfolioSnapshot,
  type PaperPortfolioEquity, type PaperPortfolioTrade, type PortfolioSnapshots } from '../lib/portfolioPerformance';

const CHARTS = [{ id: 'accountValue', label: 'Account Value' }, { id: 'pnl', label: 'PNL' }] as const;
const money = (value?: number, signed = false) => value === undefined || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: signed ? 'exceptZero' : 'auto',
}).format(Math.abs(value) < .005 ? 0 : value);
const axisValue = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 });
const dateLabel = (time: number, period: string) => new Date(time).toLocaleString('en-GB', {
  timeZone: 'Europe/London', ...(period === '24h' ? { hour: '2-digit', minute: '2-digit' } : period === 'all' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }),
});
const fullDate = (time: number) => new Date(time).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const Chevron: Component = () => <svg class="pointer-events-none absolute right-2 h-3 w-3 text-brand-slate-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>;

const Metric: Component<{ label: string; value?: number; signed?: boolean; percent?: boolean; title?: string }> = props => <div class="flex items-center justify-between gap-4 text-sm" title={props.title}>
  <span class="text-brand-slate-400">{props.label}</span><span class="font-mono" classList={{ 'text-brand-green-400': !!props.signed && (props.value ?? 0) > 0,
    'text-brand-red-400': !!props.signed && (props.value ?? 0) < 0, 'text-slate-100': !props.signed || !props.value }}>
    {props.percent ? props.value === undefined ? '—' : `${props.value.toFixed(2)}%` : money(props.value, props.signed)}
  </span>
</div>;

const PortfolioPerformance: Component<{
  live: boolean; snapshots: PortfolioSnapshots; tradingEquity?: number;
  paperTrades: PaperPortfolioTrade[]; paperEquity?: PaperPortfolioEquity | null;
  loading?: boolean; active?: boolean;
}> = props => {
  const [view, setView] = createSignal(loadPortfolioPreferences());
  const [now, setNow] = createSignal(Date.now());
  const [selectedIndex, setSelectedIndex] = createSignal<number>();
  const scope = () => props.live ? view().scope : 'all';
  const select = (change: Partial<PortfolioPreferences>) => setView(current => ({ ...current, ...change }));
  createEffect(() => { savePortfolioPreferences(view()); setSelectedIndex(undefined); });
  createEffect(() => {
    if (props.active === false) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    onCleanup(() => window.clearInterval(timer));
  });
  const performance = createMemo(() => props.live
    ? livePortfolioPerformance(portfolioSnapshot(props.snapshots, view().period, scope()))
    : paperPortfolioPerformance(props.paperTrades, props.paperEquity, view().period, now()));
  const chartTitle = () => CHARTS.find(chart => chart.id === view().chart)!.label;
  const series = createMemo(() => orderedPortfolioHistory(view().chart === 'pnl' ? performance().pnlHistory : performance().accountValueHistory));
  const chart = createMemo(() => {
    const points = series(), start = points[0]?.time ?? now() - (portfolioPeriod(view().period).rangeMs ?? 30 * 86_400_000);
    const end = Math.max(points.at(-1)?.time ?? now(), start + 1);
    let min = points.length ? Math.min(...points.map(point => point.value)) : 0;
    let max = points.length ? Math.max(...points.map(point => point.value)) : 0;
    const padding = min === max ? Math.max(1, Math.abs(min) * .1) : (max - min) * .1;
    min -= padding; max += padding;
    const plot = points.map(point => ({ ...point, x: (point.time - start) / (end - start) * 100, y: (max - point.value) / (max - min) * 100 }));
    let path = plot.length ? `M${plot[0].x} ${plot[0].y}` : '';
    for (let index = 1; index < plot.length; index++) path += ` L${plot[index].x} ${plot[index - 1].y} L${plot[index].x} ${plot[index].y}`;
    return { plot, path, start, end, yTicks: Array.from({ length: 4 }, (_, index) => max - (max - min) * index / 3),
      xTicks: Array.from({ length: 5 }, (_, index) => start + (end - start) * index / 4) };
  });
  const activePoint = () => chart().plot[Math.min(selectedIndex() ?? chart().plot.length - 1, chart().plot.length - 1)];
  const highlightedPoint = () => selectedIndex() === undefined ? undefined : activePoint();
  const pointer = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    const bounds = event.currentTarget.getBoundingClientRect(), data = chart();
    const time = data.start + Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * (data.end - data.start);
    let nearest = 0;
    data.plot.forEach((point, index) => { if (Math.abs(point.time - time) < Math.abs(data.plot[nearest].time - time)) nearest = index; });
    if (data.plot.length) setSelectedIndex(nearest);
  };
  const keyboard = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !series().length) return;
    event.preventDefault();
    const last = series().length - 1, current = selectedIndex() ?? last;
    setSelectedIndex(event.key === 'Home' ? 0 : event.key === 'End' ? last : Math.max(0, Math.min(last, current + (event.key === 'ArrowLeft' ? -1 : 1))));
  };

  return <>
    <section class="portfolio-performance-card order-1 rounded-lg border border-brand-border bg-brand-surface lg:order-none" aria-label="Account performance" data-period={view().period} data-scope={scope()}>
      <div class="flex items-center justify-between gap-2 border-b border-brand-border px-3 py-2.5 text-sm">
        <div class="relative flex min-w-0 items-center" title={props.live ? 'Choose combined account history or perpetual futures only' : 'Account scope filters are available with live exchange history'}>
          <select aria-label="Portfolio account scope" title="Choose combined account history or perpetual futures only" class="min-w-0 appearance-none rounded bg-transparent py-1.5 pl-1 pr-7 font-medium text-slate-200 outline-none focus-visible:ring-1 focus-visible:ring-brand-accent"
            value={scope()} disabled={!props.live} onChange={event => select({ scope: event.currentTarget.value === 'perps' ? 'perps' : 'all' })}>
            <option class="bg-brand-surface" value="all">Combined account</option><option class="bg-brand-surface" value="perps">Perps only</option>
          </select><Chevron />
        </div>
        <div class="relative flex shrink-0 items-center">
          <select aria-label="Portfolio performance period" class="appearance-none rounded bg-transparent py-1.5 pl-2 pr-7 text-slate-200 outline-none focus-visible:ring-1 focus-visible:ring-brand-accent"
            value={view().period} onChange={event => { const period = PORTFOLIO_PERIODS.find(option => option.id === event.currentTarget.value); if (period) select({ period: period.id }); }}>
            <For each={PORTFOLIO_PERIODS}>{option => <option class="bg-brand-surface" value={option.id}>{option.label}</option>}</For>
          </select><Chevron />
        </div>
      </div>
      <div class="space-y-3 p-4">
        <Metric label="PNL" value={performance().pnl} signed title={props.live ? 'Change in exchange PnL over the selected period, including unrealized changes. Stats shows realized earnings separately.' : 'Realized paper-trading PnL after fees for this period. Open gains are excluded.'} />
        <Metric label="Volume" value={performance().volume} />
        <Metric label="Max Drawdown" value={performance().drawdown} percent title="Largest drop from a peak in the selected account value history. Deposits and withdrawals can affect this figure. Paper accounts have no historical equity snapshots." />
        <div class="border-t border-brand-border pt-3"><Metric label={scope() === 'perps' ? 'Perps Equity' : 'Total Equity'} value={performance().equity ?? (scope() === 'all' && props.live ? props.tradingEquity : undefined)} /></div>
        <Metric label="Trading Equity" value={props.live ? props.tradingEquity : props.paperEquity?.perpsEquity} />
        <p class="pt-1 text-[11px] leading-relaxed text-brand-slate-500">PNL, volume and chart use {portfolioPeriod(view().period).label}. Equity values are current.</p>
      </div>
      <Show when={performance().incomplete}><p class="mx-4 mb-4 text-xs leading-relaxed text-amber-300/80" role="status">The loaded paper trades do not cover this full period. Choose a shorter range.</p></Show>
    </section>

    <section class="portfolio-chart-panel order-2 min-w-0 rounded-lg border border-brand-border bg-brand-surface lg:order-none" aria-label="Portfolio history">
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-brand-border px-4">
        <div class="flex items-center gap-5" role="group" aria-label="Portfolio chart metric"><For each={CHARTS}>{option => <button type="button" aria-pressed={view().chart === option.id}
          class={`whitespace-nowrap border-b-2 py-3 text-sm font-medium ${view().chart === option.id ? 'border-brand-accent text-slate-100' : 'border-transparent text-brand-slate-400 hover:text-slate-200'}`}
          onClick={() => select({ chart: option.id })}>{option.label}</button>}</For></div>
        <div class="flex gap-1 py-2" role="group" aria-label="Portfolio chart time range"><For each={PORTFOLIO_PERIODS}>{option => <button type="button" aria-pressed={view().period === option.id}
          class={`rounded px-2 py-1 text-[11px] transition-colors focus-visible:outline-brand-accent ${view().period === option.id ? 'bg-brand-accent/10 text-brand-accent' : 'text-brand-slate-400 hover:text-slate-200'}`}
          onClick={() => select({ period: option.id })}>{option.label}</button>}</For></div>
      </div>
      <div class="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-3">
        <span class="text-[11px] text-brand-slate-500">{scope() === 'perps' ? 'Perps only' : 'Combined account'} · {portfolioPeriod(view().period).label}</span>
        <Show when={activePoint()}>{point => <div class="flex items-baseline gap-2 text-right" aria-live="polite" aria-atomic="true"><span class="text-[10px] text-brand-slate-500">{fullDate(point().time)}</span><strong class="font-mono text-sm font-medium text-slate-200">{money(point().value, view().chart === 'pnl')}</strong></div>}</Show>
      </div>
      <div class="relative h-[222px] px-4 pb-7 pt-4">
        <Show when={series().length}><div class="absolute bottom-8 left-4 top-4 flex w-14 flex-col justify-between pr-2 text-right font-mono text-[11px] text-brand-slate-500"><For each={chart().yTicks}>{tick => <span>{axisValue(tick)}</span>}</For></div></Show>
        <div class="absolute bottom-8 left-[72px] right-4 top-4 overflow-hidden border-b border-l border-brand-border focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand-accent" onPointerMove={pointer} onPointerLeave={() => setSelectedIndex(undefined)} onKeyDown={keyboard}
          tabindex={series().length ? 0 : -1} role="img" aria-label={`${chartTitle()} chart, ${portfolioPeriod(view().period).label}, ${scope() === 'perps' ? 'perps only' : 'combined account'}. Use arrow keys to inspect points.`}>
          <Show when={series().length}><div class="absolute inset-0 flex flex-col justify-between"><For each={chart().yTicks}>{() => <div class="h-0 border-b border-brand-border/40" />}</For></div></Show>
          <svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><Show when={chart().path}><path d={chart().path} fill="none" stroke="#e2e8f0" stroke-width="1.15" vector-effect="non-scaling-stroke" /></Show></svg>
          <Show when={highlightedPoint()}>{point => <><div class="pointer-events-none absolute inset-y-0 border-l border-brand-slate-500/60" style={{ left: `${point().x}%` }} /><div class="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-accent" style={{ left: `${point().x}%`, top: `${point().y}%` }} /></>}</Show>
          <Show when={!series().length}><div class="absolute inset-0 flex items-center justify-center px-3 text-center text-sm text-brand-slate-500">{props.loading ? 'Loading portfolio history…' : performance().incomplete ? 'Complete history is needed for this chart' : 'No history for this period'}</div></Show>
        </div>
        <Show when={series().length}><div class="absolute bottom-2 left-[72px] right-4 flex justify-between font-mono text-[10px] text-brand-slate-500"><For each={chart().xTicks}>{tick => <span>{dateLabel(tick, view().period)}</span>}</For></div></Show>
      </div>
      <Show when={performance().estimatedEquity && view().chart === 'accountValue'}><p class="px-4 pb-3 text-[10px] leading-relaxed text-brand-slate-500">Estimated from current paper equity and realized trades. Historical transfers and unrealized changes are unavailable.</p></Show>
    </section>
  </>;
};
export default PortfolioPerformance;
