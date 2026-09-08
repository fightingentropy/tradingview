import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';

import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useMarkets } from '@/data/useMarkets';
import { useNewsFeed } from '@/data/useNewsFeed';
import type { Instrument, Quote } from '@/domain/types';
import { formatCompact, formatPercent, formatPrice, formatSignedPrice, priceDecimalsFor } from '@/lib/format';
import { useMarketPrice } from '@/store/livePrices';
import { useWatchlists } from '@/store/watchlists';

type DiscoverCategory = 'all' | 'perps' | 'spot' | 'traditional';

function categoryMatches(instrument: Instrument, category: DiscoverCategory) {
  if (instrument.assetClass === 'outcome') return false;
  if (category === 'all') return true;
  if (category === 'perps') return instrument.assetClass === 'crypto-perp';
  if (category === 'spot') return instrument.assetClass === 'crypto-spot';
  return !instrument.assetClass.startsWith('crypto-');
}

function DiscoverMarketRow({
  instrument,
  quote,
  share,
  watched,
  onToggleWatch,
}: {
  instrument: Instrument;
  quote?: Quote;
  share: number;
  watched: boolean;
  onToggleWatch: () => void;
}) {
  const priceState = useMarketPrice(instrument, quote);
  const last = priceState.last;
  const decimals = priceDecimalsFor(instrument.priceDecimals, last);
  const change = last != null && quote?.prevClose != null ? last - quote.prevClose : null;
  const positive = (quote?.change24hPct ?? 0) >= 0;
  return (
    <div className="web-capital-discover-row">
      <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} className="web-capital-discover-market">
        <WebSymbolMark symbol={instrument.symbol} />
        <span><strong>{instrument.symbol}</strong><small>{instrument.name}</small></span>
      </Link>
      <span className="web-capital-trade-share"><small>{share.toFixed(2)}%</small><i style={{ width: `${Math.max(3, Math.min(100, share * 5))}%` }} /></span>
      <strong title={priceState.label}>{formatPrice(last, decimals)}{priceState.status !== 'live' ? <small className="web-price-status">{priceState.label}</small> : null}</strong>
      <span>{quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}</span>
      <span className={positive ? 'is-up' : 'is-down'}>{formatSignedPrice(change, decimals) || '—'}</span>
      <span className={positive ? 'is-up' : 'is-down'}>{formatPercent(quote?.change24hPct)}</span>
      <button type="button" className={watched ? 'is-watched' : ''} aria-pressed={watched} aria-label={watched ? `Remove ${instrument.symbol} from watchlist` : `Add ${instrument.symbol} to watchlist`} onClick={onToggleWatch}><Ionicons name={watched ? 'star' : 'star-outline'} size={15} color="currentColor" /></button>
    </div>
  );
}

function MoverRow({ instrument, quote }: { instrument: Instrument; quote?: Quote }) {
  const positive = (quote?.change24hPct ?? 0) >= 0;
  return (
    <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} className="web-capital-mover-row">
      <WebSymbolMark symbol={instrument.symbol} />
      <span><strong>{instrument.symbol}</strong><small>{instrument.name}</small></span>
      <em className={positive ? 'is-up' : 'is-down'}>{formatPercent(quote?.change24hPct)}</em>
    </Link>
  );
}

