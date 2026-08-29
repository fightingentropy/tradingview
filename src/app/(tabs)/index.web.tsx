import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';

import { WebMarketChart } from '@/components/web/WebMarketChart';
import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useCandles } from '@/data/useCandles';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useInstrumentsByIds, useMarkets } from '@/data/useMarkets';
import type { CandleInterval, Instrument, Quote } from '@/domain/types';
import { formatCompact, formatFundingApr, formatPercent, formatPrice, priceDecimalsFor } from '@/lib/format';
import { useLivePrice } from '@/store/livePrices';
import { useWatchlists } from '@/store/watchlists';

type DeskTab = 'overview' | 'gainers' | 'losers';

const CHART_INTERVALS: { label: string; value: CandleInterval }[] = [
  { label: '1m', value: '1m' },
  { label: '15m', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
];

function MarketRow({
  instrument,
  quote,
  active,
  onSelect,
}: {
  instrument: Instrument;
  quote?: Quote;
  active: boolean;
  onSelect: () => void;
}) {
  const streamed = useLivePrice(instrument.coinKey);
  const last = streamed ?? quote?.last;
  const change = quote?.change24hPct;
  return (
    <button className={`web-watch-row${active ? ' is-active' : ''}`} onClick={onSelect} type="button">
      <span className="web-watch-identity">
        <WebSymbolMark symbol={instrument.symbol} />
        <span><strong>{instrument.symbol}</strong><small>{instrument.venue}</small></span>
      </span>
      <span className="web-watch-price">
        <strong>{formatPrice(last, priceDecimalsFor(instrument.priceDecimals, last))}</strong>
        <small className={change == null ? '' : change >= 0 ? 'is-up' : 'is-down'}>{formatPercent(change)}</small>
      </span>
    </button>
  );
}

function LadderRow({ instrument, quote, intensity, onSelect }: { instrument: Instrument; quote?: Quote; intensity: number; onSelect: () => void }) {
  const streamed = useLivePrice(instrument.coinKey);
  const last = streamed ?? quote?.last;
  const move = quote?.change24hPct;
  const direction = (move ?? 0) >= 0 ? 'up' : 'down';
  return (
    <button className={`web-ladder-row is-${direction}`} type="button" onClick={onSelect}>
      <i style={{ width: `${Math.max(8, intensity * 100)}%` }} />
      <span><strong>{instrument.symbol}</strong><small>{instrument.quoteCurrency ?? 'USD'}</small></span>
      <b>{formatPrice(last, priceDecimalsFor(instrument.priceDecimals, last))}</b>
      <em className={direction === 'up' ? 'is-up' : 'is-down'}>{formatPercent(move)}</em>
    </button>
  );
}

function DeskRow({ instrument, quote, onSelect }: { instrument: Instrument; quote?: Quote; onSelect: () => void }) {
  const streamed = useLivePrice(instrument.coinKey);
  const last = streamed ?? quote?.last;
  const move = quote?.change24hPct;
  return (
    <button className="web-desk-row" type="button" onClick={onSelect}>
      <span><strong>{instrument.symbol}</strong><small>{instrument.name}</small></span>
      <b>{formatPrice(last, priceDecimalsFor(instrument.priceDecimals, last))}</b>
      <b className={move == null ? '' : move >= 0 ? 'is-up' : 'is-down'}>{formatPercent(move)}</b>
      <b>{quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}</b>
      <b>{formatFundingApr(quote?.funding)}</b>
    </button>
  );
}

export default function WebWatchlistScreen() {
  const activeList = useWatchlists((state) => state.lists.find((list) => list.id === state.activeId) ?? state.lists[0]);
  const { data, isLoading, isError, refetch } = useMarkets();
  const instruments = useInstrumentsByIds(activeList?.symbolIds ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deskTab, setDeskTab] = useState<DeskTab>('overview');
  const [chartInterval, setChartInterval] = useState<CandleInterval>('1h');

  useLivePriceFeed(instruments);
  const selected = instruments.find((instrument) => instrument.id === selectedId) ?? instruments[0];
  const quote = selected ? data?.quotes[selected.id] : undefined;
  const streamed = useLivePrice(selected?.coinKey);
  const last = streamed ?? quote?.last;
  const decimals = selected ? priceDecimalsFor(selected.priceDecimals, last) : 2;
  const { data: candles, isLoading: chartLoading } = useCandles(selected, chartInterval, 180);

  const ranked = useMemo(() => {
    if (!data) return [];
    return instruments
      .filter((instrument) => data.quotes[instrument.id]?.change24hPct != null)
      .sort((left, right) => Math.abs(data.quotes[right.id].change24hPct ?? 0) - Math.abs(data.quotes[left.id].change24hPct ?? 0));
  }, [data, instruments]);

  const deskRows = useMemo(() => {
    if (!data) return [];
    const rows = [...instruments];
    if (deskTab === 'overview') rows.sort((left, right) => (data.quotes[right.id]?.dayVolume ?? -1) - (data.quotes[left.id]?.dayVolume ?? -1));
    if (deskTab === 'gainers') rows.sort((left, right) => (data.quotes[right.id]?.change24hPct ?? -Infinity) - (data.quotes[left.id]?.change24hPct ?? -Infinity));
    if (deskTab === 'losers') rows.sort((left, right) => (data.quotes[left.id]?.change24hPct ?? Infinity) - (data.quotes[right.id]?.change24hPct ?? Infinity));
    return rows.slice(0, 6);
  }, [data, deskTab, instruments]);

  const session = useMemo(() => {
    const shown = candles?.slice(-24) ?? [];
    if (!shown.length) return null;
    const high = Math.max(...shown.map((candle) => candle.h));
    const low = Math.min(...shown.map((candle) => candle.l));
    const current = shown[shown.length - 1].c;
    const range = high - low;
    return { high, low, position: range > 0 ? (current - low) / range : 0.5 };
  }, [candles]);

  if (isError) {
    return (
      <section className="web-state-card">
        <Ionicons name="cloud-offline-outline" size={24} color="currentColor" />
        <h2>Markets are taking a moment</h2>
        <p>The live providers did not answer. Your workspace is safe and ready to retry.</p>
        <button type="button" onClick={() => void refetch()}>Try again</button>
      </section>
    );
  }

  const maxMove = Math.max(1, ...ranked.slice(0, 8).map((instrument) => Math.abs(data?.quotes[instrument.id]?.change24hPct ?? 0)));

  return (
    <div className="web-terminal">
      <section className="web-terminal-marketbar">
        <div className="web-marketbar-identity">
          {selected ? <WebSymbolMark symbol={selected.symbol} /> : null}
          <div><strong>{selected?.symbol ?? '—'} / {selected?.quoteCurrency ?? 'USD'}</strong><span>{selected?.venue ?? 'Loading market'} · perpetual</span></div>
        </div>
        <div className="web-marketbar-stats">
          <div><span>Mark price</span><strong>{formatPrice(last, decimals)}</strong></div>
          <div><span>24h change</span><strong className={(quote?.change24hPct ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatPercent(quote?.change24hPct)}</strong></div>
          <div><span>24h volume</span><strong>{quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}</strong></div>
          <div><span>Funding APR</span><strong>{formatFundingApr(quote?.funding)}</strong></div>
        </div>
        {selected ? <Link href={{ pathname: '/symbol/[id]', params: { id: selected.id } }} className="web-marketbar-link">Market detail <Ionicons name="arrow-forward" size={13} color="currentColor" /></Link> : null}
      </section>

      <div className="web-dashboard-grid">
        <section className="web-watch-panel web-panel">
          <div className="web-panel-heading web-terminal-heading">
            <div><h2>{activeList?.name ?? 'Watchlist'}</h2><span>{instruments.length} markets</span></div>
            <Link href="/markets" className="web-icon-button" aria-label="Add markets"><Ionicons name="add" size={17} color="currentColor" /></Link>
          </div>
          <div className="web-watch-labels" aria-hidden="true"><span>Market</span><span>Price / 24h</span></div>
          <div className="web-watch-list">
            {isLoading
              ? Array.from({ length: 9 }, (_, index) => <span className="web-watch-skeleton" key={index} />)
              : instruments.map((instrument) => (
                  <MarketRow
                    key={instrument.id}
                    instrument={instrument}
                    quote={data?.quotes[instrument.id]}
                    active={instrument.id === selected?.id}
                    onSelect={() => setSelectedId(instrument.id)}
                  />
                ))}
          </div>
        </section>

        <section className="web-market-focus web-panel">
          <div className="web-chart-terminal-head">
            <div><strong>{selected?.symbol ?? 'MARKET'} / {selected?.quoteCurrency ?? 'USD'}</strong><span>{CHART_INTERVALS.find((item) => item.value === chartInterval)?.label} candles · live</span></div>
            <div className="web-chart-tools">
              <Link href="/settings">Indicators</Link>
              {CHART_INTERVALS.map((item) => <button key={item.value} className={chartInterval === item.value ? 'is-active' : ''} type="button" onClick={() => setChartInterval(item.value)}>{item.label}</button>)}
            </div>
          </div>
          <div className="web-chart-card">
            <WebMarketChart candles={candles ?? []} decimals={decimals} loading={chartLoading} />
          </div>
        </section>

        <aside className="web-pulse-panel web-panel">
          <div className="web-panel-heading web-terminal-heading">
            <div><h2>Market ladder</h2><span>Watchlist momentum</span></div>
            <span className="web-live-badge"><span /> Live</span>
          </div>
          <div className="web-ladder-labels"><span>Symbol</span><span>Price</span><span>24h</span></div>
          <div className="web-ladder-list">
            {ranked.slice(0, 8).map((instrument) => (
              <LadderRow
                key={instrument.id}
                instrument={instrument}
                quote={data?.quotes[instrument.id]}
                intensity={Math.abs(data?.quotes[instrument.id]?.change24hPct ?? 0) / maxMove}
                onSelect={() => setSelectedId(instrument.id)}
              />
            ))}
          </div>
          <div className="web-session-range">
            <div><span>Visible range</span><strong>{selected?.symbol ?? '—'}</strong></div>
            <div className="web-range-track"><i style={{ left: `${Math.min(100, Math.max(0, (session?.position ?? 0.5) * 100))}%` }} /></div>
            <div><b>{formatPrice(session?.low, decimals)}</b><b>{formatPrice(session?.high, decimals)}</b></div>
          </div>
        </aside>

        <section className="web-terminal-dock web-panel">
          <div className="web-dock-tabs">
            {(['overview', 'gainers', 'losers'] as const).map((tab) => (
              <button key={tab} type="button" className={deskTab === tab ? 'is-active' : ''} onClick={() => setDeskTab(tab)}>{tab === 'overview' ? 'Market overview' : tab[0].toUpperCase() + tab.slice(1)}</button>
            ))}
            <span>LIVE DATA · VIEW ONLY</span>
          </div>
          <div className="web-desk-table">
            <div className="web-desk-head"><span>Market</span><span>Last price</span><span>24h</span><span>Volume</span><span>Funding APR</span></div>
            {deskRows.map((instrument) => <DeskRow key={instrument.id} instrument={instrument} quote={data?.quotes[instrument.id]} onSelect={() => setSelectedId(instrument.id)} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
