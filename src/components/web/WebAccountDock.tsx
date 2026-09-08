import { Link } from 'expo-router';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import {
  useHlAccount,
  useHlFills,
  useHlHistoricalOrders,
  useHlOpenOrders,
  useTradingAddress,
} from '@/data/useHlAccount';
import { useAllMarkets } from '@/data/useMarkets';
import type { Instrument } from '@/domain/types';
import { formatPrice, signedUsd, usd } from '@/lib/format';
import { fillNetPnl } from '@/lib/portfolioMetrics';
import type {
  HlAccount,
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
  { key: 'openOrders', label: 'Open orders' },
  { key: 'orderHistory', label: 'Order history' },
  { key: 'tradeHistory', label: 'Trade history' },
];

const HEIGHT_STORAGE_KEY = 'tradingview-account-dock-height-v3';
const COLLAPSED_HEIGHT = 44;
const EXPANDED_HEIGHT = 232;
const DEFAULT_HEIGHT = EXPANDED_HEIGHT;
const MIN_HEIGHT = COLLAPSED_HEIGHT;

function clampHeight(value: number) {
  if (typeof window === 'undefined') return Math.max(MIN_HEIGHT, value);
  return Math.min(Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.75)), Math.max(MIN_HEIGHT, value));
}

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
  return formatPrice(value, magnitude >= 100 ? 2 : magnitude >= 1 ? 3 : 4);
}

function clockTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '--';
  const date = new Date(value);
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  return `${hour}:${minute}:${second}`;
}

function statusLabel(status: string) {
  return status.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

function statusTone(status: string) {
  if (status === 'filled' || status === 'triggered' || status === 'open') return 'is-up';
  if (status === 'canceled' || status === 'rejected' || /Canceled|Rejected$/.test(status)) return 'is-down';
  return '';
}

function InstrumentLink({ coin, instrument, className = '', label }: { coin: string; instrument?: Instrument; className?: string; label?: string }) {
  const symbol = instrument?.symbol ?? cleanCoin(coin);
  return instrument ? (
    <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} className={className}>{label ?? symbol}</Link>
  ) : <span className={className}>{label ?? symbol}</span>;
}

function DockEmpty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="web-xyz-dock-empty">
      <p>{title}</p>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function DockLoading() {
  return <div className="web-account-dock-loading" aria-label="Loading account data"><span /><span /><span /></div>;
}

