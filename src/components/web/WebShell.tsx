import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname } from 'expo-router';
import { useEffect, useState, type PropsWithChildren } from 'react';

import { useHlAccount } from '@/data/useHlAccount';
import { signedUsd, usd } from '@/lib/format';
import { useHlConnection } from '@/store/hlConnection';
import { usePreferences } from '@/store/preferences';

type NavItem = {
  href: '/' | '/markets' | '/news' | '/economic-calendar' | '/account';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Trade', icon: 'analytics-outline' },
  { href: '/markets', label: 'Markets', icon: 'compass-outline' },
  { href: '/news', label: 'News', icon: 'newspaper-outline' },
  { href: '/economic-calendar', label: 'Calendar', icon: 'calendar-outline' },
  { href: '/account', label: 'Portfolio', icon: 'briefcase-outline' },
];

function BrandMark() {
  return <span className="web-xyz-wordmark" aria-hidden="true">[XYZ]</span>;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.href === '/'
    ? pathname === '/'
    : pathname.startsWith(item.href) || (item.href === '/markets' && pathname.startsWith('/symbol/'));
  return (
    <Link
      href={item.href}
      className={`web-nav-link${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}>
      <span className="web-nav-icon" aria-hidden="true"><Ionicons name={item.icon} size={20} color="currentColor" /></span>
      <span className="web-nav-label">{item.label}</span>
    </Link>
  );
}

function AccountMetric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <span className="web-shell-metric">
      <small>{label}</small>
      <strong className={tone === 'up' ? 'is-up' : tone === 'down' ? 'is-down' : ''}>{value}</strong>
    </span>
  );
}

function QuickSetting({
  checked,
  detail,
  label,
  onChange,
}: {
  checked: boolean;
  detail: string;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      className="web-capital-setting-row"
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <span className={`web-xyz-settings-toggle${checked ? ' is-on' : ''}`} aria-hidden="true"><i /></span>
    </button>
  );
}

export function WebShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const address = useHlConnection((state) => state.address);
  const network = useHlConnection((state) => state.network);
  const account = useHlAccount();
  const privacy = usePreferences((state) => state.privacyMode);
  const setPrivacy = usePreferences((state) => state.setPrivacyMode);
  const hideSmallBalances = usePreferences((state) => state.hideSmallBalances);
  const setHideSmallBalances = usePreferences((state) => state.setHideSmallBalances);
  const showClobOrderBook = usePreferences((state) => state.showClobOrderBook);
  const setShowClobOrderBook = usePreferences((state) => state.setShowClobOrderBook);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [settingsOpen]);

  const hidden = '••••';
  const unavailable = address && account.isLoading ? '…' : '—';
  const equity = privacy ? hidden : account.data ? usd(account.data.totalEquity) : unavailable;
  const pnl = privacy ? hidden : account.data ? signedUsd(account.data.unrealizedPnl) : unavailable;
  const available = privacy ? hidden : account.data ? usd(account.data.freeCollateral) : unavailable;
  const funds = privacy ? hidden : account.data ? usd(account.data.withdrawable) : unavailable;
  const pnlTone = account.data ? (account.data.unrealizedPnl >= 0 ? 'up' : 'down') : undefined;

  return (
    <div className="web-app-shell">
      <header className="web-topbar">
        <Link href="/" className="web-brand" aria-label="XYZ terminal home">
          <BrandMark />
        </Link>

        <div className="web-workspace-label">
          <Ionicons name="pulse-outline" size={16} color="currentColor" />
          <span>Market terminal</span>
        </div>

        <div className="web-account-strip" aria-label="Account summary">
          <AccountMetric label="Equity" value={equity} />
          <AccountMetric label="P&L" value={pnl} tone={pnlTone} />
          <AccountMetric label="Available" value={available} />
          <AccountMetric label="Funds" value={funds} />
          <span className="web-shell-currency">USDC</span>
          <span className="web-shell-live"><i />{network === 'mainnet' ? 'Live' : 'Testnet'}</span>
          <Link href="/account" className="web-connect-button">
            <Ionicons name={address ? 'person-circle-outline' : 'log-in-outline'} size={16} color="currentColor" />
            {address ? 'Account' : 'Connect'}
          </Link>
        </div>
      </header>

      <aside className="web-sidebar">
        <nav className="web-primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)}
        </nav>

        <div className="web-sidebar-spacer" />
        <span className="web-rail-status" title={`${network} market data`}><i /><span>Live</span></span>
        <button
          type="button"
          className={`web-rail-settings${pathname.startsWith('/settings') || settingsOpen ? ' is-active' : ''}`}
          aria-label="Settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(true)}>
          <Ionicons name="settings-outline" size={21} color="currentColor" />
          <span>Settings</span>
        </button>
      </aside>

      <div className="web-main-column">
        <main className="web-page">{children}</main>
      </div>

      <nav className="web-mobile-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)}
      </nav>

      {settingsOpen ? (
        <div className="web-capital-settings-layer">
          <button className="web-capital-settings-scrim" type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />
          <section className="web-capital-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="web-settings-title">
            <header>
              <h2 id="web-settings-title">Settings</h2>
              <button type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><Ionicons name="close" size={22} color="currentColor" /></button>
            </header>
            <div className="web-capital-settings-body">
              <nav aria-label="Settings sections">
                <span className="is-active"><Ionicons name="options-outline" size={19} color="currentColor" /> Platform settings</span>
                <Link href="/account" onPress={() => setSettingsOpen(false)}><Ionicons name="person-outline" size={19} color="currentColor" /> Account</Link>
                <Link href="/news" onPress={() => setSettingsOpen(false)}><Ionicons name="notifications-outline" size={19} color="currentColor" /> Intelligence</Link>
                <Link href="/settings" onPress={() => setSettingsOpen(false)}><Ionicons name="construct-outline" size={19} color="currentColor" /> Advanced</Link>
              </nav>

              <div className="web-capital-settings-content">
                <div className="web-capital-settings-tabs"><span className="is-active">Workspace</span><span>Data</span></div>
                <div className="web-capital-settings-heading">
                  <span>PLATFORM SETTINGS</span>
                  <h3>Workspace preferences</h3>
                  <p>Personalise this browser without changing your trading account.</p>
                </div>
                <div className="web-capital-settings-list">
                  <QuickSetting checked={showClobOrderBook} label="CLOB order book" detail="Show live bid and ask depth beside the chart." onChange={() => setShowClobOrderBook(!showClobOrderBook)} />
                  <QuickSetting checked={privacy} label="Privacy mode" detail="Mask portfolio values throughout the workspace." onChange={() => setPrivacy(!privacy)} />
                  <QuickSetting checked={hideSmallBalances} label="Hide small balances" detail="Remove balances below $1 from portfolio tables." onChange={() => setHideSmallBalances(!hideSmallBalances)} />
                </div>
                <div className="web-capital-provider-row">
                  <span><i /><strong>Hyperliquid</strong><small>Market and account provider</small></span>
                  <em>Live</em>
                </div>
                <Link href="/settings" className="web-capital-settings-link" onPress={() => setSettingsOpen(false)}>Open all settings <Ionicons name="arrow-forward" size={15} color="currentColor" /></Link>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
