import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';

import { WebMarketChart } from '@/components/web/WebMarketChart';
import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useCandles } from '@/data/useCandles';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useInstrumentsByIds, useMarkets } from '@/data/useMarkets';
import type { Instrument, Quote } from '@/domain/types';
import { formatCompact, formatFundingApr, formatPercent, formatPrice, priceDecimalsFor } from '@/lib/format';
import { useLivePrice } from '@/store/livePrices';
import { useWatchlists } from '@/store/watchlists';

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
        <span>
          <strong>{instrument.symbol}</strong>
          <small>{instrument.name}</small>
        </span>
      </span>
      <span className="web-watch-price">
        <strong>{formatPrice(last, priceDecimalsFor(instrument.priceDecimals, last))}</strong>
        <small className={change == null ? '' : change >= 0 ? 'is-up' : 'is-down'}>{formatPercent(change)}</small>
      </span>
    </button>
  );
}

export default function WebWatchlistScreen() {
  const activeList = useWatchlists((state) => state.lists.find((list) => list.id === state.activeId) ?? state.lists[0]);
  const { data, isLoading, isError, refetch } = useMarkets();
  const instruments = useInstrumentsByIds(activeList?.symbolIds ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useLivePriceFeed(instruments);
  const selected = instruments.find((instrument) => instrument.id === selectedId) ?? instruments[0];
  const quote = selected ? data?.quotes[selected.id] : undefined;
  const streamed = useLivePrice(selected?.coinKey);
  const last = streamed ?? quote?.last;
  const { data: candles, isLoading: chartLoading } = useCandles(selected, '1h', 180);

  const movers = useMemo(() => {
    if (!data) return [];
    return instruments
      .filter((instrument) => data.quotes[instrument.id]?.change24hPct != null)
      .sort((left, right) => Math.abs(data.quotes[right.id].change24hPct ?? 0) - Math.abs(data.quotes[left.id].change24hPct ?? 0))
      .slice(0, 3);
  }, [data, instruments]);

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

  return (
    <div className="web-dashboard-grid">
      <section className="web-watch-panel web-panel">
        <div className="web-panel-heading">
          <div>
            <span className="web-section-kicker">MY LIST</span>
            <h2>{activeList?.name ?? 'Watchlist'}</h2>
          </div>
          <Link href="/markets" className="web-icon-button" aria-label="Add markets">
            <Ionicons name="add" size={20} color="currentColor" />
          </Link>
        </div>
        <div className="web-watch-labels" aria-hidden="true">
          <span>Market</span>
          <span>Price / 24h</span>
        </div>
        <div className="web-watch-list">
          {isLoading
            ? Array.from({ length: 8 }, (_, index) => <span className="web-watch-skeleton" key={index} />)
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
        <div className="web-focus-header">
          <div className="web-focus-identity">
            {selected ? <WebSymbolMark symbol={selected.symbol} large /> : <span className="web-symbol-mark" />}
            <div>
              <div className="web-focus-symbol-line">
                <h2>{selected?.symbol ?? 'Markets'}</h2>
                {selected ? <span className="web-venue-pill">{selected.venue}</span> : null}
              </div>
              <p>{selected?.name ?? 'Loading live market data'}</p>
            </div>
          </div>
          {selected ? (
            <Link href={{ pathname: '/symbol/[id]', params: { id: selected.id } }} className="web-quiet-button">
              Open detail <Ionicons name="arrow-forward" size={15} color="currentColor" />
            </Link>
          ) : null}
        </div>

        <div className="web-quote-strip">
          <div>
            <span>LAST PRICE</span>
            <strong>{selected ? formatPrice(last, priceDecimalsFor(selected.priceDecimals, last)) : '—'}</strong>
          </div>
          <div>
            <span>24H CHANGE</span>
            <strong className={(quote?.change24hPct ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatPercent(quote?.change24hPct)}</strong>
          </div>
          <div>
            <span>24H VOLUME</span>
            <strong>{quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}</strong>
          </div>
          <div>
            <span>FUNDING APR</span>
            <strong>{formatFundingApr(quote?.funding)}</strong>
          </div>
        </div>

        <div className="web-chart-card">
          <div className="web-chart-toolbar">
            <span>Price</span>
            <div><button className="is-active" type="button">1D</button><button type="button">1W</button><button type="button">1M</button><button type="button">1Y</button></div>
          </div>
          <WebMarketChart
            candles={candles ?? []}
            decimals={selected ? priceDecimalsFor(selected.priceDecimals, last) : 2}
            loading={chartLoading}
          />
        </div>
      </section>

      <aside className="web-pulse-panel web-panel">
        <div className="web-panel-heading">
          <div>
            <span className="web-section-kicker">MARKET PULSE</span>
            <h2>In your list</h2>
          </div>
          <span className="web-live-badge"><span /> Live</span>
        </div>
        <div className="web-pulse-list">
          {movers.map((instrument, index) => {
            const move = data?.quotes[instrument.id]?.change24hPct;
            return (
              <button key={instrument.id} type="button" onClick={() => setSelectedId(instrument.id)}>
                <span className="web-pulse-rank">0{index + 1}</span>
                <span><strong>{instrument.symbol}</strong><small>{instrument.venue}</small></span>
                <strong className={(move ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatPercent(move)}</strong>
              </button>
            );
          })}
        </div>
        <div className="web-pulse-note">
          <Ionicons name="flash-outline" size={18} color="currentColor" />
          <div><strong>Live and keyless</strong><p>Prices stream directly from Hyperliquid, trade.xyz and Cboe.</p></div>
        </div>
      </aside>
    </div>
  );
}
