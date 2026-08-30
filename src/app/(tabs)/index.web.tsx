import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';

import { WebAccountDock } from '@/components/web/WebAccountDock';
import { WebMarketChart } from '@/components/web/WebMarketChart';
import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useCandles } from '@/data/useCandles';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useMarkets, useInstrumentsByIds } from '@/data/useMarkets';
import { useOrderBook } from '@/data/useOrderBook';
import type { CandleInterval, Instrument, Quote } from '@/domain/types';
import {
  formatCompact,
  formatFundingApr,
  formatPercent,
  formatPrice,
  formatSignedPrice,
  priceDecimalsFor,
} from '@/lib/format';
import { useLivePrice } from '@/store/livePrices';
import { usePreferences } from '@/store/preferences';
import { useWatchlists } from '@/store/watchlists';

type TradeCategory = 'favourites' | 'perps' | 'spot' | 'traditional';

const CATEGORY_OPTIONS: { id: TradeCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'favourites', label: 'Favourites', icon: 'star-outline' },
  { id: 'perps', label: 'Perpetuals', icon: 'pulse-outline' },
  { id: 'spot', label: 'Spot', icon: 'ellipse-outline' },
  { id: 'traditional', label: 'Stocks & macro', icon: 'globe-outline' },
];

function categoryMatches(instrument: Instrument, category: TradeCategory, favouriteIds: Set<string>) {
  if (instrument.assetClass === 'outcome') return false;
  if (category === 'favourites') return favouriteIds.has(instrument.id);
  if (category === 'perps') return instrument.assetClass === 'crypto-perp';
  if (category === 'spot') return instrument.assetClass === 'crypto-spot';
  return !instrument.assetClass.startsWith('crypto-');
}

function MarketBrowserRow({
  instrument,
  quote,
  selected,
  onSelect,
}: {
  instrument: Instrument;
  quote?: Quote;
  selected: boolean;
  onSelect: () => void;
}) {
  const streamed = useLivePrice(instrument.coinKey);
  const last = streamed ?? quote?.last;
  const decimals = priceDecimalsFor(instrument.priceDecimals, last);
  const absolute = last != null && quote?.prevClose != null ? last - quote.prevClose : null;
  const positive = (quote?.change24hPct ?? 0) >= 0;

  return (
    <div className={`web-capital-trade-market-row${selected ? ' is-selected' : ''}`} role="row">
      <button type="button" className="web-capital-trade-market" onClick={onSelect} role="cell">
        <WebSymbolMark symbol={instrument.symbol} />
        <span><strong>{instrument.symbol}</strong><small>{instrument.name}</small></span>
      </button>
      <span className={positive ? 'is-up' : 'is-down'} role="cell">{formatSignedPrice(absolute, decimals) || '—'}</span>
      <span className={positive ? 'is-up' : 'is-down'} role="cell">{formatPercent(quote?.change24hPct)}</span>
      <span className="web-capital-mini-trend" role="cell"><Ionicons name={positive ? 'trending-up' : 'trending-down'} size={22} color="currentColor" /></span>
      <strong className="web-capital-trade-last" role="cell">{formatPrice(last, decimals)}</strong>
      <span className="web-capital-trade-volume" role="cell">{quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}</span>
      <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} className="web-capital-outline-action" role="cell">Chart</Link>
      <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} className="web-capital-row-icon" aria-label={`Open ${instrument.symbol}`} role="cell"><Ionicons name="add-circle-outline" size={20} color="currentColor" /></Link>
    </div>
  );
}