function BalancesTable({ account, rows, instrumentFor, mask }: { account: HlAccount; rows: HlSpotBalance[]; instrumentFor: (coin: string) => Instrument | undefined; mask: (value: string) => string }) {
  const roe = account.totalMarginUsed > 0 ? (account.unrealizedPnl / account.totalMarginUsed) * 100 : 0;
  return (
    <table className="web-xyz-dock-table is-balances">
      <thead><tr><th>Coin</th><th>Total Balance</th><th>Available Balance</th><th>USDC Value</th><th>PNL (ROE %)</th><th>Actions</th><th>Contract</th></tr></thead>
      <tbody>
        <tr>
          <td><div className="web-xyz-dock-asset"><strong>USDC</strong><span>Perps</span></div></td>
          <td className="is-mono">{mask(`${formatPrice(account.accountValue, 2)} USDC`)}</td>
          <td className="is-mono">{mask(`${formatPrice(account.freeCollateral, 2)} USDC`)}</td>
          <td className="is-mono">{mask(usd(account.accountValue))}</td>
          <td className={`is-mono ${account.unrealizedPnl >= 0 ? 'is-up' : 'is-down'}`}>{mask(`${signedUsd(account.unrealizedPnl)} (${roe.toFixed(2)}%)`)}</td>
          <td><Link href="/account" className="web-xyz-dock-action">View</Link></td>
          <td className="is-muted">--</td>
        </tr>
        {rows.map((balance) => {
          const instrument = instrumentFor(balance.coin);
          return (
            <tr key={balance.coin}>
              <td><div className="web-xyz-dock-asset"><InstrumentLink coin={balance.coin} instrument={instrument} className="web-xyz-dock-symbol" /><span>Spot</span></div></td>
              <td className="is-mono">{mask(`${quantity(balance.total)} ${cleanCoin(balance.coin)}`)}</td>
              <td className="is-mono">{mask(`${quantity(balance.available)} ${cleanCoin(balance.coin)}`)}</td>
              <td className="is-mono">{balance.priceKnown !== true ? '—' : mask(balance.usdValue < 0 ? signedUsd(balance.usdValue) : usd(balance.usdValue))}</td>
              <td className="is-muted">--</td>
              <td>{instrument ? <InstrumentLink coin={balance.coin} instrument={instrument} className="web-xyz-dock-action" label="View" /> : <Link href="/account" className="web-xyz-dock-action">View</Link>}</td>
              <td className="is-muted">--</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function protectionFor(position: HlPosition, orders: HlOpenOrder[]) {
  const closingSide = position.side === 'long' ? 'sell' : 'buy';
  const live = orders.filter((order) => order.coin === position.coin && order.side === closingSide && order.reduceOnly && order.isTrigger);
  const takeProfit = live.find((order) => /take profit/i.test(order.orderType))?.triggerPx;
  const stopLoss = live.find((order) => /stop/i.test(order.orderType))?.triggerPx;
  return `${takeProfit ? formatPrice(takeProfit) : '--'} / ${stopLoss ? formatPrice(stopLoss) : '--'}`;
}

function PositionsTable({ rows, orders, instrumentFor, mask }: { rows: HlPosition[]; orders: HlOpenOrder[]; instrumentFor: (coin: string) => Instrument | undefined; mask: (value: string) => string }) {
  return (
    <table className="web-xyz-dock-table is-positions">
      <thead><tr><th>Asset</th><th>Size</th><th>Position Value</th><th>Entry Price</th><th>Mark Price</th><th>PNL (ROE %)</th><th>Liq. Price</th><th>Margin</th><th>Funding</th><th>Actions</th><th>TP/SL</th></tr></thead>
      <tbody>
        {rows.length ? rows.map((position) => {
          const instrument = instrumentFor(position.coin);
          const isLong = position.side === 'long';
          const positionValue = Math.abs(position.size * position.markPx);
          const roe = position.marginUsed > 0 ? (position.unrealizedPnl / position.marginUsed) * 100 : 0;
          return (
            <tr key={`${position.dex}:${position.coin}`}>
              <td><div className="web-xyz-dock-asset"><InstrumentLink coin={position.coin} instrument={instrument} className={`web-xyz-dock-symbol ${isLong ? 'is-up' : 'is-down'}`} /><span>{position.leverage}x</span></div></td>
              <td className={`is-mono ${isLong ? 'is-up' : 'is-down'}`}>{mask(`${quantity(isLong ? Math.abs(position.size) : -Math.abs(position.size))} ${instrument?.symbol ?? cleanCoin(position.coin)}`)}</td>
              <td className="is-mono">{mask(`${usd(positionValue)} USDC`)}</td>
              <td className="is-mono">{formatPrice(position.entryPx)}</td>
              <td className="is-mono">{formatPrice(position.markPx)}</td>
              <td className={`is-mono ${position.unrealizedPnl >= 0 ? 'is-up' : 'is-down'}`}>{mask(`${signedUsd(position.unrealizedPnl)} (${roe.toFixed(2)}%)`)}</td>
              <td className="is-mono">{position.liquidationPx ? formatPrice(position.liquidationPx) : '--'}</td>
              <td className="is-mono">{mask(`${usd(position.marginUsed)} (${position.leverageType === 'cross' ? 'Cross' : 'Isolated'})`)}</td>
              <td className={`is-mono ${position.funding >= 0 ? 'is-up' : 'is-down'}`}>{mask(signedUsd(position.funding))}</td>
              <td>{instrument ? <InstrumentLink coin={position.coin} instrument={instrument} className="web-xyz-dock-action" label="View" /> : <Link href="/account" className="web-xyz-dock-action">View</Link>}</td>
              <td className="is-mono is-muted">{protectionFor(position, orders)}</td>
            </tr>
          );
        }) : <tr><td colSpan={11} className="web-xyz-dock-table-empty">No open positions</td></tr>}
      </tbody>
    </table>
  );
}

function OpenOrdersTable({ rows, instrumentFor, mask }: { rows: HlOpenOrder[]; instrumentFor: (coin: string) => Instrument | undefined; mask: (value: string) => string }) {
  return (
    <table className="web-xyz-dock-table is-roomy">
      <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Type</th><th>Price</th><th>Size</th><th>Filled</th><th>Collateral</th><th>Actions</th></tr></thead>
      <tbody>
        {rows.length ? rows.map((order) => {
          const instrument = instrumentFor(order.coin);
          return (
            <tr key={order.oid}>
              <td className="is-mono is-muted">{clockTime(order.timestamp)}</td>
              <td><InstrumentLink coin={order.coin} instrument={instrument} className="web-xyz-dock-symbol" /></td>
              <td className={order.side === 'buy' ? 'is-up' : 'is-down'}><strong>{order.side === 'buy' ? 'Buy' : 'Sell'}</strong></td>
              <td>{order.orderType}</td>
              <td className="is-mono">{order.triggerPx ? formatPrice(order.triggerPx) : formatPrice(order.limitPx)}</td>
              <td className="is-mono">{mask(`${quantity(order.origSize)} ${instrument?.symbol ?? cleanCoin(order.coin)}`)}</td>
              <td className="is-mono is-muted">{mask(quantity(Math.max(0, order.origSize - order.size)))}</td>
              <td className="is-mono is-muted">{instrument?.quoteCurrency ?? 'USDC'}</td>
              <td>{instrument ? <InstrumentLink coin={order.coin} instrument={instrument} className="web-xyz-dock-action" label="View" /> : <span className="is-muted">--</span>}</td>
            </tr>
          );
        }) : <tr><td colSpan={9} className="web-xyz-dock-table-empty">No open orders</td></tr>}
      </tbody>
    </table>
  );
}

function OrderHistoryTable({ rows, instrumentFor, mask }: { rows: HlHistoricalOrder[]; instrumentFor: (coin: string) => Instrument | undefined; mask: (value: string) => string }) {
  return (
    <table className="web-xyz-dock-table is-roomy">
      <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Type</th><th>Price</th><th>Size</th><th>Status</th></tr></thead>
      <tbody>
        {rows.length ? rows.map((order) => {
          const instrument = instrumentFor(order.coin);
          return (
            <tr key={order.oid}>
              <td className="is-mono is-muted">{clockTime(order.statusTimestamp)}</td>
              <td><InstrumentLink coin={order.coin} instrument={instrument} className="web-xyz-dock-symbol" /></td>
              <td className={order.side === 'buy' ? 'is-up' : 'is-down'}><strong>{order.side === 'buy' ? 'Buy' : 'Sell'}</strong></td>
              <td>{order.orderType}</td>
              <td className="is-mono">{order.triggerPx ? formatPrice(order.triggerPx) : formatPrice(order.limitPx)}</td>
              <td className="is-mono">{mask(`${quantity(order.origSize)} ${instrument?.symbol ?? cleanCoin(order.coin)}`)}</td>
              <td className={statusTone(order.status)}>{statusLabel(order.status)}</td>
            </tr>
          );
        }) : <tr><td colSpan={7} className="web-xyz-dock-table-empty">No history yet</td></tr>}
      </tbody>
    </table>
  );
}

function TradeHistoryTable({ rows, instrumentFor, mask }: { rows: HlFill[]; instrumentFor: (coin: string) => Instrument | undefined; mask: (value: string) => string }) {
  return (
    <table className="web-xyz-dock-table is-roomy">
      <thead><tr><th>Time (UTC)</th><th>Symbol</th><th>Side</th><th>Price</th><th>Size</th><th>Notional</th><th>Closed P&amp;L</th></tr></thead>
      <tbody>
        {rows.length ? rows.map((fill) => {
          const instrument = instrumentFor(fill.coin);
          const closedPnl = fill.pnlKnown === true ? fillNetPnl(fill) : null;
          return (
            <tr key={fill.key}>
              <td className="is-mono is-muted">{clockTime(fill.timestamp)}</td>
              <td><InstrumentLink coin={fill.coin} instrument={instrument} className="web-xyz-dock-symbol" /></td>
              <td className={fill.side === 'buy' ? 'is-up' : 'is-down'}><strong>{fill.side === 'buy' ? 'Buy' : 'Sell'}</strong></td>
              <td className="is-mono">{formatPrice(fill.px)}</td>
              <td className="is-mono">{mask(`${quantity(fill.size)} ${instrument?.symbol ?? cleanCoin(fill.coin)}`)}</td>
              <td className="is-mono">{mask(usd(fill.size * fill.px))}</td>
              <td className="is-mono"><span className={closedPnl == null ? '' : closedPnl >= 0 ? 'is-up' : 'is-down'}>{closedPnl == null ? '—' : mask(signedUsd(closedPnl))}</span><small className="web-dock-fee">{fill.pnlKnown !== true ? 'PNL unavailable' : closedPnl != null ? 'After fees' : `Gross ${mask(signedUsd(fill.closedPnl))} · fee ${mask(formatPrice(fill.fee, 8))} ${fill.feeToken ?? '(token unavailable)'}`}</small></td>
            </tr>
          );
        }) : <tr><td colSpan={7} className="web-xyz-dock-table-empty">No trades yet</td></tr>}
      </tbody>
    </table>
  );
}

export function WebAccountDock() {
  const [tab, setTab] = useState<AccountDockTab>('positions');
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const panelHeightRef = useRef(DEFAULT_HEIGHT);
  const stopDragRef = useRef<() => void>(() => undefined);
  const address = useHlConnection((state) => state.address);
  const privacy = usePreferences((state) => state.privacyMode);
  const hideSmallBalances = usePreferences((state) => state.hideSmallBalances);
  const identity = useTradingAddress();
  const account = useHlAccount();
  const openOrders = useHlOpenOrders();
  const fills = useHlFills();
  const historicalOrders = useHlHistoricalOrders(tab === 'orderHistory');
  const { data: markets } = useAllMarkets();

  useEffect(() => {
    let restoreFrame = 0;
    try {
      const stored = Number(window.localStorage.getItem(HEIGHT_STORAGE_KEY));
      if (Number.isFinite(stored) && stored > 0) {
        const next = clampHeight(stored);
        restoreFrame = window.requestAnimationFrame(() => {
          panelHeightRef.current = next;
          setPanelHeight(next);
        });
      }
    } catch {
      // Storage is optional; the terminal starts with account activity visible.
    }
    const resize = () => {
      const next = clampHeight(panelHeightRef.current);
      panelHeightRef.current = next;
      setPanelHeight(next);
    };
    window.addEventListener('resize', resize);
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      stopDragRef.current();
      window.removeEventListener('resize', resize);
    };
  }, []);

  const persistHeight = (value: number) => {
    try {
      window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(value)));
    } catch {
      // Ignore unavailable browser storage.
    }
  };

  const updateHeight = (value: number, persist = false) => {
    const next = clampHeight(value);
    panelHeightRef.current = next;
    setPanelHeight(next);
    if (persist) persistHeight(next);
  };

  const startResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelHeightRef.current;
    const move = (moveEvent: MouseEvent) => updateHeight(startHeight + startY - moveEvent.clientY, true);
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      stopDragRef.current = () => undefined;
    };
    stopDragRef.current();
    stopDragRef.current = stop;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    updateHeight(panelHeightRef.current + (event.key === 'ArrowUp' ? 16 : -16), true);
  };

  const balances = useMemo(
    () => (account.data?.spotBalances ?? []).filter((balance) => !hideSmallBalances || balance.priceKnown !== true || Math.abs(balance.usdValue) >= SMALL_BALANCE_USD),
    [account.data?.spotBalances, hideSmallBalances],
  );
  const instrumentFor = (coin: string) => markets?.byCoinKey.get(marketCoinKey(coin));
  const mask = (value: string) => privacy ? '••••••' : value;
  const activeQuery = tab === 'balances' || tab === 'positions' ? account
    : tab === 'openOrders' ? openOrders
      : tab === 'orderHistory' ? historicalOrders
        : fills;

  let content: ReactNode;
  if (!address) {
    content = <DockEmpty title="No account connected" detail="Open Portfolio to connect a public account and view its activity." />;
  } else if (identity.isError) {
    content = <div className="web-xyz-dock-error"><span>Account could not be resolved</span><button type="button" onClick={() => void identity.refetch()}>Retry</button></div>;
  } else if (activeQuery.isPending) {
    content = <DockLoading />;
  } else if (activeQuery.isError) {
    content = <div className="web-xyz-dock-error"><span>Account data unavailable</span><button type="button" onClick={() => void activeQuery.refetch()}>Retry</button></div>;
  } else if (tab === 'balances') {
    content = account.data && account.data.spotBalancesLoaded !== true
      ? <div className="web-xyz-dock-error"><span>Wallet balances unavailable</span>{account.data.spotBalancesError ? <small>{account.data.spotBalancesError}</small> : null}<button type="button" onClick={() => void account.refetch()}>Retry</button></div>
      : account.data
      ? <BalancesTable account={account.data} rows={balances} instrumentFor={instrumentFor} mask={mask} />
      : <DockEmpty title="No balances" />;
  } else if (tab === 'positions') {
    content = <PositionsTable rows={account.data?.positions ?? []} orders={openOrders.data ?? []} instrumentFor={instrumentFor} mask={mask} />;
  } else if (tab === 'openOrders') {
    content = <OpenOrdersTable rows={openOrders.data ?? []} instrumentFor={instrumentFor} mask={mask} />;
  } else if (tab === 'orderHistory') {
    content = <OrderHistoryTable rows={historicalOrders.data ?? []} instrumentFor={instrumentFor} mask={mask} />;
  } else {
    content = <TradeHistoryTable rows={fills.data ?? []} instrumentFor={instrumentFor} mask={mask} />;
  }

  const tabCount = (key: AccountDockTab) => key === 'positions'
    ? account.data?.positions.length
    : key === 'openOrders'
      ? openOrders.data?.length
      : undefined;
  const collapsed = panelHeight <= COLLAPSED_HEIGHT + 2;

  return (
    <section className={`web-terminal-dock web-xyz-trade-panel${collapsed ? ' is-collapsed' : ''}`} style={{ height: panelHeight, flex: `0 0 ${panelHeight}px` }}>
      <div
        className="web-xyz-dock-resizer"
        role="separator"
        aria-label="Resize trading panel"
        aria-orientation="horizontal"
        aria-valuemin={MIN_HEIGHT}
        aria-valuenow={panelHeight}
        tabIndex={0}
        onMouseDown={startResize}
        onKeyDown={resizeWithKeyboard}>
        <span />
      </div>
      <div className="web-dock-tabs" role="tablist" aria-label="Trading account">
        {TABS.map((item) => {
          const count = tabCount(item.key);
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`web-dock-tab-${item.key}`}
              aria-controls="web-account-dock-panel"
              aria-selected={tab === item.key}
              className={tab === item.key ? 'is-active' : ''}
              onClick={() => {
                if (collapsed) {
                  setTab(item.key);
                  updateHeight(EXPANDED_HEIGHT, true);
                } else if (tab === item.key) {
                  updateHeight(COLLAPSED_HEIGHT, true);
                } else {
                  setTab(item.key);
                }
              }}>
              {item.label}{count ? <span>({count})</span> : null}
            </button>
          );
        })}
      </div>
      <div className="web-account-dock-scroll" id="web-account-dock-panel" role="tabpanel" aria-labelledby={`web-dock-tab-${tab}`}>{content}</div>
    </section>
  );
}
