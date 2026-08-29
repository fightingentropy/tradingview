import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname } from 'expo-router';
import { useMemo, type PropsWithChildren } from 'react';

import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useMarkets } from '@/data/useMarkets';
import type { Instrument, Quote } from '@/domain/types';
import { formatPercent, formatPrice, priceDecimalsFor } from '@/lib/format';
import { useLivePrice } from '@/store/livePrices';

type NavItem = {
  href: '/' | '/markets' | '/news' | '/account';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Trade', icon: 'pulse-outline', activeIcon: 'pulse' },
  { href: '/markets', label: 'Markets', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { href: '/news', label: 'News', icon: 'newspaper-outline', activeIcon: 'newspaper' },
  { href: '/account', label: 'Portfolio', icon: 'wallet-outline', activeIcon: 'wallet' },
];

const TICKER_SYMBOLS = ['BTC', 'ETH', 'SOL', 'HYPE'];

function BrandMark() {
  return <span className="web-brand-mark" aria-hidden="true">TV</span>;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      className={`web-nav-link${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}>
      <Ionicons name={active ? item.activeIcon : item.icon} size={16} color="currentColor" />
      <span>{item.label}</span>
    </Link>
  );
}

function MarketTicker({ instrument, quote }: { instrument: Instrument; quote?: Quote }) {
  const streamed = useLivePrice(instrument.coinKey);
  const last = streamed ?? quote?.last;
  const move = quote?.change24hPct;

  return (
    <Link href={{ pathname: '/symbol/[id]', params: { id: instrument.id } }} className="web-ticker-item">
      <strong>{instrument.symbol}</strong>
      <span>{formatPrice(last, priceDecimalsFor(instrument.priceDecimals, last))}</span>
      <em className={move == null ? '' : move >= 0 ? 'is-up' : 'is-down'}>{formatPercent(move)}</em>
    </Link>
  );
}

export function WebShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { data } = useMarkets();
  const tickerInstruments = useMemo(
    () => TICKER_SYMBOLS.map((symbol) => (
      data?.instruments.find((instrument) => instrument.symbol === symbol && instrument.assetClass === 'crypto-perp')
      ?? data?.instruments.find((instrument) => instrument.symbol === symbol)
    )).filter((instrument): instrument is Instrument => instrument !== undefined),
    [data?.instruments],
  );

  useLivePriceFeed(tickerInstruments);

  return (
    <div className="web-app-shell">
      <header className="web-topbar">
        <Link href="/" className="web-brand" aria-label="TradingView terminal home">
          <BrandMark />
          <span className="web-brand-name">TradingView</span>
        </Link>

        <nav className="web-primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)}
        </nav>

        <div className="web-topbar-actions">
          <span className="web-data-status"><i className="web-live-dot" /> Markets live</span>
          <Link href="/markets" className="web-search-link" aria-label="Search markets">
            <Ionicons name="search" size={15} color="currentColor" />
            <span>Search</span>
            <kbd>/</kbd>
          </Link>
          <Link
            href="/settings"
            className={`web-icon-button${pathname.startsWith('/settings') ? ' is-active' : ''}`}
            aria-label="Settings">
            <Ionicons name="settings-outline" size={16} color="currentColor" />
          </Link>
          <Link href="/account" className="web-account-link">
            <span className="web-account-orb">EH</span>
            <span>Account</span>
          </Link>
        </div>
      </header>

      <div className="web-market-ticker" aria-label="Live market ticker">
        <span className="web-ticker-label"><i className="web-live-dot" /> Live</span>
        <div className="web-ticker-track">
          {tickerInstruments.length
            ? tickerInstruments.map((instrument) => (
                <MarketTicker key={instrument.id} instrument={instrument} quote={data?.quotes[instrument.id]} />
              ))
            : TICKER_SYMBOLS.map((symbol) => <span className="web-ticker-placeholder" key={symbol}>{symbol} <i>—</i></span>)}
        </div>
        <span className="web-feed-note">HL + XYZ + CBOE</span>
      </div>

      <div className="web-main-column">
        <main className="web-page">{children}</main>
      </div>

      <nav className="web-mobile-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)}
      </nav>
    </div>
  );
}
