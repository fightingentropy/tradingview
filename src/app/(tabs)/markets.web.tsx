import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';

import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useMarkets } from '@/data/useMarkets';
import type { AssetClass, Instrument, Quote } from '@/domain/types';
import { formatCompact, formatPercent, formatPrice, priceDecimalsFor } from '@/lib/format';
import { useLivePrice } from '@/store/livePrices';
import { useWatchlists } from '@/store/watchlists';

type Category = 'all' | 'crypto' | 'stocks' | 'spot';
type SortMode = 'volume' | 'gainers' | 'losers';

const STOCK_CLASSES = new Set<AssetClass>(['equity-perp', 'commodity', 'fx', 'index']);

function matchesCategory(instrument: Instrument, category: Category) {
  if (instrument.assetClass === 'outcome') return false;
  if (category === 'all') return true;
  if (category === 'crypto') return instrument.assetClass === 'crypto-perp';
  if (category === 'spot') return instrument.assetClass === 'crypto-spot';
  return STOCK_CLASSES.has(instrument.assetClass);
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
  const change = quote?.change24hPct;
  return (
    <div className="web-market-table-row" role="row">
      <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} className="web-market-name" role="cell">
        <WebSymbolMark symbol={instrument.symbol} />
        <span><strong>{instrument.symbol}</strong><small>{instrument.name}</small></span>
      </Link>
      <span className="web-table-mono" role="cell">{formatPrice(last, priceDecimalsFor(instrument.priceDecimals, last))}</span>
      <span className={`web-table-mono ${change == null ? '' : change >= 0 ? 'is-up' : 'is-down'}`} role="cell">{formatPercent(change)}</span>
      <span className="web-table-muted web-market-volume" role="cell">{quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}</span>
      <span className="web-table-muted web-market-venue" role="cell">{instrument.venue}</span>
      <button
        className={`web-watch-toggle${watched ? ' is-watched' : ''}`}
        type="button"
        aria-label={watched ? `Remove ${instrument.symbol} from watchlist` : `Add ${instrument.symbol} to watchlist`}
        aria-pressed={watched}
        onClick={onToggleWatch}>
        <Ionicons name={watched ? 'bookmark' : 'bookmark-outline'} size={17} color="currentColor" />
      </button>
    </div>
  );
}

export default function WebMarketsScreen() {
  const { data, isLoading, isError, refetch } = useMarkets();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [sort, setSort] = useState<SortMode>('volume');
  const activeId = useWatchlists((state) => state.activeId);
  const activeList = useWatchlists((state) => state.lists.find((list) => list.id === state.activeId));
  const toggle = useWatchlists((state) => state.toggle);
  const watched = useMemo(() => new Set(activeList?.symbolIds ?? []), [activeList?.symbolIds]);

  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = (data?.instruments ?? []).filter((instrument) => {
      if (!matchesCategory(instrument, category)) return false;
      if (!query) return true;
      return `${instrument.symbol} ${instrument.name} ${instrument.venue}`.toLowerCase().includes(query);
    });
    filtered.sort((left, right) => {
      const leftQuote = data?.quotes[left.id];
      const rightQuote = data?.quotes[right.id];
      if (sort === 'volume') return (rightQuote?.dayVolume ?? -1) - (leftQuote?.dayVolume ?? -1);
      const leftMove = leftQuote?.change24hPct;
      const rightMove = rightQuote?.change24hPct;
      if (leftMove == null && rightMove == null) return 0;
      if (leftMove == null) return 1;
      if (rightMove == null) return -1;
      return sort === 'gainers' ? rightMove - leftMove : leftMove - rightMove;
    });
    return filtered.slice(0, 180);
  }, [category, data, search, sort]);

  useLivePriceFeed(results.slice(0, 80));

  const counts = useMemo(() => {
    const instruments = (data?.instruments ?? []).filter((instrument) => instrument.assetClass !== 'outcome');
    return {
      all: instruments.length,
      crypto: instruments.filter((instrument) => instrument.assetClass === 'crypto-perp').length,
      stocks: instruments.filter((instrument) => STOCK_CLASSES.has(instrument.assetClass)).length,
      spot: instruments.filter((instrument) => instrument.assetClass === 'crypto-spot').length,
    };
  }, [data?.instruments]);

  return (
    <div className="web-content-stack">
      <section className="web-page-intro">
        <div>
          <span className="web-section-kicker">DISCOVER</span>
          <h2>Every market, one quiet surface.</h2>
          <p>Live crypto, equities, indices, commodities and spot markets—sorted around what matters now.</p>
        </div>
        <div className="web-source-pills" aria-label="Market data sources">
          <span><i className="web-live-dot" /> Hyperliquid</span>
          <span><i className="web-live-dot" /> trade.xyz</span>
          <span><i className="web-delayed-dot" /> Cboe delayed</span>
        </div>
      </section>

      <section className="web-market-browser web-panel">
        <div className="web-market-controls">
          <label className="web-market-search">
            <Ionicons name="search" size={17} color="currentColor" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search symbol, company or venue"
              aria-label="Search markets"
              autoFocus
            />
            {search ? (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                <Ionicons name="close-circle" size={16} color="currentColor" />
              </button>
            ) : null}
          </label>
          <div className="web-segmented-control" aria-label="Market category">
            {(['all', 'crypto', 'stocks', 'spot'] as const).map((item) => (
              <button key={item} type="button" className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)}>
                {item === 'all' ? 'All' : item[0].toUpperCase() + item.slice(1)} <span>{counts[item]}</span>
              </button>
            ))}
          </div>
          <label className="web-select-control">
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
              <option value="volume">Volume</option>
              <option value="gainers">Top gainers</option>
              <option value="losers">Top losers</option>
            </select>
          </label>
        </div>

        <div className="web-market-table" role="table" aria-label="Markets">
          <div className="web-market-table-head" role="row">
            <span role="columnheader">Market</span>
            <span role="columnheader">Last price</span>
            <span role="columnheader">24h</span>
            <span className="web-market-volume" role="columnheader">Volume</span>
            <span className="web-market-venue" role="columnheader">Venue</span>
            <span role="columnheader" aria-label="Watchlist" />
          </div>
          {isLoading
            ? Array.from({ length: 10 }, (_, index) => <span className="web-table-skeleton" key={index} />)
            : isError
              ? (
                  <div className="web-inline-state">
                    <p>Couldn’t reach the market providers.</p>
                    <button type="button" onClick={() => void refetch()}>Retry</button>
                  </div>
                )
              : results.length === 0
                ? <div className="web-inline-state"><p>No markets match “{search}”.</p></div>
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
      </section>
    </div>
  );
}
