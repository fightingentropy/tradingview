import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useMarkets } from '@/data/useMarkets';
import type { AssetClass, Instrument, Quote } from '@/domain/types';
import {
  formatCompact,
  formatFundingApr,
  formatPercent,
  formatPrice,
  formatSignedPrice,
  priceDecimalsFor,
} from '@/lib/format';
import { useLivePrice } from '@/store/livePrices';
import { useWatchlists } from '@/store/watchlists';

type Category = 'all' | 'xyz' | 'hyperliquid' | 'spot' | 'watchlist';
type SortColumn = 'change' | 'volume' | 'price' | 'funding';
type SortDirection = 'asc' | 'desc';

const STOCK_CLASSES = new Set<AssetClass>(['equity-perp', 'commodity', 'fx', 'index']);

function matchesCategory(instrument: Instrument, category: Category, watched: Set<string>) {
  if (instrument.assetClass === 'outcome') return false;
  if (category === 'all') return true;
  if (category === 'hyperliquid') return instrument.assetClass === 'crypto-perp';
  if (category === 'xyz') return STOCK_CLASSES.has(instrument.assetClass);
  if (category === 'spot') return instrument.assetClass === 'crypto-spot';
  return watched.has(instrument.id);
}

function marketType(instrument: Instrument) {
  if (instrument.assetClass === 'crypto-spot') return 'Spot';
  if (instrument.assetClass === 'equity-perp') return 'Equity';
  if (instrument.assetClass === 'commodity') return 'Commodity';
  if (instrument.assetClass === 'fx') return 'FX';
  if (instrument.assetClass === 'index') return 'Index';
  return 'Perp';
}

function sortableValue(quote: Quote | undefined, column: SortColumn) {
  if (column === 'change') return quote?.change24hPct ?? null;
  if (column === 'volume') return quote?.dayVolume ?? null;
  if (column === 'funding') return quote?.funding ?? null;
  return quote?.last ?? null;
}

function MarketTableRow({
  instrument,
  quote,
  watched,
  onToggleWatch,
}: {
  instrument: Instrument;
  quote?: Quote;
  watched: boolean;
  onToggleWatch: () => void;
}) {
  const streamed = useLivePrice(instrument.coinKey);
  const last = streamed ?? quote?.last;
  const percentChange = quote?.change24hPct;
  const absoluteChange = last != null && quote?.prevClose != null ? last - quote.prevClose : null;
  const decimals = priceDecimalsFor(instrument.priceDecimals, last);
  const positive = (percentChange ?? 0) >= 0;
  const funding = quote?.funding;
  const displayPrice = last == null ? '—' : `$${formatPrice(last, decimals)}`;

  return (
    <div className="web-xyz-market-row" role="row">
      <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} className="web-xyz-market-identity" role="cell">
        <WebSymbolMark symbol={instrument.symbol} large />
        <span className="web-xyz-market-details">
          <span className="web-xyz-market-name-line">
            <strong>{instrument.symbol}</strong>
            <small>{marketType(instrument)}</small>
            {STOCK_CLASSES.has(instrument.assetClass) ? <b>XYZ</b> : null}
          </span>
          <span className="web-xyz-market-subline">
            <span>{displayPrice}</span>
            <i>{instrument.name}</i>
          </span>
        </span>
      </Link>

      <div className={`web-xyz-change-cell ${positive ? 'is-positive' : 'is-negative'}`} role="cell">
        <span className="web-xyz-change-icon" aria-hidden="true">
          <Ionicons name={positive ? 'trending-up' : 'trending-down'} size={14} color="currentColor" />
        </span>
        <span>
          <strong>{formatSignedPrice(absoluteChange, decimals) || '—'}</strong>
          <small>{formatPercent(percentChange)}</small>
        </span>
      </div>

      <span className="web-xyz-market-number" role="cell">
        {quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}
      </span>
      <span className="web-xyz-market-number" role="cell">{displayPrice}</span>
      <span className={`web-xyz-funding ${funding == null ? '' : funding >= 0 ? 'is-positive' : 'is-negative'}`} role="cell">
        {instrument.assetClass === 'crypto-spot' ? '—' : formatFundingApr(funding)}
      </span>
      <span className="web-xyz-market-star-cell" role="cell">
        <button
          className={`web-xyz-market-star${watched ? ' is-watched' : ''}`}
          type="button"
          aria-label={watched ? `Remove ${instrument.symbol} from watchlist` : `Add ${instrument.symbol} to watchlist`}
          aria-pressed={watched}
          onClick={onToggleWatch}>
          <Ionicons name={watched ? 'star' : 'star-outline'} size={17} color="currentColor" />
        </button>
      </span>
    </div>
  );
}

function SortHeader({
  column,
  activeColumn,
  direction,
  children,
  onSort,
}: {
  column: SortColumn;
  activeColumn: SortColumn;
  direction: SortDirection;
  children: string;
  onSort: (column: SortColumn) => void;
}) {
  const active = column === activeColumn;
  return (
    <span
      className="web-xyz-sort-cell"
      role="columnheader"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`web-xyz-sort-header${active ? ' is-active' : ''}`}
        onClick={() => onSort(column)}>
        <span>{children}</span>
        {active ? <Ionicons name="chevron-down" size={12} color="currentColor" className={direction === 'asc' ? 'is-ascending' : ''} /> : null}
      </button>
    </span>
  );
}

