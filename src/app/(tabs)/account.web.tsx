import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';

import { WebSymbolMark } from '@/components/web/WebSymbolMark';
import { useHlAccount, useHlPortfolio } from '@/data/useHlAccount';
import { useAllMarkets } from '@/data/useMarkets';
import { formatPercent, formatPrice, signedUsd, usd } from '@/lib/format';
import type { HlPortfolioPeriodKey } from '@/lib/hyperliquid/info';
import { DEMO_ADDRESS, isHexAddress, useHlConnection } from '@/store/hlConnection';
import { usePreferences } from '@/store/preferences';

const PERIODS: { key: HlPortfolioPeriodKey; label: string }[] = [
  { key: 'day', label: '1D' },
  { key: 'week', label: '1W' },
  { key: 'month', label: '1M' },
  { key: 'allTime', label: 'All' },
];

function PortfolioLine({ values }: { values: { t: number; v: number }[] }) {
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const width = 900;
    const height = 240;
    let min = Math.min(...values.map((point) => point.v));
    let max = Math.max(...values.map((point) => point.v));
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.01 || 1;
    min -= pad;
    max += pad;
    return values.map((point, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = ((max - point.v) / (max - min)) * height;
      return `${index ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  }, [values]);

  if (!path) return <div className="web-portfolio-chart-empty">Portfolio history will appear here.</div>;
  return (
    <svg className="web-portfolio-chart" viewBox="0 0 900 240" preserveAspectRatio="none" role="img" aria-label="Portfolio value history">
      {[0.25, 0.5, 0.75].map((value) => <line key={value} x1="0" x2="900" y1={240 * value} y2={240 * value} className="web-chart-grid" />)}
      <path d={`${path} L 900 240 L 0 240 Z`} fill="url(#portfolioFill)" />
      <path d={path} fill="none" stroke="#50e3ab" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <defs><linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#50e3ab" stopOpacity="0.18" /><stop offset="100%" stopColor="#50e3ab" stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

export default function WebAccountScreen() {
  const address = useHlConnection((state) => state.address);
  const demo = useHlConnection((state) => state.demo);
  const setAddress = useHlConnection((state) => state.setAddress);
  const connectDemo = useHlConnection((state) => state.connectDemo);
  const disconnect = useHlConnection((state) => state.disconnect);
  const [draft, setDraft] = useState(address ?? '');
  const [inputError, setInputError] = useState('');
  const [period, setPeriod] = useState<HlPortfolioPeriodKey>('month');
  const privacy = usePreferences((state) => state.privacyMode);
  const setPrivacy = usePreferences((state) => state.setPrivacyMode);
  const { data: account, isLoading, isError, refetch } = useHlAccount();
  const { data: portfolio } = useHlPortfolio();
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

  const display = (value: number, signed = false) => privacy ? '••••••' : signed ? signedUsd(value) : usd(value);

  if (!address) {
    return (
      <div className="web-account-connect-layout">
        <section className="web-connect-card web-panel">
          <span className="web-setup-icon"><Ionicons name="wallet-outline" size={23} color="currentColor" /></span>
          <span className="web-section-kicker">READ-ONLY PORTFOLIO</span>
          <h2>Connect an account</h2>
          <p>Enter a public Hyperliquid address to load equity, positions and risk. No signing key is used.</p>
          <label className={`web-address-field${inputError ? ' has-error' : ''}`}>
            <span>Public account address</span>
            <div><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="0x…" spellCheck={false} /><button type="button" onClick={connect}>Connect</button></div>
            {inputError ? <small>{inputError}</small> : null}
          </label>
          <div className="web-connect-divider"><span>or</span></div>
          <button className="web-demo-button" type="button" onClick={() => connectDemo(DEMO_ADDRESS)}><Ionicons name="eye-outline" size={16} color="currentColor" /> Preview a public demo</button>
          <p className="web-security-note"><Ionicons name="shield-checkmark-outline" size={15} color="currentColor" /> The web workspace is view-only. Trading remains on your signed iPhone app.</p>
        </section>
        <aside className="web-connect-aside">
          <div><span>01</span><h3>Public by design</h3><p>Portfolio reads use only the public chain address.</p></div>
          <div><span>02</span><h3>Live risk view</h3><p>Equity, margin and open positions update automatically.</p></div>
          <div><span>03</span><h3>No signing keys</h3><p>Secrets never need to enter the browser version.</p></div>
        </aside>
      </div>
    );
  }

  if (isError) {
    return <section className="web-state-card"><Ionicons name="cloud-offline-outline" size={23} color="currentColor" /><h2>Portfolio unavailable</h2><p>The public account read failed. Nothing was changed.</p><button type="button" onClick={() => void refetch()}>Try again</button></section>;
  }

  const history = portfolio?.[period].accountValue ?? [];
  const periodPnl = portfolio?.[period].pnl.at(-1)?.v ?? 0;

  return (
    <div className="web-content-stack">
      <section className="web-account-header">
        <div><span className="web-section-kicker">{demo ? 'PUBLIC DEMO' : 'CONNECTED ACCOUNT'}</span><h2>{address.slice(0, 7)}…{address.slice(-5)}</h2><p>Live, read-only Hyperliquid portfolio</p></div>
        <div><button className="web-icon-button" type="button" onClick={() => setPrivacy(!privacy)} aria-label={privacy ? 'Show account values' : 'Hide account values'}><Ionicons name={privacy ? 'eye-off-outline' : 'eye-outline'} size={17} color="currentColor" /></button><button className="web-quiet-button" type="button" onClick={disconnect}>Disconnect</button></div>
      </section>

      <section className="web-account-metrics">
        <div className="web-metric-card web-panel"><span>TOTAL EQUITY</span><strong>{account ? display(account.totalEquity) : '—'}</strong><small>Spot, perps and vaults</small></div>
        <div className="web-metric-card web-panel"><span>UNREALIZED PNL</span><strong className={(account?.unrealizedPnl ?? 0) >= 0 ? 'is-up' : 'is-down'}>{account ? display(account.unrealizedPnl, true) : '—'}</strong><small>Across open positions</small></div>
        <div className="web-metric-card web-panel"><span>FREE COLLATERAL</span><strong>{account ? display(account.freeCollateral) : '—'}</strong><small>Mode-aware available capital</small></div>
        <div className="web-metric-card web-panel"><span>MARGIN USE</span><strong>{account?.maintenanceUsage == null || privacy ? privacy ? '••••••' : '—' : formatPercent(account.maintenanceUsage * 100)}</strong><small>Maintenance threshold</small></div>
      </section>

      <div className="web-account-grid">
        <section className="web-portfolio-history web-panel">
          <div className="web-panel-heading"><div><span className="web-section-kicker">ACCOUNT VALUE</span><h2>{privacy ? '••••••' : history.at(-1) ? usd(history.at(-1)!.v) : account ? usd(account.totalEquity) : '—'}</h2></div><div className="web-mini-tabs">{PERIODS.map((item) => <button key={item.key} type="button" className={period === item.key ? 'is-active' : ''} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div></div>
          <div className="web-portfolio-chart-meta"><span>Period PnL</span><strong className={periodPnl >= 0 ? 'is-up' : 'is-down'}>{privacy ? '••••••' : signedUsd(periodPnl)}</strong></div>
          <PortfolioLine values={privacy ? [] : history} />
        </section>

        <aside className="web-risk-card web-panel">
          <span className="web-section-kicker">RISK SNAPSHOT</span>
          <div><span>Notional exposure</span><strong>{account ? display(account.totalNotional) : '—'}</strong></div>
          <div><span>Margin used</span><strong>{account ? display(account.totalMarginUsed) : '—'}</strong></div>
          <div><span>Withdrawable</span><strong>{account ? display(account.withdrawable) : '—'}</strong></div>
          <div><span>Account mode</span><strong>{account?.abstractionMode ?? '—'}</strong></div>
          <p><Ionicons name="information-circle-outline" size={15} color="currentColor" /> Values are read from the live public account. No order actions are available on web.</p>
        </aside>
      </div>

      <section className="web-positions web-panel">
        <div className="web-panel-heading"><div><span className="web-section-kicker">OPEN POSITIONS</span><h2>{account?.positions.length ?? 0} positions</h2></div>{isLoading ? <span className="web-live-badge"><span /> Syncing</span> : <span className="web-live-badge"><span /> Live</span>}</div>
        <div className="web-position-head"><span>Market</span><span>Size</span><span>Entry</span><span>Mark</span><span>Leverage</span><span>PnL</span></div>
        {account?.positions.length ? account.positions.map((position) => {
          const instrument = markets?.byCoinKey.get(position.coin);
          const row = (
            <div className="web-position-row">
              <span className="web-market-name"><WebSymbolMark symbol={position.coin.replace(/^xyz:/, '')} /><span><strong>{position.coin.replace(/^xyz:/, '')}</strong><small className={position.side === 'long' ? 'is-up' : 'is-down'}>{position.side}</small></span></span>
              <span className="web-table-mono">{privacy ? '••••' : formatPrice(position.size)}</span>
              <span className="web-table-mono">{formatPrice(position.entryPx)}</span>
              <span className="web-table-mono">{formatPrice(position.markPx)}</span>
              <span className="web-table-mono">{position.leverage}× {position.leverageType}</span>
              <span className={`web-table-mono ${position.unrealizedPnl >= 0 ? 'is-up' : 'is-down'}`}>{privacy ? '••••' : signedUsd(position.unrealizedPnl)}</span>
            </div>
          );
          return instrument ? <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} key={`${position.dex}:${position.coin}`} className="web-position-link">{row}</Link> : <div key={`${position.dex}:${position.coin}`}>{row}</div>;
        }) : <div className="web-inline-state"><p>No open positions.</p></div>}
      </section>
    </div>
  );
}
