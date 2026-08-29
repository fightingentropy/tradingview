import { Link } from 'expo-router';
import { useMemo, useState } from 'react';

import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import {
  useHlAccount,
  useHlFills,
  useHlHistoricalOrders,
  useHlOpenOrders,
} from '@/data/useHlAccount';
import { useAllMarkets } from '@/data/useMarkets';
import type { Instrument } from '@/domain/types';
import { formatPrice, signedUsd, usd } from '@/lib/format';
import type {
  HlFill,
  HlHistoricalOrder,
  HlOpenOrder,
  HlPosition,
  HlSpotBalance,
} from '@/lib/hyperliquid/info';
import { useHlConnection } from '@/store/hlConnection';
import { SMALL_BALANCE_USD, usePreferences } from '@/store/preferences';

type AccountDockTab = 'balances' | 'positions' | 'openOrders' | 'orderHistory' | 'tradeHistory';

const TABS: { key: AccountDockTab; label: string }[] = [
  { key: 'balances', label: 'Balances' },
  { key: 'positions', label: 'Positions' },
  { key: 'openOrders', label: 'Open Orders' },
  { key: 'orderHistory', label: 'Order History' },
  { key: 'tradeHistory', label: 'Trade History' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function marketCoinKey(coin: string) {
  const token = /^\+(\d+)$/.exec(coin);
  return token ? `#${token[1]}` : coin;
}

function cleanCoin(coin: string) {
  const normalized = marketCoinKey(coin);
  const outcome = /^#(\d+)$/.exec(normalized);
  return outcome ? `Outcome #${outcome[1]}` : normalized.replace(/^xyz:/, '');
}

function quantity(value: number) {
  const magnitude = Math.abs(value);
  return formatPrice(value, magnitude >= 1_000 ? 2 : magnitude >= 1 ? 4 : 6);
}

function timestamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const date = new Date(value);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${MONTHS[date.getUTCMonth()]} ${hour}:${minute}`;
}

function statusLabel(status: string) {
  return status.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

function statusTone(status: string) {
  if (status === 'filled' || status === 'triggered' || status === 'open') return 'is-up';
  if (status === 'canceled' || status === 'rejected' || /Canceled|Rejected$/.test(status)) return 'is-down';
  return '';
}

function MarketCell({ coin, instrument }: { coin: string; instrument?: Instrument }) {
  const symbol = instrument?.symbol ?? cleanCoin(coin);
  const body = (
    <>
      <WebSymbolMark symbol={symbol} />
      <span><strong>{symbol}</strong><small>{instrument?.venue ?? (coin.startsWith('xyz:') ? 'trade.xyz' : 'Hyperliquid')}</small></span>
    </>
  );
  return instrument ? (
    <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} className="web-account-dock-market">{body}</Link>
  ) : <span className="web-account-dock-market">{body}</span>;
}

function DockEmpty({ address, copy }: { address: string | null; copy: string }) {
  if (!address) {
    return (
      <div className="web-account-dock-empty">
        <div><strong>Connect a public account</strong><span>Load balances, positions and order activity without a signing key.</span></div>
        <Link href="/account">Connect account</Link>
      </div>
    );
  }
  return <div className="web-account-dock-empty"><div><strong>{copy}</strong><span>Live public account data will appear here.</span></div></div>;
}

function DockLoading() {
  return <div className="web-account-dock-loading" aria-label="Loading account data"><span /><span /><span /></div>;
}

function BalancesTable({ rows, mask }: { rows: HlSpotBalance[]; mask: (value: string) => string }) {
  return (
    <div className="web-account-dock-grid is-balances">
      <div className="web-account-dock-head"><span>Asset</span><span>Total</span><span>Available</span><span>Held</span><span>Value</span></div>
      {rows.map((balance) => (
        <div className="web-account-dock-row" key={balance.coin}>
          <MarketCell coin={balance.coin} />
          <span>{mask(quantity(balance.total))}</span>
          <span>{mask(quantity(balance.available))}</span>
          <span>{mask(quantity(balance.hold))}</span>
          <span>{mask(balance.usdValue < 0 ? signedUsd(balance.usdValue) : usd(balance.usdValue))}</span>
        </div>
      ))}
    </div>
  );
}

function PositionsTable({ rows, instrumentFor, mask }: { rows: HlPosition[]; instrumentFor: (coin: string) => Instrument | undefined; mask: (value: string) => string }) {
  return (
    <div className="web-account-dock-grid is-positions">
      <div className="web-account-dock-head"><span>Market</span><span>Side / Size</span><span>Entry</span><span>Mark</span><span>Leverage</span><span>Unrealized PnL</span></div>
      {rows.map((position) => (
        <div className="web-account-dock-row" key={`${position.dex}:${position.coin}`}>
          <MarketCell coin={position.coin} instrument={instrumentFor(position.coin)} />
          <span><b className={position.side === 'long' ? 'is-up' : 'is-down'}>{position.side}</b> {mask(quantity(position.size))}</span>
          <span>{formatPrice(position.entryPx)}</span>
          <span>{formatPrice(position.markPx)}</span>
          <span>{position.leverage}× {position.leverageType}</span>
          <span className={position.unrealizedPnl >= 0 ? 'is-up' : 'is-down'}>{mask(signedUsd(position.unrealizedPnl))}</span>
        </div>
      ))}
    </div>
  );
}

function OpenOrdersTable({ rows, instrumentFor, mask }: { rows: HlOpenOrder[]; instrumentFor: (coin: string) => Instrument | undefined; mask: (value: string) => string }) {
  return (
    <div className="web-account-dock-grid is-orders">
      <div className="web-account-dock-head"><span>Market</span><span>Side</span><span>Type</span><span>Remaining / Original</span><span>Price</span><span>Placed (UTC)</span></div>
      {rows.map((order) => (
        <div className="web-account-dock-row" key={order.oid}>
          <MarketCell coin={order.coin} instrument={instrumentFor(order.coin)} />
          <span className={order.side === 'buy' ? 'is-up' : 'is-down'}>{order.side}</span>
          <span>{order.orderType}{order.reduceOnly ? ' · Reduce' : ''}</span>
          <span>{mask(`${quantity(order.size)} / ${quantity(order.origSize)}`)}</span>
          <span>{order.triggerPx ? `${formatPrice(order.triggerPx)} trigger` : formatPrice(order.limitPx)}</span>
          <span>{timestamp(order.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}

function OrderHistoryTable({ rows, instrumentFor, mask }: { rows: HlHistoricalOrder[]; instrumentFor: (coin: string) => Instrument | undefined; mask: (value: string) => string }) {
  return (
    <div className="web-account-dock-grid is-history">
      <div className="web-account-dock-head"><span>Market</span><span>Side</span><span>Type</span><span>Size</span><span>Price</span><span>Status</span><span>Updated (UTC)</span></div>
      {rows.map((order) => (
        <div className="web-account-dock-row" key={order.oid}>
          <MarketCell coin={order.coin} instrument={instrumentFor(order.coin)} />
          <span className={order.side === 'buy' ? 'is-up' : 'is-down'}>{order.side}</span>
          <span>{order.orderType}{order.reduceOnly ? ' · Reduce' : ''}</span>
          <span>{mask(quantity(order.origSize))}</span>
          <span>{order.triggerPx ? `${formatPrice(order.triggerPx)} trigger` : formatPrice(order.limitPx)}</span>
          <span className={statusTone(order.status)}>{statusLabel(order.status)}</span>
          <span>{timestamp(order.statusTimestamp)}</span>
        </div>
      ))}
    </div>
  );
}

function TradeHistoryTable({ rows, instrumentFor, mask }: { rows: HlFill[]; instrumentFor: (coin: string) => Instrument | undefined; mask: (value: string) => string }) {
  return (
    <div className="web-account-dock-grid is-history">
      <div className="web-account-dock-head"><span>Market</span><span>Direction</span><span>Size</span><span>Price</span><span>Realized PnL</span><span>Fee / Rebate</span><span>Time (UTC)</span></div>
      {rows.map((fill) => (
        <div className="web-account-dock-row" key={fill.key}>
          <MarketCell coin={fill.coin} instrument={instrumentFor(fill.coin)} />
          <span className={fill.side === 'buy' ? 'is-up' : 'is-down'}>{fill.dir}</span>
          <span>{mask(quantity(fill.size))}</span>
          <span>{formatPrice(fill.px)}</span>
          <span className={fill.closedPnl >= 0 ? 'is-up' : 'is-down'}>{mask(signedUsd(fill.closedPnl))}</span>
          <span className={fill.fee <= 0 ? 'is-up' : ''}>{mask(signedUsd(-fill.fee))}</span>
          <span>{timestamp(fill.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}

export function WebAccountDock() {
  const [tab, setTab] = useState<AccountDockTab>('positions');
  const address = useHlConnection((state) => state.address);
  const privacy = usePreferences((state) => state.privacyMode);
  const hideSmallBalances = usePreferences((state) => state.hideSmallBalances);
  const account = useHlAccount();
  const openOrders = useHlOpenOrders();
  const fills = useHlFills();
  const historicalOrders = useHlHistoricalOrders(tab === 'orderHistory');
  const { data: markets } = useAllMarkets();

  const balances = useMemo(
    () => (account.data?.spotBalances ?? []).filter((balance) => !hideSmallBalances || Math.abs(balance.usdValue) >= SMALL_BALANCE_USD),
    [account.data?.spotBalances, hideSmallBalances],
  );
  const instrumentFor = (coin: string) => markets?.byCoinKey.get(marketCoinKey(coin));
  const mask = (value: string) => privacy ? '••••••' : value;
  const counts: Record<AccountDockTab, number | undefined> = {
    balances: account.data ? balances.length : undefined,
    positions: account.data?.positions.length,
    openOrders: openOrders.data?.length,
    orderHistory: historicalOrders.data?.length,
    tradeHistory: fills.data?.length,
  };
  const activeQuery = tab === 'balances' || tab === 'positions' ? account
    : tab === 'openOrders' ? openOrders
      : tab === 'orderHistory' ? historicalOrders
        : fills;

  let content;
  if (!address) {
    content = <DockEmpty address={address} copy="" />;
  } else if (activeQuery.isLoading) {
    content = <DockLoading />;
  } else if (activeQuery.isError) {
    content = (
      <div className="web-account-dock-empty">
        <div><strong>Account data unavailable</strong><span>The public read failed. Nothing was changed.</span></div>
        <button type="button" onClick={() => void activeQuery.refetch()}>Retry</button>
      </div>
    );
  } else if (tab === 'balances') {
    content = balances.length ? <BalancesTable rows={balances} mask={mask} /> : <DockEmpty address={address} copy={hideSmallBalances ? `No balances above $${SMALL_BALANCE_USD}` : 'No spot balances'} />;
  } else if (tab === 'positions') {
    content = account.data?.positions.length ? <PositionsTable rows={account.data.positions} instrumentFor={instrumentFor} mask={mask} /> : <DockEmpty address={address} copy="No open positions" />;
  } else if (tab === 'openOrders') {
    content = openOrders.data?.length ? <OpenOrdersTable rows={openOrders.data} instrumentFor={instrumentFor} mask={mask} /> : <DockEmpty address={address} copy="No open orders" />;
  } else if (tab === 'orderHistory') {
    content = historicalOrders.data?.length ? <OrderHistoryTable rows={historicalOrders.data} instrumentFor={instrumentFor} mask={mask} /> : <DockEmpty address={address} copy="No order history" />;
  } else {
    content = fills.data?.length ? <TradeHistoryTable rows={fills.data} instrumentFor={instrumentFor} mask={mask} /> : <DockEmpty address={address} copy="No trade history" />;
  }

  const accountLabel = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connect account';

  return (
    <section className="web-terminal-dock web-panel">
      <div className="web-dock-tabs">
        {TABS.map((item) => (
          <button key={item.key} type="button" className={tab === item.key ? 'is-active' : ''} onClick={() => setTab(item.key)}>
            {item.label}{counts[item.key] ? <span>{counts[item.key]}</span> : null}
          </button>
        ))}
        <Link href="/account" className="web-account-dock-status"><strong>{accountLabel}</strong><span>LIVE · VIEW ONLY</span></Link>
      </div>
      <div className="web-account-dock-scroll">{content}</div>
    </section>
  );
}