function OrderBookPanel({ instrument, mark, decimals }: { instrument?: Instrument; mark?: number; decimals: number }) {
  const coin = instrument?.id.startsWith('hl:') ? instrument.coinKey : undefined;
  const { data: book, isLoading } = useOrderBook(coin);

  const depth = useMemo(() => {
    const cumulative = (levels: NonNullable<typeof book>['bids']) => {
      let total = 0;
      return levels.slice(0, 9).map((level) => ({ ...level, total: (total += level.size) }));
    };
    const asks = cumulative(book?.asks ?? []).reverse();
    const bids = cumulative(book?.bids ?? []);
    const maxTotal = Math.max(1, ...asks.map((level) => level.total), ...bids.map((level) => level.total));
    const bestAsk = book?.asks[0]?.price;
    const bestBid = book?.bids[0]?.price;
    const spreadPct = bestAsk != null && bestBid ? ((bestAsk - bestBid) / bestBid) * 100 : undefined;
    return { asks, bids, maxTotal, spreadPct };
  }, [book]);

  const renderLevel = (level: (typeof depth.asks)[number], side: 'ask' | 'bid') => (
    <div className={`web-book-row is-${side}`} key={`${side}-${level.price}`}>
      <i style={{ width: `${Math.max(3, (level.total / depth.maxTotal) * 100)}%` }} />
      <span>{formatPrice(level.price, decimals)}</span>
      <span>{formatPrice(level.size, 2)}</span>
      <span>{formatPrice(level.total, 2)}</span>
    </div>
  );

  return (
    <aside className="web-xyz-orderbook web-capital-trade-orderbook">
      <div className="web-xyz-side-head"><strong>Order book</strong><span className="web-book-layout-icon"><i /><i /></span></div>
      <div className="web-book-labels"><span>Price</span><span>Size</span><span>Total</span></div>
      <div className="web-book-half is-asks">
        {depth.asks.length ? depth.asks.map((level) => renderLevel(level, 'ask')) : <span className="web-book-empty">{isLoading ? 'Loading…' : 'No asks'}</span>}
      </div>
      <div className="web-book-spread"><strong className="is-up">{formatPrice(mark, decimals)}</strong><span>{depth.spreadPct == null ? '—' : `${depth.spreadPct.toFixed(3)}%`}</span></div>
      <div className="web-book-half is-bids">
        {depth.bids.length ? depth.bids.map((level) => renderLevel(level, 'bid')) : <span className="web-book-empty">{isLoading ? 'Loading…' : 'No bids'}</span>}
      </div>
    </aside>
  );
}

