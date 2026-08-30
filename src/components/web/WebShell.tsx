import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname, type Href } from 'expo-router';
import { useEffect, useState, type PropsWithChildren } from 'react';

import { useHlAccount } from '@/data/useHlAccount';
import { signedUsd, usd } from '@/lib/format';
import { useHlConnection } from '@/store/hlConnection';
import { usePreferences } from '@/store/preferences';

type NavItem = {
  href: Href;
  match: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', match: '/', label: 'Trade', icon: 'analytics-outline' },
  { href: '/markets', match: '/markets', label: 'Discover', icon: 'git-network-outline' },
  { href: { pathname: '/symbol/[id]', params: { id: 'hl:perp:BTC' } }, match: '/symbol/', label: 'Charts', icon: 'bar-chart-outline' },
  { href: '/account', match: '/account', label: 'Portfolio', icon: 'briefcase-outline' },
  { href: '/news', match: '/news', label: 'News', icon: 'newspaper-outline' },
  { href: '/economic-calendar', match: '/economic-calendar', label: 'Calendar', icon: 'calendar-outline' },
];

function BrandMark() {
  return <span className="web-xyz-wordmark" aria-hidden="true">[XYZ]</span>;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match === '/'
    ? pathname === '/'
    : pathname.startsWith(item.match);
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

        <div className="web-account-strip" aria-label="Account summary">
          <span className="web-account-collapse" aria-hidden="true"><Ionicons name="chevron-forward" size={14} color="currentColor" /></span>
          <AccountMetric label="Equity" value={equity} />
          <AccountMetric label="P&L" value={pnl} tone={pnlTone} />
          <AccountMetric label="Available" value={available} />
          <AccountMetric label="Funds" value={funds} />
          <span className="web-shell-more" aria-hidden="true"><Ionicons name="ellipsis-vertical" size={17} color="currentColor" /></span>
          <span className="web-shell-currency">USDC <Ionicons name="chevron-down" size={12} color="currentColor" /></span>
          <Link href="/account" className="web-connect-button">
            {address ? (network === 'mainnet' ? 'Live' : 'Testnet') : 'Connect'}
            <Ionicons name="chevron-down" size={12} color="currentColor" />
          </Link>
        </div>
      </header>

      <aside className="web-sidebar">
        <nav className="web-primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => <NavLink key={item.label} item={item} pathname={pathname} />)}
        </nav>

        <div className="web-sidebar-spacer" />
        <Link href="/news" className="web-rail-help" aria-label="Get help">
          <Ionicons name="help-circle-outline" size={21} color="currentColor" />
          <span>Get Help</span>
        </Link>
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
        {NAV_ITEMS.map((item) => <NavLink key={item.label} item={item} pathname={pathname} />)}
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
                <Link href="/account" onPress={() => setSettingsOpen(false)}><Ionicons name="people-outline" size={20} color="currentColor" /> My account</Link>
                <Link href="/account" onPress={() => setSettingsOpen(false)}><Ionicons name="person-circle-outline" size={20} color="currentColor" /> Personal details</Link>
                <Link href="/settings" onPress={() => setSettingsOpen(false)}><Ionicons name="shield-checkmark-outline" size={20} color="currentColor" /> Privacy</Link>
                <Link href="/news" onPress={() => setSettingsOpen(false)}><Ionicons name="notifications-outline" size={20} color="currentColor" /> Notifications</Link>
                <span className="is-active"><Ionicons name="options-outline" size={20} color="currentColor" /> Platform settings</span>
              </nav>

              <div className="web-capital-settings-content">
                <div className="web-capital-settings-section">
                  <h3>Display settings</h3>
                  <p>Display preferences apply to the XYZ web terminal.</p>
                  <div className="web-capital-select-row"><span><small>Theme</small><strong>Dark</strong></span><Ionicons name="chevron-down" size={15} color="currentColor" /></div>
                </div>
                <div className="web-capital-settings-section">
                  <h3>Trading workspace</h3>
                  <p>Choose what appears around every market chart.</p>
                  <div className="web-capital-settings-list">
                    <QuickSetting checked={showClobOrderBook} label="CLOB order book" detail="Show live bid and ask depth in Trade." onChange={() => setShowClobOrderBook(!showClobOrderBook)} />
                    <QuickSetting checked={privacy} label="Privacy mode" detail="Mask account values throughout the workspace." onChange={() => setPrivacy(!privacy)} />
                    <QuickSetting checked={hideSmallBalances} label="Hide small balances" detail="Remove balances below $1 from portfolio tables." onChange={() => setHideSmallBalances(!hideSmallBalances)} />
                  </div>
                </div>
                <div className="web-capital-settings-section">
                  <h3>Chart defaults</h3>
                  <p>This is applied whenever a new market is opened.</p>
                  <div className="web-capital-chart-defaults"><span><small>Timeframe</small><strong>5m</strong></span><span><small>Chart type</small><strong>Candles</strong></span></div>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
