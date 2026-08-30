import { Link, usePathname } from 'expo-router';
import { useState, type PropsWithChildren } from 'react';

import { usePreferences } from '@/store/preferences';

type NavItem = {
  href: '/' | '/markets' | '/news' | '/economic-calendar' | '/account';
  label: string;
  glyph: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Trade', glyph: '⌁' },
  { href: '/markets', label: 'Markets', glyph: '▥' },
  { href: '/news', label: 'News', glyph: '▤' },
  { href: '/economic-calendar', label: 'Calendar', glyph: '▦' },
  { href: '/account', label: 'Portfolio', glyph: '▱' },
];

function BrandMark() {
  return <span className="web-xyz-wordmark" aria-hidden="true">[XYZ]</span>;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      className={`web-nav-link${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}>
      <span className="web-nav-icon" aria-hidden="true">{item.glyph}</span>
      <span>{item.label}</span>
    </Link>
  );
}

export function WebShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const showClobOrderBook = usePreferences((state) => state.showClobOrderBook);
  const setShowClobOrderBook = usePreferences((state) => state.setShowClobOrderBook);

  return (
    <div className="web-app-shell">
      <header className="web-topbar">
        <Link href="/" className="web-brand" aria-label="TradingView terminal home">
          <BrandMark />
        </Link>

        <nav className="web-primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)}
        </nav>

        <div className="web-topbar-actions">
          <Link href="/account" className="web-connect-button">Connect</Link>
          <div className="web-xyz-settings-control">
            <button
              type="button"
              className={`web-icon-button${pathname.startsWith('/settings') || settingsOpen ? ' is-active' : ''}`}
              aria-label="Settings"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.38.4.72.7 1 .3.27.69.42 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
              </svg>
            </button>
            {settingsOpen ? (
              <>
                <button className="web-xyz-settings-scrim" type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />
                <div className="web-xyz-settings-menu" role="dialog" aria-label="Layout settings">
                  <div className="web-xyz-settings-menu-label">Layout</div>
                  <button
                    className="web-xyz-settings-menu-row"
                    type="button"
                    role="switch"
                    aria-checked={showClobOrderBook}
                    onClick={() => setShowClobOrderBook(!showClobOrderBook)}>
                    <span>Show Order Book</span>
                    <span className={`web-xyz-settings-toggle${showClobOrderBook ? ' is-on' : ''}`} aria-hidden="true"><i /></span>
                  </button>
                  <div className="web-xyz-settings-menu-label">Data</div>
                  <div className="web-xyz-settings-menu-row is-static"><span>Provider</span><small>Hyperliquid</small></div>
                  <Link href="/settings" className="web-xyz-settings-menu-link" onPress={() => setSettingsOpen(false)}>
                    <span>All settings</span><span aria-hidden="true">→</span>
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="web-main-column">
        <main className="web-page">{children}</main>
      </div>

      <nav className="web-mobile-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)}
      </nav>
    </div>
  );
}
