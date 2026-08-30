import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';

import { WebAccountDock } from '@/components/web/WebAccountDock';
import { WebMarketChart } from '@/components/web/WebMarketChart';
import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useActiveAsset } from '@/data/useActiveAsset';
import { useCandles } from '@/data/useCandles';
import { useHlAccount } from '@/data/useHlAccount';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useMarkets } from '@/data/useMarkets';
import { useOrderBook } from '@/data/useOrderBook';
import type { CandleInterval, Instrument, Quote } from '@/domain/types';
import {
  formatCompact,
  formatFundingApr,
  formatPercent,
  formatPrice,
  priceDecimalsFor,
  signedUsd,
  usd,
} from '@/lib/format';
import { useHlConnection } from '@/store/hlConnection';
import { useLivePrice } from '@/store/livePrices';
import { usePreferences } from '@/store/preferences';

const CHART_INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const QUICK_SYMBOLS = ['HYPE', 'BTC', 'ETH', 'SOL', 'ZEC'];

function pairLabel(instrument?: Instrument) {
  return instrument ? `${instrument.symbol}-USD` : '—';
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function MarketOption({
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
    <button className={active ? 'is-active' : ''} type="button" onClick={onSelect}>
      <WebSymbolMark symbol={instrument.symbol} />
      <span><strong>{pairLabel(instrument)}</strong><small>{instrument.venue} perpetual</small></span>
      <b>{formatPrice(last, priceDecimalsFor(instrument.priceDecimals, last))}</b>
      <em className={move == null ? '' : move >= 0 ? 'is-up' : 'is-down'}>{formatPercent(move)}</em>
    </button>
  );
}

function OrderBookPanel({ instrument, mark, decimals }: { instrument?: Instrument; mark?: number; decimals: number }) {
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
    return { asks, bids, maxTotal, spread, spreadPct };
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
    <aside className="web-xyz-orderbook web-hl-orderbook">
      <div className="web-xyz-side-head">
        <strong>Order Book</strong>
        <div><span className="web-hl-book-tick">0.01</span><span className="web-book-layout-icon"><i /><i /></span></div>
      </div>
      <div className="web-book-labels"><span>Price</span><span>Size</span><span>Total</span></div>
      <div className="web-book-half is-asks">
        {depth.asks.length ? depth.asks.map((level) => renderLevel(level, 'ask')) : <span className="web-book-empty">{isLoading ? 'Loading depth…' : 'No ask depth'}</span>}
      </div>
      <div className="web-book-spread">
        <strong className="is-up">{formatPrice(mark, decimals)}</strong>
        <span>{depth.spread == null ? '—' : formatPrice(depth.spread, decimals)} · {depth.spreadPct == null ? '—' : `${depth.spreadPct.toFixed(3)}%`}</span>
      </div>
      <div className="web-book-half is-bids">
        {depth.bids.length ? depth.bids.map((level) => renderLevel(level, 'bid')) : <span className="web-book-empty">{isLoading ? 'Loading depth…' : 'No bid depth'}</span>}
      </div>
    </aside>
  );
}

