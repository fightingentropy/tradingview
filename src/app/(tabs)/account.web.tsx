import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';

import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useHlAccount, useHlOpenOrders } from '@/data/useHlAccount';
import { useAllMarkets } from '@/data/useMarkets';
import { formatPercent, formatPrice, signedUsd, usd } from '@/lib/format';
import { DEMO_ADDRESS, isHexAddress, useHlConnection } from '@/store/hlConnection';
import { usePreferences } from '@/store/preferences';

type PortfolioTab = 'trades' | 'orders';

export default function WebAccountScreen() {
  const address = useHlConnection((state) => state.address);
  const demo = useHlConnection((state) => state.demo);
  const setAddress = useHlConnection((state) => state.setAddress);
  const connectDemo = useHlConnection((state) => state.connectDemo);
  const disconnect = useHlConnection((state) => state.disconnect);
  const privacy = usePreferences((state) => state.privacyMode);
  const setPrivacy = usePreferences((state) => state.setPrivacyMode);
  const [draft, setDraft] = useState(address ?? '');
  const [inputError, setInputError] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [tab, setTab] = useState<PortfolioTab>('trades');
  const account = useHlAccount();
  const orders = useHlOpenOrders();
  const { data: markets } = useAllMarkets();

  const connect = () => {
    const next = draft.trim();
    if (!isHexAddress(next)) {
      setInputError('Enter a valid 0x account address.');
      return;
    }
    setInputError('');
    setAddress(next);
  };
  const display = (value: number, signed = false) => privacy ? '••••' : signed ? signedUsd(value) : usd(value);

  if (!address) {
    return (
      <div className="web-capital-portfolio-page">
        <nav className="web-capital-portfolio-tabs"><button type="button" className="is-active">Trades</button><button type="button">Orders</button></nav>
        <section className="web-capital-empty-state web-capital-portfolio-empty">
          <span className="web-capital-empty-glyph"><Ionicons name="wallet-outline" size={44} color="currentColor" /></span>
          <h1>No account connected</h1>
          <p>Connect a public Hyperliquid address to see trades, orders and portfolio performance.</p>
          {!connectOpen ? <button type="button" onClick={() => setConnectOpen(true)}>Connect account</button> : (
            <div className="web-capital-connect-box">
              <label><span>Public account address</span><div><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="0x…" spellCheck={false} autoFocus /><button type="button" onClick={connect}>Connect</button></div>{inputError ? <small>{inputError}</small> : null}</label>
              <button type="button" className="is-demo" onClick={() => connectDemo(DEMO_ADDRESS)}><Ionicons name="eye-outline" size={15} color="currentColor" /> Preview public demo</button>
              <p><Ionicons name="shield-checkmark-outline" size={14} color="currentColor" /> View-only. No signing key is used.</p>
            </div>
          )}
        </section>
      </div>
    );
  }

  if (account.isError) {
    return <section className="web-capital-empty-state"><Ionicons name="cloud-offline-outline" size={44} color="currentColor" /><h1>Portfolio unavailable</h1><p>The public account read failed. Nothing was changed.</p><button type="button" onClick={() => void account.refetch()}>Try again</button></section>;
  }

  return (
    <div className="web-capital-portfolio-page">
      <nav className="web-capital-portfolio-tabs">
        <button type="button" className={tab === 'trades' ? 'is-active' : ''} onClick={() => setTab('trades')}>Trades</button>
        <button type="button" className={tab === 'orders' ? 'is-active' : ''} onClick={() => setTab('orders')}>Orders{orders.data?.length ? ` (${orders.data.length})` : ''}</button>
      </nav>
      <div className="web-capital-account-toolbar">
        <span><small>{demo ? 'Public demo' : 'Connected account'}</small><strong>{address.slice(0, 7)}…{address.slice(-5)}</strong></span>
        <div><button type="button" onClick={() => setPrivacy(!privacy)} aria-label={privacy ? 'Show account values' : 'Hide account values'}><Ionicons name={privacy ? 'eye-off-outline' : 'eye-outline'} size={17} color="currentColor" /></button><button type="button" onClick={disconnect}>Disconnect</button></div>
      </div>
      <section className="web-capital-account-metrics">
        <span><small>Equity</small><strong>{account.data ? display(account.data.totalEquity) : '—'}</strong></span>
        <span><small>P&amp;L</small><strong className={(account.data?.unrealizedPnl ?? 0) >= 0 ? 'is-up' : 'is-down'}>{account.data ? display(account.data.unrealizedPnl, true) : '—'}</strong></span>
        <span><small>Available</small><strong>{account.data ? display(account.data.freeCollateral) : '—'}</strong></span>
        <span><small>Margin use</small><strong>{account.data?.maintenanceUsage == null ? '—' : privacy ? '••••' : formatPercent(account.data.maintenanceUsage * 100)}</strong></span>
      </section>

      {tab === 'trades' ? (
        <section className="web-capital-portfolio-table">
          <div className="web-capital-portfolio-head"><span>Market</span><span>Direction</span><span>Size</span><span>Entry</span><span>Mark</span><span>Leverage</span><span>P&amp;L</span><span /></div>
          {account.isLoading ? <div className="web-capital-portfolio-loading"><span /><span /><span /></div> : account.data?.positions.length ? account.data.positions.map((position) => {
            const instrument = markets?.byCoinKey.get(position.coin);
            const symbol = instrument?.symbol ?? position.coin.replace(/^xyz:/, '');
            return (
              <div className="web-capital-portfolio-row" key={`${position.dex}:${position.coin}`}>
                <Link href={instrument ? { pathname: '/symbol/[id]', params: { id: instrument.id } } : '/markets'}><WebSymbolMark symbol={symbol} /><span><strong>{symbol}</strong><small>{instrument?.name ?? position.dex}</small></span></Link>
                <span className={position.side === 'long' ? 'is-up' : 'is-down'}>{position.side === 'long' ? 'Buy' : 'Sell'}</span>
                <span>{privacy ? '••••' : formatPrice(position.size)}</span><span>{formatPrice(position.entryPx)}</span><span>{formatPrice(position.markPx)}</span><span>{position.leverage}x {position.leverageType}</span><strong className={position.unrealizedPnl >= 0 ? 'is-up' : 'is-down'}>{display(position.unrealizedPnl, true)}</strong><Link href={instrument ? { pathname: '/symbol/[id]', params: { id: instrument.id } } : '/markets'}>View</Link>
              </div>
            );
          }) : <section className="web-capital-empty-state is-inline"><span className="web-capital-empty-glyph"><Ionicons name="briefcase-outline" size={40} color="currentColor" /></span><h1>Nothing to show...yet!</h1><p>Open positions will appear here.</p><Link href="/">Explore markets</Link></section>}
        </section>
      ) : (
        <section className="web-capital-portfolio-table">
          <div className="web-capital-order-head"><span>Market</span><span>Side</span><span>Type</span><span>Price</span><span>Size</span><span>Status</span><span /></div>
          {orders.isLoading ? <div className="web-capital-portfolio-loading"><span /><span /><span /></div> : orders.data?.length ? orders.data.map((order) => {
            const instrument = markets?.byCoinKey.get(order.coin);
            const symbol = instrument?.symbol ?? order.coin.replace(/^xyz:/, '');
            return <div className="web-capital-order-row" key={order.oid}><span><WebSymbolMark symbol={symbol} /><strong>{symbol}</strong></span><strong className={order.side === 'buy' ? 'is-up' : 'is-down'}>{order.side === 'buy' ? 'Buy' : 'Sell'}</strong><span>{order.orderType}</span><span>{formatPrice(order.triggerPx ?? order.limitPx)}</span><span>{privacy ? '••••' : formatPrice(order.origSize)}</span><span>Open</span><Link href={instrument ? { pathname: '/symbol/[id]', params: { id: instrument.id } } : '/markets'}>View</Link></div>;
          }) : <section className="web-capital-empty-state is-inline"><span className="web-capital-empty-glyph"><Ionicons name="receipt-outline" size={40} color="currentColor" /></span><h1>No open orders</h1><p>Your working orders will appear here.</p><Link href="/">Explore markets</Link></section>}
        </section>
      )}
    </div>
  );
}
