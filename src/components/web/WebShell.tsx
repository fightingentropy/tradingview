import { Link, usePathname } from 'expo-router';
import type { PropsWithChildren } from 'react';

type NavItem = {
  href: '/' | '/markets' | '/news' | '/account';
  label: string;
  glyph: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Trade', glyph: '⌁' },
  { href: '/markets', label: 'Markets', glyph: '▥' },
  { href: '/news', label: 'News', glyph: '▤' },
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
          <Link
            href="/settings"
            className={`web-icon-button${pathname.startsWith('/settings') ? ' is-active' : ''}`}
            aria-label="Settings">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.38.4.72.7 1 .3.27.69.42 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </Link>
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