function ReadOnlyTicket({ instrument, mark, decimals }: { instrument?: Instrument; mark?: number; decimals: number }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [allocation, setAllocation] = useState(0);
  const address = useHlConnection((state) => state.address);
  const network = useHlConnection((state) => state.network);
  const privacy = usePreferences((state) => state.privacyMode);
  const account = useHlAccount();
  const coin = instrument?.id.startsWith('hl:') ? instrument.coinKey : undefined;
  const active = useActiveAsset(coin);
  const position = account.data?.positions.find((item) => item.coin === coin);
  const leverage = active.data?.leverage ?? position?.leverage;
  const isCross = active.data?.isCross ?? position?.leverageType === 'cross';
  const available = side === 'buy' ? active.data?.availBuy : active.data?.availSell;
  const maxSize = side === 'buy' ? active.data?.maxSzBuy : active.data?.maxSzSell;
  const resolvedMark = active.data?.markPx || mark;
  const signedPositionSize = position ? (position.side === 'long' ? position.size : -position.size) : 0;
  const orderValue = allocation && maxSize && resolvedMark ? (maxSize * allocation * resolvedMark) / 100 : null;
  const marginRequired = orderValue && leverage ? orderValue / leverage : null;
  const marginUsage = account.data && account.data.totalEquity > 0
    ? (account.data.totalMarginUsed / account.data.totalEquity) * 100
    : null;
  const hide = (value: string) => privacy ? '••••••' : value;

  return (
    <aside className="web-xyz-ticket web-hl-ticket">
      <div className="web-xyz-ticket-head">
        <span>Trade</span>
        {address ? <Link href="/account" className="web-hl-connected"><i />{shortAddress(address)}</Link> : <Link href="/account" className="web-hl-connected">Connect</Link>}
      </div>

      <div className="web-ticket-controls">
        <button type="button">{isCross ? 'Cross' : 'Isolated'}</button>
        <button type="button">{leverage ? `${leverage}x` : '—x'}</button>
        <button type="button">One-way</button>
      </div>
      <div className="web-ticket-tabs">
        <button type="button" className={orderType === 'market' ? 'is-active' : ''} onClick={() => setOrderType('market')}>Market</button>
        <button type="button" className={orderType === 'limit' ? 'is-active' : ''} onClick={() => setOrderType('limit')}>Limit</button>
        <span>Perpetual</span>
      </div>
      <div className="web-ticket-side">
        <button type="button" className={side === 'buy' ? 'is-long' : ''} onClick={() => setSide('buy')}>Buy / Long</button>
        <button type="button" className={side === 'sell' ? 'is-short' : ''} onClick={() => setSide('sell')}>Sell / Short</button>
      </div>
      <div className="web-ticket-balance">
        <span>Available to trade</span><b>{hide(available == null ? '—' : usd(available))}</b>
        <span>Current position</span><b>{hide(`${formatPrice(signedPositionSize, 4)} ${instrument?.symbol ?? '—'}`)}</b>
      </div>
      <div className="web-ticket-field"><span>Size</span><b>{allocation ? `${formatPrice(((maxSize ?? 0) * allocation) / 100, 4)} ${instrument?.symbol ?? '—'}` : `0.0000 ${instrument?.symbol ?? '—'}`}</b></div>
      <div className="web-hl-allocation" aria-label="Order size percentage">
        {[0, 25, 50, 75, 100].map((value) => <button key={value} type="button" className={allocation === value ? 'is-active' : ''} onClick={() => setAllocation(value)}>{value}%</button>)}
      </div>
      <label className="web-ticket-check"><i /> Reduce only</label>
      <label className="web-ticket-check"><i /> Take profit / stop loss</label>
      <div className="web-ticket-summary">
        <span>Mark price</span><b>{formatPrice(resolvedMark, decimals)}</b>
        <span>Order value</span><b>{orderValue == null ? '—' : hide(usd(orderValue))}</b>
        <span>Margin required</span><b>{marginRequired == null ? '—' : hide(usd(marginRequired))}</b>
        <span>Max slippage</span><b>0.50%</b>
      </div>
      <div className="web-ticket-cta">
        <Link href="/account">{address ? 'View account' : 'Connect account'}</Link>
        <p>Read-only workspace · orders are never submitted</p>
      </div>

      <div className="web-hl-account-summary">
        <header><strong>Account</strong><span>{network === 'mainnet' ? 'Mainnet' : 'Testnet'}</span></header>
        <div><span>Equity</span><b>{hide(account.data ? usd(account.data.totalEquity) : '—')}</b></div>
        <div><span>Unrealized P&amp;L</span><b className={(account.data?.unrealizedPnl ?? 0) >= 0 ? 'is-up' : 'is-down'}>{hide(account.data ? signedUsd(account.data.unrealizedPnl) : '—')}</b></div>
        <div><span>Free collateral</span><b>{hide(account.data ? usd(account.data.freeCollateral) : '—')}</b></div>
        <div><span>Margin used</span><b>{hide(account.data ? usd(account.data.totalMarginUsed) : '—')}</b></div>
        <div><span>Margin usage</span><b>{hide(marginUsage == null ? '—' : `${marginUsage.toFixed(2)}%`)}</b></div>
      </div>
    </aside>
  );
}

