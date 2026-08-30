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
import { formatCompact, formatFundingApr, formatPercent, formatPrice, priceDecimalsFor } from '@/lib/format';
import { useLivePrice } from '@/store/livePrices';
import { usePreferences } from '@/store/preferences';
import { useWatchlists } from '@/store/watchlists';

const CHART_INTERVALS: { label: string; value: CandleInterval }[] = [
  { label: '5m', value: '5m' },
];

const QUICK_SYMBOLS = ['BTC', 'ETH', 'HYPE', 'SOL'];

function QuickMarket({
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
  const move = quote?.change24hPct;
  return (
    <button className={`web-xyz-quick-market${active ? ' is-active' : ''}`} type="button" onClick={onSelect}>
      <WebSymbolMark symbol={instrument.symbol} />
      <strong>{instrument.symbol}-{instrument.quoteCurrency ?? 'USDC'}</strong>
      <em className={move == null ? '' : move >= 0 ? 'is-up' : 'is-down'}>{formatPercent(move)}</em>
      <span>{formatPrice(last, priceDecimalsFor(instrument.priceDecimals, last))}</span>
    </button>
  );
}

function OrderBookPanel({
  instrument,
  mark,
  decimals,
}: {
  instrument?: Instrument;
  mark?: number;
  decimals: number;
}) {
  const coin = instrument?.id.startsWith('hl:') ? instrument.coinKey : undefined;
  const { data: book, isLoading } = useOrderBook(coin);

  const depth = useMemo(() => {
    const cumulative = (levels: NonNullable<typeof book>['bids']) => {
      let total = 0;
      return levels.slice(0, 12).map((level) => ({ ...level, total: (total += level.size) }));
    };
    const asks = cumulative(book?.asks ?? []).reverse();
    const bids = cumulative(book?.bids ?? []);
    const maxTotal = Math.max(1, ...asks.map((level) => level.total), ...bids.map((level) => level.total));
    const bestAsk = book?.asks[0]?.price;
    const bestBid = book?.bids[0]?.price;
    const spread = bestAsk != null && bestBid != null ? bestAsk - bestBid : undefined;
    const spreadPct = spread != null && bestBid ? (spread / bestBid) * 100 : undefined;
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
    <aside className="web-xyz-orderbook">
      <div className="web-xyz-side-head">
        <strong>Order Book (CLOB)</strong>
        <div><span className="web-book-pause" aria-hidden="true">Ⅱ</span><span className="web-book-layout-icon"><i /><i /></span></div>
      </div>
      <div className="web-book-labels"><span>Price</span><span>Size</span><span>Total</span></div>
      <div className="web-book-half is-asks">
        {depth.asks.length ? depth.asks.map((level) => renderLevel(level, 'ask')) : <span className="web-book-empty">{isLoading ? 'Loading depth…' : 'No ask depth'}</span>}
      </div>
      <div className="web-book-spread">
        <strong className="is-up">{formatPrice(mark, decimals)}</strong>
        <span>Spread: {depth.spreadPct == null ? '—' : `${depth.spreadPct.toFixed(3)}%`}</span>
      </div>
      <div className="web-book-half is-bids">
        {depth.bids.length ? depth.bids.map((level) => renderLevel(level, 'bid')) : <span className="web-book-empty">{isLoading ? 'Loading depth…' : 'No bid depth'}</span>}
      </div>
    </aside>
  );
}

function ReadOnlyTicket({ instrument, mark, decimals }: { instrument?: Instrument; mark?: number; decimals: number }) {
  return (
    <aside className="web-xyz-ticket">
      <div className="web-xyz-ticket-head">
        <span>Trading account</span>
        <div><button type="button" className="is-active">Personal</button><button type="button">View only</button></div>
      </div>
      <div className="web-ticket-controls">
        <button type="button">Cross</button><button type="button">10x</button><button type="button">Classic</button>
      </div>
      <div className="web-ticket-tabs"><button type="button" className="is-active">Market</button><button type="button">Limit</button><span>Pro⌄</span></div>
      <div className="web-ticket-side"><button type="button" className="is-long">Buy / Long</button><button type="button">Sell / Short</button></div>
      <div className="web-ticket-balance"><span>Available to Trade</span><b>$0.00 USDC</b><span>Current Position</span><b>0 {instrument?.symbol ?? '—'}</b></div>
      <div className="web-ticket-field"><span>Size</span><b>{instrument?.symbol ?? '—'}⌄</b></div>
      <div className="web-ticket-slider"><i /><span>0%</span></div>
      <label className="web-ticket-check"><i /> Reduce Only</label>
      <label className="web-ticket-check"><i /> Take Profit / Stop Loss</label>
      <div className="web-ticket-summary">
        <span>Mark Price</span><b>{formatPrice(mark, decimals)}</b>
        <span>Order Value</span><b>N/A</b>
        <span>Margin Required</span><b>N/A</b>
        <span>Slippage</span><b className="is-up">Est: 0% / Max: 1.00%</b>
        <span>Fees</span><b className="is-up">0% / 0%</b>
      </div>
      <div className="web-ticket-cta">
        <Link href="/account">Connect</Link>
        <p>View-only web workspace</p>
      </div>
    </aside>
  );
}

export default function WebWatchlistScreen() {
  const activeList = useWatchlists((state) => state.lists.find((list) => list.id === state.activeId) ?? state.lists[0]);
  const showClobOrderBook = usePreferences((state) => state.showClobOrderBook);
  const { data, isError, refetch } = useMarkets();
  const instruments = useInstrumentsByIds(activeList?.symbolIds ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chartInterval, setChartInterval] = useState<CandleInterval>('5m');

  const quickInstruments = useMemo(
    () => QUICK_SYMBOLS.map((symbol) => (
      data?.instruments.find((instrument) => instrument.symbol === symbol && instrument.assetClass === 'crypto-perp')
      ?? data?.instruments.find((instrument) => instrument.symbol === symbol)
    )).filter((instrument): instrument is Instrument => instrument !== undefined),
    [data?.instruments],
  );
  const feedInstruments = useMemo(() => {
    const byId = new Map([...instruments, ...quickInstruments].map((instrument) => [instrument.id, instrument]));
    return [...byId.values()];
  }, [instruments, quickInstruments]);
  useLivePriceFeed(feedInstruments);

  const fallbackSelected = quickInstruments.find((instrument) => instrument.symbol === 'HYPE') ?? quickInstruments[0] ?? instruments[0];
  const selected = (selectedId ? data?.instruments.find((instrument) => instrument.id === selectedId) : undefined) ?? fallbackSelected;
  const quote = selected ? data?.quotes[selected.id] : undefined;
  const streamed = useLivePrice(selected?.coinKey);
  const last = streamed ?? quote?.last;
  const decimals = selected ? priceDecimalsFor(selected.priceDecimals, last) : 2;
  const { data: candles, isLoading: chartLoading } = useCandles(selected, chartInterval, 180);

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
    <div className="web-terminal web-xyz-terminal">
      <section className="web-xyz-marketbar">
        <Link href="/markets" className="web-xyz-market-selector">
          {selected ? <WebSymbolMark symbol={selected.symbol} /> : null}
          <strong>{selected?.symbol ?? '—'}-{selected?.quoteCurrency ?? 'USDC'}</strong>
          <span>{selected?.assetClass === 'crypto-spot' ? 'Spot' : '10x'}</span>
          <span className="web-market-chevron" aria-hidden="true">⌄</span>
        </Link>
        <div className="web-xyz-primary-price"><strong>{formatPrice(last, decimals)}</strong><span>Mark Price</span></div>
        <div><strong className={(quote?.change24hPct ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatPercent(quote?.change24hPct)}</strong><span>24h Change</span></div>
        <div><strong>—</strong><span>Oracle</span></div>
        <div><strong>{quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}</strong><span>24h Volume</span></div>
        <div><strong>—</strong><span>Open Interest</span></div>
        <div><strong className={(quote?.funding ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatFundingApr(quote?.funding)}</strong><span>Funding APR</span></div>
      </section>

      <div className={`web-xyz-workspace${showClobOrderBook ? '' : ' is-orderbook-hidden'}`}>
        <section className="web-xyz-center">
          <div className="web-xyz-quickbar">
            {quickInstruments.map((instrument) => (
              <QuickMarket
                key={instrument.id}
                instrument={instrument}
                quote={data?.quotes[instrument.id]}
                active={selected?.id === instrument.id}
                onSelect={() => setSelectedId(instrument.id)}
              />
            ))}
          </div>
          <div className="web-xyz-chart-surface">
            <div className="web-xyz-chart-tools">
              {CHART_INTERVALS.map((item) => <button key={item.value} className={chartInterval === item.value ? 'is-active' : ''} type="button" onClick={() => setChartInterval(item.value)}>{item.label}</button>)}
              <span />
              <Link href="/settings">MA</Link>
            </div>
            <div className="web-xyz-chart-card"><WebMarketChart candles={candles ?? []} decimals={decimals} loading={chartLoading} /></div>
          </div>
          <WebAccountDock />
        </section>

        {showClobOrderBook ? <OrderBookPanel instrument={selected} mark={last} decimals={decimals} /> : null}
        <ReadOnlyTicket instrument={selected} mark={last} decimals={decimals} />
      </div>
    </div>
  );
}
