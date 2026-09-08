import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState, type ReactNode } from 'react';

import { PortfolioCard } from '@/components/PortfolioCard';
import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useHlAccount, useHlAccountFees, useHlEarnBalance, useHlFills, useHlHistoricalOrders, useHlOpenOrders, useHlPortfolio, useTradingAddress } from '@/data/useHlAccount';
import { useHlAccountActivity, useHlBorrowLendInterest, useHlUserFunding } from '@/data/useHlHistory';
import { useAllMarkets } from '@/data/useMarkets';
import { accountReadState } from '@/lib/accountReadState';
import { formatPrice, signedUsd, usd } from '@/lib/format';
import { formatFundingRatePercent } from '@/lib/fundingHistory';
import { fillNetPnl, shortAccountMode } from '@/lib/portfolioMetrics';
import { DEMO_ADDRESS, isHexAddress, useHlConnection } from '@/store/hlConnection';
import { SMALL_BALANCE_USD, usePreferences } from '@/store/preferences';
import '@/styles/account.css';

const TABS = [
  { key: 'positions', label: 'Positions' }, { key: 'balances', label: 'Balances' },
  { key: 'orders', label: 'Open orders' }, { key: 'history', label: 'Trade history' },
  { key: 'funding', label: 'Funding' }, { key: 'interest', label: 'Interest' },
  { key: 'orderHistory', label: 'Order history' }, { key: 'transfers', label: 'Transfers' },
] as const;
type PortfolioTab = typeof TABS[number]['key'];
type ReadQuery = { data: unknown; isError: boolean; isFetching: boolean; dataUpdatedAt: number; refetch: () => unknown };
type DataRow = { key: string; cells: ReactNode[] };
const stamp = (timestamp: number) => Number.isFinite(timestamp) && timestamp > 0
  ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(timestamp)) : '—';
const normalizedCoin = (coin: string) => coin.replace(/^\+(\d+)$/, '#$1');

function ReadNotice({ query, maxAge = 30_000, subject = 'Account' }: { query: ReadQuery; maxAge?: number; subject?: string }) {
  const state = accountReadState(query, maxAge);
  if (state !== 'stale' && state !== 'error') return null;
  return <div className="account-read-status is-stale" role="status"><span>{state === 'error' ? `${subject} unavailable.` : `${subject} may be out of date. Showing the last available data.`}</span><button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry</button></div>;
}

