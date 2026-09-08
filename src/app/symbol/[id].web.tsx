import { Ionicons } from '@expo/vector-icons';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { WebMarketChart } from '@/components/web/WebMarketChart';
import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { InstrumentNewsLink } from '@/components/InstrumentNews';
import { useCandles } from '@/data/useCandles';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useAllMarkets } from '@/data/useMarkets';
import { resolveRange, type RangeKey } from '@/domain/ranges';
import { formatCompact, formatFundingApr, formatPercent, formatPrice, priceDecimalsFor } from '@/lib/format';
import { useAlerts } from '@/store/alerts';
import { useMarketPrice } from '@/store/livePrices';
import { marketCatalogErrorForId, marketDataError } from '@/lib/marketCatalog';
import { useWatchlists } from '@/store/watchlists';

const WEB_RANGES: RangeKey[] = ['1D', '1W', '1M', '3M', '1Y'];

export default function WebSymbolScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useAllMarkets();
  const instrument = id ? data?.byId[id] : undefined;
  const quote = id ? data?.quotes[id] : undefined;
  const [range, setRange] = useState<RangeKey>('1D');
  const [alertPct, setAlertPct] = useState('5');
  const [alertSaved, setAlertSaved] = useState(false);
  const resolved = resolveRange(range);
  const { data: candles, isLoading: chartLoading, historyError, isFetching: chartRefreshing, refetch: refreshChart } = useCandles(instrument, resolved.interval, resolved.fetch);
  useLivePriceFeed(instrument ? [instrument] : []);
  const priceState = useMarketPrice(instrument, quote);
  const last = priceState.last;
  const activeId = useWatchlists((state) => state.activeId);
  const watched = useWatchlists((state) => state.lists.find((list) => list.id === state.activeId)?.symbolIds.includes(id ?? '') ?? false);
  const toggle = useWatchlists((state) => state.toggle);
  const addAlert = useAlerts((state) => state.add);

  const saveAlert = () => {
    const pct = Number(alertPct);
    if (!instrument || !last || priceState.stale || !Number.isFinite(pct) || pct <= 0) return;
    addAlert({ instrumentId: instrument.id, symbol: instrument.symbol, pct, direction: 'both', anchorPrice: last });
    setAlertSaved(true);
    window.setTimeout(() => setAlertSaved(false), 1800);
  };

  if (isLoading) return <section className="web-state-card"><div className="web-chart-empty is-loading"><span /><p>Loading market</p></div></section>;
  if (isError || (!instrument && marketCatalogErrorForId(id, data?.marketErrors))) return <section className="web-state-card"><Ionicons name="cloud-offline-outline" size={23} color="currentColor" /><h2>Market unavailable</h2><p>The market catalog could not be loaded.</p><button type="button" onClick={() => void refetch()}>Retry</button></section>;
  if (!instrument) return <section className="web-state-card"><Ionicons name="search-outline" size={23} color="currentColor" /><h2>Market not found</h2><p>This symbol is no longer in the live catalog.</p><Link href="/markets" className="web-primary-button">Browse markets</Link></section>;

  const decimals = priceDecimalsFor(instrument.priceDecimals, last);

  return (
    <div className="web-content-stack web-symbol-page">
      <section className="web-symbol-page-header">
        <div>
          <Link href="/" className="web-back-link"><Ionicons name="arrow-back" size={15} color="currentColor" /> Trade</Link>
          <div className="web-symbol-title"><WebSymbolMark symbol={instrument.symbol} large /><div><div><h2>{instrument.symbol}</h2><span className="web-venue-pill">{instrument.venue}</span></div><p>{instrument.name}</p></div></div>
        </div>
        <div className="web-symbol-actions">
          <InstrumentNewsLink instrument={instrument} />
          <button className={`web-quiet-button${watched ? ' is-selected' : ''}`} type="button" onClick={() => toggle(activeId, instrument.id)}><Ionicons name={watched ? 'bookmark' : 'bookmark-outline'} size={15} color="currentColor" /> {watched ? 'Watching' : 'Add to watchlist'}</button>
        </div>
      </section>

      <div className="web-symbol-layout">
        <section className="web-symbol-chart-panel web-panel">
          <div className="web-symbol-quote">
            <div><span>LAST PRICE · {priceState.label}</span><strong>{formatPrice(last, decimals)}</strong><em className={(quote?.change24hPct ?? 0) >= 0 ? 'is-up' : 'is-down'}>{formatPercent(quote?.change24hPct)} today</em></div>
            <div className="web-mini-tabs" aria-label="Chart time range">{WEB_RANGES.map((item) => <button key={item} type="button" aria-pressed={range === item} className={range === item ? 'is-active' : ''} onClick={() => setRange(item)}>{item}</button>)}</div>
          </div>
          <div className="web-symbol-chart-wrap"><WebMarketChart candles={candles ?? []} decimals={decimals} loading={chartLoading} /></div>
          {historyError || marketDataError(instrument, data?.marketErrors) ? <div role="status" className="web-inline-notice">
            {historyError ? 'Chart history may be incomplete.' : 'Market details unavailable. Showing saved data.'}{' '}
            <button type="button" className="web-quiet-button" disabled={chartRefreshing} onClick={() => { void refreshChart(); void refetch(); }}>{chartRefreshing ? 'Refreshing…' : 'Retry'}</button>
          </div> : null}
          <div className="web-symbol-stats">
            <div><span>24H VOLUME</span><strong>{quote?.dayVolume == null ? '—' : `$${formatCompact(quote.dayVolume)}`}</strong></div>
            <div><span>PREVIOUS CLOSE</span><strong>{formatPrice(quote?.prevClose, decimals)}</strong></div>
            <div><span>FUNDING APR</span><strong>{formatFundingApr(quote?.funding)}</strong></div>
            <div><span>QUOTE</span><strong>{instrument.quoteCurrency ?? 'USD'}</strong></div>
          </div>
        </section>

        <aside className="web-symbol-side">
          <section className="web-market-info web-panel">
            <span className="web-section-kicker">MARKET INFO</span>
            <div><span>Asset class</span><strong>{instrument.assetClass.replace('-', ' ')}</strong></div>
            <div><span>Venue</span><strong>{instrument.venue}</strong></div>
            <div><span>Provider</span><strong>{instrument.source === 'hyperliquid' ? 'Hyperliquid' : 'Cboe'}</strong></div>
            <div><span>Feed</span><strong className={priceState.status === 'live' ? 'is-up' : undefined}>{priceState.label}</strong></div>
          </section>

          <section className="web-alert-builder web-panel">
            <span className="web-section-kicker">PRICE ALERT</span>
            <h3>Create alert</h3>
            <p>Save a local alert when {instrument.symbol} moves either way from {formatPrice(last, decimals)}.</p>
            <label><span>Move threshold</span><div><input type="number" min="0.1" step="0.1" value={alertPct} onChange={(event) => setAlertPct(event.target.value)} /><em>%</em></div></label>
            <button type="button" onClick={saveAlert} disabled={!last || priceState.stale}>{alertSaved ? <><Ionicons name="checkmark" size={16} color="currentColor" /> Saved</> : <><Ionicons name="notifications-outline" size={16} color="currentColor" /> {priceState.stale ? 'Waiting for a fresh price' : 'Create alert'}</>}</button>
            <small>Stored in this browser. Configure monitored alerts separately in the iPhone app.</small>
          </section>
        </aside>
      </div>
    </div>
  );
}