export default function WebMarketsScreen() {
  const { data, isLoading, isError, refetch } = useMarkets();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('volume');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const searchRef = useRef<HTMLInputElement>(null);
  const activeId = useWatchlists((state) => state.activeId);
  const activeList = useWatchlists((state) => state.lists.find((list) => list.id === state.activeId));
  const toggle = useWatchlists((state) => state.toggle);
  const watched = useMemo(() => new Set(activeList?.symbolIds ?? []), [activeList?.symbolIds]);

  const instruments = useMemo(
    () => (data?.instruments ?? []).filter((instrument) => instrument.assetClass !== 'outcome'),
    [data?.instruments],
  );

  const counts = useMemo(() => ({
    all: instruments.length,
    xyz: instruments.filter((instrument) => STOCK_CLASSES.has(instrument.assetClass)).length,
    hyperliquid: instruments.filter((instrument) => instrument.assetClass === 'crypto-perp').length,
    spot: instruments.filter((instrument) => instrument.assetClass === 'crypto-spot').length,
    watchlist: instruments.filter((instrument) => watched.has(instrument.id)).length,
  }), [instruments, watched]);

  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = instruments.filter((instrument) => {
      if (!matchesCategory(instrument, category, watched)) return false;
      if (!query) return true;
      return `${instrument.symbol} ${instrument.name} ${instrument.venue}`.toLowerCase().includes(query);
    });
    filtered.sort((left, right) => {
      const leftValue = sortableValue(data?.quotes[left.id], sortColumn);
      const rightValue = sortableValue(data?.quotes[right.id], sortColumn);
      if (leftValue == null && rightValue == null) return 0;
      if (leftValue == null) return 1;
      if (rightValue == null) return -1;
      return (leftValue - rightValue) * (sortDirection === 'asc' ? 1 : -1);
    });
    return filtered.slice(0, 180);
  }, [category, data?.quotes, instruments, search, sortColumn, sortDirection, watched]);

  useLivePriceFeed(results.slice(0, 80));

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearch('');
        searchRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((current) => current === 'desc' ? 'asc' : 'desc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const tabs: { id: Category; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'xyz', label: 'Perps' },
    { id: 'hyperliquid', label: 'Perps' },
    { id: 'spot', label: 'Spot' },
    { id: 'watchlist', label: 'Watchlist' },
  ];

  return (
    <div className="web-xyz-markets-page">
      <header className="web-capital-page-header">
        <div>
          <span className="web-capital-page-kicker">DISCOVER</span>
          <h1>Markets</h1>
          <p>Browse live crypto, equity, index, commodity and FX markets.</p>
        </div>
        <span className="web-capital-page-status"><i /> {counts.all} instruments live</span>
      </header>
      <section className="web-xyz-markets-surface" aria-label="Markets">
        <div className="web-xyz-markets-search-header">
          <label className="web-xyz-markets-search">
            <Ionicons name="search" size={20} color="currentColor" />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${counts.all} markets...`}
              aria-label="Search markets"
              autoFocus
            />
            {search ? (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear market search">
                <Ionicons name="close-circle" size={17} color="currentColor" />
              </button>
            ) : <kbd>⌘ K</kbd>}
          </label>
        </div>

        <div className="web-xyz-market-filters" aria-label="Market categories">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={category === tab.id ? 'is-active' : ''}
              onClick={() => setCategory(tab.id)}>
              {tab.id === 'watchlist' ? <Ionicons name="star" size={12} color="currentColor" /> : null}
              <span>{tab.label}</span>
              {tab.id === 'xyz' ? <b>XYZ</b> : null}
              {tab.id === 'hyperliquid' ? <img src="/hyperliquid.svg" alt="Hyperliquid" /> : null}
              <small>{counts[tab.id]}</small>
            </button>
          ))}
        </div>

        <div className="web-xyz-market-table" role="table" aria-label="Live markets">
          <div className="web-xyz-market-head" role="row">
            <span role="columnheader">Market</span>
            <SortHeader column="change" activeColumn={sortColumn} direction={sortDirection} onSort={handleSort}>24h Change</SortHeader>
            <SortHeader column="volume" activeColumn={sortColumn} direction={sortDirection} onSort={handleSort}>Volume</SortHeader>
            <SortHeader column="price" activeColumn={sortColumn} direction={sortDirection} onSort={handleSort}>Last Price</SortHeader>
            <SortHeader column="funding" activeColumn={sortColumn} direction={sortDirection} onSort={handleSort}>Funding APR</SortHeader>
            <span role="columnheader" aria-label="Watchlist" />
          </div>
          <div className="web-xyz-market-list">
            {isLoading
              ? Array.from({ length: 8 }, (_, index) => <span className="web-xyz-market-skeleton" key={index} />)
              : isError
                ? (
                    <div className="web-xyz-market-state">
                      <p>Couldn’t reach the market providers.</p>
                      <button type="button" onClick={() => void refetch()}>Retry</button>
                    </div>
                  )
                : results.length === 0
                  ? <div className="web-xyz-market-state"><p>No markets match “{search}”.</p></div>
                  : results.map((instrument) => (
                      <MarketTableRow
                        key={instrument.id}
                        instrument={instrument}
                        quote={data?.quotes[instrument.id]}
                        watched={watched.has(instrument.id)}
                        onToggleWatch={() => toggle(activeId, instrument.id)}
                      />
                    ))}
          </div>
        </div>

        <footer className="web-xyz-markets-footer">
          <span><i /> {results.length} markets</span>
          <span>Live · Hyperliquid + trade.xyz</span>
        </footer>
      </section>
    </div>
  );
}