export default function WebTradeScreen() {
  const showClobOrderBook = usePreferences((state) => state.showClobOrderBook);
  const { data, isError, refetch } = useMarkets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chartInterval, setChartInterval] = useState<CandleInterval>('5m');
  const [marketMenuOpen, setMarketMenuOpen] = useState(false);

  const marketOptions = useMemo(() => {
    const perps = (data?.instruments ?? [])
      .filter((instrument) => instrument.assetClass === 'crypto-perp')
      .sort((left, right) => (data?.quotes[right.id]?.dayVolume ?? -1) - (data?.quotes[left.id]?.dayVolume ?? -1));
    const picked = QUICK_SYMBOLS.map((symbol) => perps.find((instrument) => instrument.symbol === symbol))
      .filter((instrument): instrument is Instrument => instrument !== undefined);
    return [...new Map([...picked, ...perps].map((instrument) => [instrument.id, instrument])).values()].slice(0, 9);
  }, [data?.instruments, data?.quotes]);

  const fallbackSelected = data?.instruments.find((instrument) => instrument.symbol === 'HYPE' && instrument.assetClass === 'crypto-perp')
    ?? marketOptions[0];
  const selected = (selectedId ? data?.instruments.find((instrument) => instrument.id === selectedId) : undefined) ?? fallbackSelected;
  const quote = selected ? data?.quotes[selected.id] : undefined;
  const streamed = useLivePrice(selected?.coinKey);
  const last = streamed ?? quote?.last;
  const decimals = selected ? priceDecimalsFor(selected.priceDecimals, last) : 2;
  const { data: candles, isLoading: chartLoading } = useCandles(selected, chartInterval, 220);
  useLivePriceFeed(marketOptions);

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
    <div className="web-terminal web-xyz-terminal web-hl-terminal">
      <section className="web-xyz-marketbar web-hl-marketbar">
        <div className="web-hl-market-picker">
          <button type="button" className="web-xyz-market-selector" aria-haspopup="listbox" aria-expanded={marketMenuOpen} onClick={() => setMarketMenuOpen((open) => !open)}>
            {selected ? <WebSymbolMark symbol={selected.symbol} /> : null}
            <span><strong>{pairLabel(selected)}</strong><small>{selected?.venue ?? 'Hyperliquid'} perpetual</small></span>
            <span className="web-market-chevron" aria-hidden="true"><Ionicons name="chevron-down" size={14} color="currentColor" /></span>
          </button>
          {marketMenuOpen ? (
            <div className="web-hl-market-menu" role="listbox" aria-label="Select market">
              <header><strong>Markets</strong><Link href="/markets">Discover all</Link></header>
              {marketOptions.map((instrument) => (
                <MarketOption
                  key={instrument.id}
                  instrument={instrument}
                  quote={data?.quotes[instrument.id]}
                  active={selected?.id === instrument.id}
                  onSelect={() => { setSelectedId(instrument.id); setMarketMenuOpen(false); }}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="web-xyz-primary-price"><strong>{formatPrice(last, decimals)}</strong><span>Mark</span></div>
        <div><strong className={(quote?.change24hPct ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatPercent(quote?.change24hPct)}</strong><span>24h change</span></div>
        <div><strong>{quote?.prevClose == null ? '—' : formatPrice(quote.prevClose, decimals)}</strong><span>Prev. close</span></div>
        <div><strong>{quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}</strong><span>24h volume</span></div>
        <div><strong className={(quote?.funding ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatFundingApr(quote?.funding)}</strong><span>Funding APR</span></div>
        <Link href="/markets" className="web-hl-all-markets">All markets <Ionicons name="chevron-forward" size={13} color="currentColor" /></Link>
      </section>

      <div className={`web-xyz-workspace web-hl-workspace${showClobOrderBook ? '' : ' is-orderbook-hidden'}`}>
        <section className="web-xyz-center web-hl-center">
          <div className="web-xyz-chart-surface web-hl-chart-surface">
            <div className="web-hl-chart-toolbar">
              <strong>Chart</strong>
              <span className="web-hl-toolbar-divider" />
              {CHART_INTERVALS.map((interval) => <button key={interval} className={chartInterval === interval ? 'is-active' : ''} type="button" onClick={() => setChartInterval(interval)}>{interval}</button>)}
              <span className="web-hl-toolbar-divider" />
              <button type="button"><Ionicons name="stats-chart-outline" size={15} color="currentColor" /> Indicators</button>
              {selected ? <Link href={{ pathname: '/symbol/[id]', params: { id: selected.id } }}><Ionicons name="expand-outline" size={15} color="currentColor" /> Full chart</Link> : null}
            </div>
            <div className="web-hl-chart-identity">
              <strong>{pairLabel(selected)} · {chartInterval}</strong>
              <span className={(quote?.change24hPct ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatPrice(last, decimals)} · {formatPercent(quote?.change24hPct)}</span>
              <small>Perpetual · {selected?.venue ?? 'Hyperliquid'} · Funding {formatFundingApr(quote?.funding)}</small>
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