export default function WebAccountScreen() {
  const address = useHlConnection((state) => state.address);
  const demo = useHlConnection((state) => state.demo);
  const network = useHlConnection((state) => state.network);
  const setAddress = useHlConnection((state) => state.setAddress);
  const connectDemo = useHlConnection((state) => state.connectDemo);
  const disconnect = useHlConnection((state) => state.disconnect);
  const privacy = usePreferences((state) => state.privacyMode);
  const setPrivacy = usePreferences((state) => state.setPrivacyMode);
  const hideSmall = usePreferences((state) => state.hideSmallBalances);
  const setHideSmall = usePreferences((state) => state.setHideSmallBalances);
  const [draft, setDraft] = useState('');
  const [inputError, setInputError] = useState('');
  const [tab, setTab] = useState<PortfolioTab>('positions');
  const identity = useTradingAddress();
  const account = useHlAccount();
  const orders = useHlOpenOrders();
  const fills = useHlFills();
  const historicalOrders = useHlHistoricalOrders(tab === 'orderHistory');
  const funding = useHlUserFunding(tab === 'funding');
  const interest = useHlBorrowLendInterest(tab === 'interest');
  const activity = useHlAccountActivity(tab === 'transfers');
  const fees = useHlAccountFees();
  const earn = useHlEarnBalance();
  const portfolio = useHlPortfolio();
  const { data: markets } = useAllMarkets();
  const masked = (text: string) => privacy ? '••••' : text;
  const amount = (value: number | null | undefined, signed = false) => value == null || !Number.isFinite(value) ? '—' : masked(signed ? signedUsd(value) : `${value < 0 ? '−' : ''}${usd(value)}`);
  const quantity = (value: number | null | undefined) => value == null ? '—' : masked(formatPrice(value, Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 4 : 6));
  const rate = (value: number | null | undefined) => value == null ? '—' : masked(`${(value * 100).toFixed(4)}%`);
  const tone = (value: number | null | undefined) => value == null || privacy ? '' : value >= 0 ? 'is-up' : 'is-down';
  const signedToken = (value: number) => masked(`${value > 0 ? '+' : value < 0 ? '−' : ''}${formatPrice(Math.abs(value), Math.abs(value) >= 100 ? 2 : 6)}`);
  const marketCell = (coin: string, detail?: string) => {
    const normalized = normalizedCoin(coin);
    const instrument = markets?.byCoinKey.get(normalized);
    const symbol = instrument?.symbol ?? (/^#\d+$/.test(normalized) ? `Outcome ${normalized}` : normalized.replace(/^xyz:/, ''));
    return <Link className="account-market" href={instrument ? { pathname: '/symbol/[id]', params: { id: instrument.id } } : '/markets'}><WebSymbolMark symbol={symbol} /><span><strong>{symbol}</strong><small>{detail ?? instrument?.name ?? (coin.startsWith('xyz:') ? 'XYZ' : 'Hyperliquid')}</small></span></Link>;
  };
  const connect = () => {
    const next = draft.trim();
    if (!isHexAddress(next)) { setInputError('Enter a valid 0x account address.'); return; }
    setInputError('');
    setAddress(next);
  };

  if (!address) return <div className="account-page"><header className="web-page-heading"><div><h1>Portfolio</h1><p>Account value, performance and activity.</p></div></header><section className="account-connect web-panel"><Ionicons name="wallet-outline" size={30} color="var(--web-accent)" /><h2>Connect an account</h2><p>View positions, balances and performance with a public Hyperliquid address.</p><form onSubmit={(event) => { event.preventDefault(); connect(); }}><label htmlFor="account-address">Public account address</label><div><input id="account-address" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} aria-describedby={inputError ? 'account-input-error' : undefined} /><button type="submit" className="web-primary-button">Connect</button></div>{inputError ? <small id="account-input-error" role="alert">{inputError}</small> : null}</form><button className="account-demo" type="button" onClick={() => connectDemo(DEMO_ADDRESS)}>Preview public demo <Ionicons name="arrow-forward" size={13} color="currentColor" /></button><footer><Ionicons name="lock-closed-outline" size={13} color="currentColor" /> View only · No signing key required</footer></section></div>;

  const reads: Record<PortfolioTab, { query: ReadQuery; age: number }> = {
    positions: { query: account, age: 30_000 }, balances: { query: account, age: 30_000 },
    orders: { query: orders, age: 30_000 }, history: { query: fills, age: 60_000 },
    funding: { query: funding, age: 10 * 60_000 }, interest: { query: interest, age: 10 * 60_000 },
    orderHistory: { query: historicalOrders, age: 60_000 }, transfers: { query: activity, age: 5 * 60_000 },
  };
  const current = reads[tab];
  const state = accountReadState(current.query, current.age);
  const refresh = () => { void identity.refetch(); void account.refetch(); void fees.refetch(); void earn.refetch(); void portfolio.refetch(); if (current.query !== account) void current.query.refetch(); };
  const data = account.data;
  const tracked = data?.abstractionMode === 'standard' || data?.abstractionMode === 'dexAbstraction';
  let headings: string[] = [];
  let rows: DataRow[] = [];
  let note = '';
  let empty = '';

  if (tab === 'positions') {
    headings = ['Market', 'Side / leverage', 'Size', 'Entry price', 'Mark price', 'Liquidation price', 'Margin', 'Unrealized PNL'];
    rows = (data?.positions ?? []).map((position) => ({ key: `${position.dex}:${position.coin}`, cells: [marketCell(position.coin), <span key="side" className={position.side === 'long' ? 'is-up' : 'is-down'}>{position.side === 'long' ? 'Long' : 'Short'} <small className="account-cell-detail">{position.leverage}× {position.leverageType}</small></span>, quantity(position.size), quantity(position.entryPx), quantity(position.markPx), quantity(position.liquidationPx), amount(position.marginUsed), <strong key="pnl" className={tone(position.unrealizedPnl)}>{amount(position.unrealizedPnl, true)}<small className="account-cell-detail">{rate(position.roe)} ROE</small></strong>] }));
    note = 'Default and XYZ perpetual positions. Orders are managed in the iPhone app.';
    empty = 'No open positions';
  } else if (tab === 'balances') {
    headings = ['Asset', 'Balance', 'Available', 'Held', 'USD value'];
    rows = (data?.spotBalances ?? []).filter((balance) => !hideSmall || balance.priceKnown !== true || Math.abs(balance.usdValue) >= SMALL_BALANCE_USD).map((balance) => ({ key: balance.coin, cells: [marketCell(balance.coin, 'Spot balance'), quantity(balance.total), quantity(balance.available), quantity(balance.hold), balance.priceKnown !== true ? <span key="unknown" className="is-muted">Price unavailable</span> : amount(balance.usdValue)] }));
    note = 'Spot balances. Tokens without a current price remain visible.';
    empty = hideSmall ? 'No balances above $1' : 'No spot balances';
  } else if (tab === 'orders') {
    headings = ['Market', 'Side', 'Type', 'Limit / trigger price', 'Remaining / original size', 'Reduce only', 'Placed (UTC)'];
    rows = (orders.data ?? []).map((order) => ({ key: `${order.dex}:${order.oid}`, cells: [marketCell(order.coin), <span key="side" className={order.side === 'buy' ? 'is-up' : 'is-down'}>{order.side === 'buy' ? 'Buy' : 'Sell'}</span>, order.orderType, <span key="price">{quantity(order.limitPx)}{order.isTrigger ? <small className="account-cell-detail">Trigger {quantity(order.triggerPx)}</small> : null}</span>, `${quantity(order.size)} / ${quantity(order.origSize)}`, order.reduceOnly ? 'Yes' : 'No', stamp(order.timestamp)] }));
    note = 'Working orders. Cancelling and editing are available in the iPhone app.';
    empty = 'No open orders';
  } else if (tab === 'history') {
    headings = ['Time (UTC)', 'Market', 'Direction', 'Price', 'Size', 'Fee / rebate', 'Net PNL'];
    rows = (fills.data ?? []).slice(0, 100).map((fill) => {
      const net = fill.pnlKnown === true ? fillNetPnl(fill) : null;
      return { key: fill.key, cells: [stamp(fill.timestamp), marketCell(fill.coin), fill.dir, quantity(fill.px), quantity(fill.size), fill.pnlKnown !== true ? '—' : `${quantity(fill.fee)} ${fill.feeToken ?? ''}`, <span key="pnl" className={tone(net)}>{amount(net, true)}{net == null && fill.pnlKnown === true ? <small className="account-cell-detail">Gross {amount(fill.closedPnl, true)}</small> : null}</span>] };
    });
    note = 'Latest 100 reported fills. Net PNL subtracts USDC fees; token fees remain in their reported units.';
    empty = 'No reported trade history';
  } else if (tab === 'funding') {
    headings = ['Time (UTC)', 'Market', 'Position size', 'Funding rate', 'Samples', 'Payment (USDC)'];
    rows = (funding.data ?? []).slice(0, 100).map((row) => ({ key: row.key, cells: [stamp(row.timestamp), marketCell(row.coin), quantity(row.signedSize), masked(formatFundingRatePercent(row.rate)), row.sampleCount ?? 1, <span key="payment" className={tone(row.payment)}>{signedToken(row.payment)}</span>] }));
    note = 'Latest 100 returned payments. Positive amounts were received; negative amounts were paid.';
    empty = 'No reported funding payments';
  } else if (tab === 'interest') {
    headings = ['Time (UTC)', 'Token', 'Earned', 'Paid', 'Net interest'];
    rows = (interest.data ?? []).slice(0, 100).map((row) => ({ key: row.key, cells: [stamp(row.timestamp), row.token, quantity(row.earned), quantity(row.paid), <span key="net" className={tone(row.earned - row.paid)}>{signedToken(row.earned - row.paid)}</span>] }));
    note = 'Latest 100 returned interest records. Amounts use the token shown in each row.';
    empty = 'No reported interest';
  } else if (tab === 'orderHistory') {
    headings = ['Updated (UTC)', 'Market', 'Side', 'Type', 'Limit / trigger price', 'Original size', 'Status'];
    rows = (historicalOrders.data ?? []).slice(0, 100).map((order) => ({ key: `${order.oid}:${order.statusTimestamp}`, cells: [stamp(order.statusTimestamp), marketCell(order.coin), order.side === 'buy' ? 'Buy' : 'Sell', order.orderType, <span key="price">{quantity(order.limitPx)}{order.isTrigger ? <small className="account-cell-detail">Trigger {quantity(order.triggerPx)}</small> : null}</span>, quantity(order.origSize), <span key="status" className="account-order-status">{order.status.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>] }));
    note = 'Latest 100 reported order states.';
    empty = 'No reported order history';
  } else {
    headings = ['Time (UTC)', 'Activity', 'Direction', 'Amount', 'Token'];
    rows = (activity.data?.rows ?? []).map((row) => ({ key: row.key, cells: [stamp(row.timestamp), row.label, row.flow === 'in' ? 'Received' : row.flow === 'out' ? 'Sent' : row.flow === 'internal' ? 'Internal' : '—', quantity(row.amount), row.token ?? '—'] }));
    note = activity.data?.limited ? `Partial history: the source limit was reached${activity.data.through ? ` at ${stamp(activity.data.through)} UTC` : ''}. Transfers are separate from PNL.` : 'Up to 100 ledger records from the past 90 days. Transfers are separate from PNL.';
    empty = 'No transfers in the returned history';
  }
  const balanceError = tab === 'balances' && data && data.spotBalancesLoaded !== true;
  const displayAddress = identity.data ?? address;

  return <div className="account-page">
    <header className="account-heading"><div><h1>Portfolio</h1><p><span>{demo ? 'Public demo' : 'Connected account'}</span><b>{masked(`${displayAddress.slice(0, 7)}…${displayAddress.slice(-5)}`)}</b><span className="account-network">{network}</span></p></div><div className="account-toolbar"><button type="button" className="web-icon-button" onClick={() => setPrivacy(!privacy)} aria-label={privacy ? 'Show account values' : 'Hide account values'} aria-pressed={privacy}><Ionicons name={privacy ? 'eye-off-outline' : 'eye-outline'} size={16} color="currentColor" /></button><button type="button" className="web-quiet-button" disabled={account.isFetching || identity.isFetching} onClick={refresh}><Ionicons name="refresh-outline" size={14} color="currentColor" /> Refresh</button><button type="button" className="web-quiet-button" onClick={disconnect}>Disconnect</button></div></header>
    {identity.isError ? <section className="web-state-card"><h2>Account could not be resolved</h2><p>Reconnect or retry to read the correct Hyperliquid account.</p><button type="button" onClick={() => void identity.refetch()}>Retry</button></section> : <>
      <div className="account-overview-grid"><section className="account-overview web-panel"><header><h2>Overview</h2><span>{data ? shortAccountMode(data.abstractionMode) : 'Connecting…'}</span></header><div className="account-equity"><span>{tracked ? 'Tracked equity' : 'Account equity'}</span><strong>{data?.totalEquityLoaded === true ? amount(data.totalEquity) : '—'}</strong></div><dl><div><dt>Unrealized PNL</dt><dd className={tone(data?.unrealizedPnl)}>{amount(data?.unrealizedPnl, true)}</dd></div><div><dt>Free collateral</dt><dd>{data?.totalEquityLoaded === true ? amount(data.freeCollateral) : '—'}</dd></div><div><dt>Maintenance use</dt><dd>{rate(data?.maintenanceUsage)}</dd></div></dl><p>{tracked ? 'Includes default and XYZ perps, spot and vault balances.' : 'Combined account equity reported across the supported balances.'}</p>{data && data.totalEquityLoaded !== true ? <div className="account-read-status is-stale"><span>Some balance data is unavailable. Total equity is withheld.</span><button type="button" disabled={account.isFetching} onClick={() => void account.refetch()}>Retry</button></div> : <ReadNotice query={account} />}</section><PortfolioCard hidden={privacy} /></div>
      <section className="account-secondary-metrics web-panel"><div><span>USDC Earn</span><strong>{amount(earn.data?.suppliedUsdc)}</strong><small>Supplied <i>·</i> Borrowed {amount(earn.data?.borrowedUsdc)}</small><ReadNotice query={earn} maxAge={120_000} subject="Earn balance" /></div><div><span>Reported 14D volume</span><strong>{amount(fees.data?.volume14d)}</strong><small>Last 14 completed UTC days</small><ReadNotice query={fees} maxAge={10 * 60_000} subject="Fees and volume" /></div><div><span>Base perpetual fees</span><strong><small>Taker</small> {rate(fees.data?.takerRate)} <i>/</i> <small>Maker</small> {rate(fees.data?.makerRate)}</strong><small>Market adjustments may apply</small></div></section>
      <section className="account-ledger web-panel"><nav className="account-tabs" aria-label="Portfolio activity">{TABS.map((item) => <button id={`account-tab-${item.key}`} type="button" key={item.key} className={tab === item.key ? 'is-active' : ''} aria-pressed={tab === item.key} onClick={() => setTab(item.key)}>{item.label}{item.key === 'positions' && data ? <span>{data.positions.length}</span> : item.key === 'orders' && orders.data ? <span>{orders.data.length}</span> : null}</button>)}</nav><div className="account-ledger-meta"><p>{note}</p>{tab === 'balances' ? <label><input type="checkbox" checked={hideSmall} onChange={(event) => setHideSmall(event.target.checked)} /> Hide balances below $1</label> : <span>{current.query.dataUpdatedAt ? `Updated ${stamp(current.query.dataUpdatedAt)} UTC` : 'Awaiting account data'}</span>}</div><ReadNotice query={current.query} maxAge={current.age} subject={TABS.find((item) => item.key === tab)?.label} />
        <div aria-labelledby={`account-tab-${tab}`} role="region" className="account-table-region">{state === 'loading' ? <div className="account-table-empty" role="status">Loading {TABS.find((item) => item.key === tab)?.label.toLowerCase()}…</div> : state === 'error' || balanceError ? <div className="account-table-empty"><strong>{balanceError ? 'Spot balances unavailable' : 'This account data is unavailable'}</strong>{balanceError && data?.spotBalancesError ? <small>{data.spotBalancesError}</small> : null}<button type="button" onClick={() => void current.query.refetch()}>Retry</button></div> : rows.length ? <table className="account-table"><thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.key}>{row.cells.map((cell, index) => <td key={headings[index]}>{cell}</td>)}</tr>)}</tbody></table> : <div className="account-table-empty"><Ionicons name="layers-outline" size={24} color="var(--web-faint)" /><strong>{empty}</strong></div>}</div>
      </section>
    </>}
  </div>;
}