export default function WebMarketsScreen() {
  const { data, isLoading, isError, refetch } = useMarkets();
  const { executiveSummary } = useNewsFeed('all');
  const [category, setCategory] = useState<DiscoverCategory>('all');
  const [search, setSearch] = useState('');
  const activeId = useWatchlists((state) => state.activeId);
  const activeList = useWatchlists((state) => state.lists.find((list) => list.id === state.activeId));
  const toggle = useWatchlists((state) => state.toggle);
  const watched = useMemo(() => new Set(activeList?.symbolIds ?? []), [activeList?.symbolIds]);

  const instruments = useMemo(() => (data?.instruments ?? []).filter((instrument) => instrument.assetClass !== 'outcome'), [data?.instruments]);
  const totalVolume = useMemo(() => instruments.reduce((sum, instrument) => sum + (data?.quotes[instrument.id]?.dayVolume ?? 0), 0), [data?.quotes, instruments]);
  const byVolume = useMemo(() => [...instruments].sort((left, right) => (data?.quotes[right.id]?.dayVolume ?? -1) - (data?.quotes[left.id]?.dayVolume ?? -1)), [data?.quotes, instruments]);
  const movers = useMemo(() => [...instruments].filter((instrument) => data?.quotes[instrument.id]?.change24hPct != null), [data?.quotes, instruments]);
  const risers = useMemo(() => [...movers].sort((left, right) => (data?.quotes[right.id]?.change24hPct ?? 0) - (data?.quotes[left.id]?.change24hPct ?? 0)).slice(0, 9), [data?.quotes, movers]);
  const fallers = useMemo(() => [...movers].sort((left, right) => (data?.quotes[left.id]?.change24hPct ?? 0) - (data?.quotes[right.id]?.change24hPct ?? 0)).slice(0, 9), [data?.quotes, movers]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return byVolume.filter((instrument) => categoryMatches(instrument, category) && (!query || `${instrument.symbol} ${instrument.name}`.toLowerCase().includes(query))).slice(0, 30);
  }, [byVolume, category, search]);

  const categories = useMemo(() => [
    { id: 'perps' as const, label: 'Crypto perps', volume: instruments.filter((item) => item.assetClass === 'crypto-perp').reduce((sum, item) => sum + (data?.quotes[item.id]?.dayVolume ?? 0), 0) },
    { id: 'spot' as const, label: 'Spot', volume: instruments.filter((item) => item.assetClass === 'crypto-spot').reduce((sum, item) => sum + (data?.quotes[item.id]?.dayVolume ?? 0), 0) },
    { id: 'traditional' as const, label: 'Equities', volume: instruments.filter((item) => item.assetClass === 'equity-perp').reduce((sum, item) => sum + (data?.quotes[item.id]?.dayVolume ?? 0), 0) },
    { id: 'traditional' as const, label: 'Macro', volume: instruments.filter((item) => ['commodity', 'fx', 'index'].includes(item.assetClass)).reduce((sum, item) => sum + (data?.quotes[item.id]?.dayVolume ?? 0), 0) },
  ], [data?.quotes, instruments]);

  useLivePriceFeed(useMemo(() => [...new Map([...filtered, ...risers, ...fallers].map((instrument) => [instrument.id, instrument])).values()].slice(0, 80), [fallers, filtered, risers]));

  if (isError) {
    return <section className="web-state-card"><h2>Markets unavailable</h2><p>The market providers did not answer.</p><button type="button" onClick={() => void refetch()}>Try again</button></section>;
  }

  const shareFor = (instrument: Instrument) => totalVolume > 0 ? ((data?.quotes[instrument.id]?.dayVolume ?? 0) / totalVolume) * 100 : 0;
  const newsItems = executiveSummary?.bullets ?? [];

  return (
    <div className="web-capital-discover-page">
      <header className="web-page-heading"><div><h1>Markets</h1><p>Prices, reported volume and daily movers across your markets.</p></div></header>
      <div className="web-capital-discover-layout">
        <main className="web-capital-discover-main">
          <section className="web-capital-discover-overview">
            <header><h2>Market overview</h2></header>
            <div>
              <section className="web-capital-category-share">
                <h3>Share of reported 24h volume</h3>
                {categories.map((item, index) => {
                  const share = totalVolume > 0 ? (item.volume / totalVolume) * 100 : 0;
                  return <button type="button" key={`${item.label}-${index}`} onClick={() => setCategory(item.id)}><span>{item.label}</span><strong>{share.toFixed(0)}%</strong><i style={{ width: `${Math.max(1, share)}%` }} /></button>;
                })}
              </section>
              <section className="web-capital-top-traded">
                <h3>Top traded markets</h3>
                <div>{byVolume.slice(0, 6).map((instrument) => <Link key={instrument.id} href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }}><span>{instrument.symbol}</span></Link>)}</div>
              </section>
            </div>
          </section>

          <section className="web-capital-most-traded">
            <header><h2>Markets by volume</h2><label><Ionicons name="search" size={14} color="currentColor" /><input aria-label="Search markets" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search markets" /></label></header>
            <nav aria-label="Market categories">{(['all', 'perps', 'spot', 'traditional'] as const).map((item) => <button type="button" aria-pressed={category === item} className={category === item ? 'is-active' : ''} key={item} onClick={() => setCategory(item)}>{item === 'all' ? 'All' : item === 'perps' ? 'Perps' : item === 'spot' ? 'Spot' : 'Stocks & macro'}</button>)}</nav>
            <div className="web-capital-discover-table-head"><span>Market</span><span>Vol. share</span><span>Price</span><span>24h volume</span><span>Change</span><span>24h %</span><span /></div>
            <div className="web-capital-discover-table">
              {isLoading ? Array.from({ length: 10 }, (_, index) => <span className="web-capital-discover-skeleton" key={index} />) : filtered.length ? filtered.map((instrument) => <DiscoverMarketRow key={instrument.id} instrument={instrument} quote={data?.quotes[instrument.id]} share={shareFor(instrument)} watched={watched.has(instrument.id)} onToggleWatch={() => toggle(activeId, instrument.id)} />) : <p className="web-market-list-empty">No markets match this search.</p>}
            </div>
          </section>
        </main>

        <div className="web-capital-movers-column">
          <section><header><h2>Top gainers</h2><span>24 hours</span></header><div className="web-capital-mover-head"><span>Market</span><span>24h change</span></div>{risers.map((instrument) => <MoverRow key={instrument.id} instrument={instrument} quote={data?.quotes[instrument.id]} />)}</section>
          <section><header><h2>Top decliners</h2><span>24 hours</span></header><div className="web-capital-mover-head"><span>Market</span><span>24h change</span></div>{fallers.map((instrument) => <MoverRow key={instrument.id} instrument={instrument} quote={data?.quotes[instrument.id]} />)}</section>
        </div>

        <aside className="web-capital-discover-news">
          <section><header><h2>Major news</h2><Link href="/news"><Ionicons name="chevron-forward" size={20} color="currentColor" /></Link></header>{executiveSummary ? <article className="is-lead"><span>{executiveSummary.pulse.label.replace('-', ' ')}</span><h3>{executiveSummary.headline}</h3><p>{executiveSummary.overview}</p><small><Ionicons name="flash" size={13} color="currentColor" /> Market pulse</small></article> : <article className="is-lead"><h3>Market intelligence is loading</h3></article>}{newsItems.slice(0, 2).map((item) => <article key={item.headline}><h3>{item.headline}</h3><small><Ionicons name="flash" size={13} color="currentColor" /> Curated intelligence</small></article>)}</section>
          <section><header><h2>Watch next</h2><Link href="/news"><Ionicons name="chevron-forward" size={20} color="currentColor" /></Link></header>{(executiveSummary?.watchNext ?? []).slice(0, 4).map((item) => <article key={item}><h3>{item}</h3><small><Ionicons name="flash" size={13} color="currentColor" /> From the briefing</small></article>)}<Link href="/news" className="web-capital-show-all">Read briefing</Link></section>
        </aside>
      </div>
    </div>
  );
}