export default function WebWatchlistScreen() {
  const activeList = useWatchlists((state) => state.lists.find((list) => list.id === state.activeId) ?? state.lists[0]);
  const favouriteInstruments = useInstrumentsByIds(activeList?.symbolIds ?? []);
  const showClobOrderBook = usePreferences((state) => state.showClobOrderBook);
  const { data, isError, refetch } = useMarkets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chartInterval, setChartInterval] = useState<CandleInterval>('5m');
  const [category, setCategory] = useState<TradeCategory>('favourites');
  const [search, setSearch] = useState('');

  const favouriteIds = useMemo(() => new Set(favouriteInstruments.map((instrument) => instrument.id)), [favouriteInstruments]);
  const marketRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = (data?.instruments ?? []).filter((instrument) => {
      if (!categoryMatches(instrument, category, favouriteIds)) return false;
      return !query || `${instrument.symbol} ${instrument.name}`.toLowerCase().includes(query);
    });
    return filtered.sort((left, right) => (data?.quotes[right.id]?.dayVolume ?? -1) - (data?.quotes[left.id]?.dayVolume ?? -1)).slice(0, 12);
  }, [category, data?.instruments, data?.quotes, favouriteIds, search]);

  const fallbackSelected = data?.instruments.find((instrument) => instrument.symbol === 'HYPE' && instrument.assetClass === 'crypto-perp')
    ?? favouriteInstruments[0]
    ?? marketRows[0];
  const selected = (selectedId ? data?.instruments.find((instrument) => instrument.id === selectedId) : undefined) ?? fallbackSelected;
  const quote = selected ? data?.quotes[selected.id] : undefined;
  const streamed = useLivePrice(selected?.coinKey);
  const last = streamed ?? quote?.last;
  const decimals = selected ? priceDecimalsFor(selected.priceDecimals, last) : 2;
  const { data: candles, isLoading: chartLoading } = useCandles(selected, chartInterval, 180);
  const feedInstruments = useMemo(() => {
    const all = [...marketRows, ...(selected ? [selected] : [])];
    return [...new Map(all.map((instrument) => [instrument.id, instrument])).values()];
  }, [marketRows, selected]);
  useLivePriceFeed(feedInstruments);

  if (isError) {
    return (
      <section className="web-state-card">
        <span className="web-state-glyph" aria-hidden="true">!</span>
        <h2>Markets are taking a moment</h2>
        <p>The live providers did not answer. Your workspace is safe and ready to retry.</p>
        <button type="button" onClick={() => void refetch()}>Try again</button>
      </section>
    );
  }

  return (
    <div className="web-terminal web-capital-trade-page">
      <section className={`web-capital-trade-browser${showClobOrderBook ? ' has-orderbook' : ''}`}>
        <aside className="web-capital-watchlists">
          <label><Ionicons name="search" size={16} color="currentColor" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search trade markets" /></label>
          <header><span>Watchlists</span><button type="button">Edit</button></header>
          {CATEGORY_OPTIONS.map((option) => (
            <button key={option.id} type="button" className={category === option.id ? 'is-active' : ''} onClick={() => setCategory(option.id)}>
              <Ionicons name={option.icon} size={23} color="currentColor" /><span>{option.label}</span>
            </button>
          ))}
          <small>Markets</small>
          <button type="button" onClick={() => setCategory('perps')}><span className="web-capital-country-dot">₿</span><span>Crypto</span></button>
          <button type="button" onClick={() => setCategory('traditional')}><span className="web-capital-country-dot">$</span><span>USD markets</span></button>
        </aside>

        <section className="web-capital-trade-table" role="table" aria-label="Trade markets">
          <div className="web-capital-trade-table-head" role="row">
            <span role="columnheader">Market</span><span role="columnheader">Today</span><span role="columnheader">Change %</span><span /><span role="columnheader">Last</span><span role="columnheader">Volume</span><span /><span />
          </div>
          <div className="web-capital-trade-market-list">
            {marketRows.map((instrument) => (
              <MarketBrowserRow key={instrument.id} instrument={instrument} quote={data?.quotes[instrument.id]} selected={selected?.id === instrument.id} onSelect={() => setSelectedId(instrument.id)} />
            ))}
            {!marketRows.length ? <div className="web-capital-trade-empty">No markets in this list.</div> : null}
          </div>
        </section>

        {showClobOrderBook ? <OrderBookPanel instrument={selected} mark={last} decimals={decimals} /> : null}
      </section>

      <section className="web-capital-chart-panel">
        <div className="web-capital-chart-toolbar">
          <button type="button" aria-label="Add market"><Ionicons name="add-circle-outline" size={21} color="currentColor" /></button>
          {(['5m', '1h', '1d'] as CandleInterval[]).map((interval) => <button key={interval} type="button" className={chartInterval === interval ? 'is-active' : ''} onClick={() => setChartInterval(interval)}>{interval}</button>)}
          <span className="web-capital-toolbar-separator" />
          <button type="button"><Ionicons name="stats-chart-outline" size={17} color="currentColor" /> Candles</button>
          <button type="button"><Ionicons name="pulse-outline" size={17} color="currentColor" /> Indicators</button>
          <button type="button"><Ionicons name="notifications-outline" size={17} color="currentColor" /> Alerts</button>
          <span className="web-capital-chart-save">Save <Ionicons name="chevron-down" size={12} color="currentColor" /></span>
          <button type="button" aria-label="Fullscreen"><Ionicons name="scan-outline" size={18} color="currentColor" /></button>
        </div>
        <div className="web-capital-chart-body">
          <aside className="web-capital-drawing-tools" aria-label="Chart tools">
            {(['add-outline', 'remove-outline', 'git-commit-outline', 'analytics-outline', 'brush-outline', 'text-outline', 'happy-outline', 'resize-outline', 'search-outline'] as const).map((icon) => <button type="button" key={icon}><Ionicons name={icon} size={19} color="currentColor" /></button>)}
          </aside>
          <div className="web-capital-chart-canvas">
            <div className="web-capital-chart-symbol">
              <strong>{selected?.symbol ?? '—'} · {chartInterval}</strong>
              <span className={(quote?.change24hPct ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatPrice(last, decimals)} · {formatPercent(quote?.change24hPct)}</span>
              <small>{selected?.name ?? 'Select a market'} · Funding {formatFundingApr(quote?.funding)}</small>
            </div>
            <WebMarketChart candles={candles ?? []} decimals={decimals} loading={chartLoading} />
          </div>
        </div>
        <div className="web-capital-chart-footer"><span>1D</span><span>5D</span><span>1M</span><span>3M</span><span>6M</span><span>YTD</span><span>1Y</span><span>All</span><em>{Intl.DateTimeFormat().resolvedOptions().timeZone}</em><span>%</span><span>log</span><strong>auto</strong></div>
      </section>

      <WebAccountDock />
    </div>
  );
}
