import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname } from 'expo-router';
import type { PropsWithChildren } from 'react';

type NavItem = {
  href: '/' | '/markets' | '/news' | '/account' | '/settings';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Watchlist', icon: 'bookmark-outline', activeIcon: 'bookmark' },
  { href: '/markets', label: 'Markets', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { href: '/news', label: 'News', icon: 'newspaper-outline', activeIcon: 'newspaper' },
  { href: '/account', label: 'Portfolio', icon: 'wallet-outline', activeIcon: 'wallet' },
];

const routeTitle = (pathname: string) => {
  if (pathname.startsWith('/markets')) return 'Markets';
  if (pathname.startsWith('/news')) return 'News pulse';
  if (pathname.startsWith('/account')) return 'Portfolio';
  if (pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/symbol')) return 'Market detail';
  return 'Watchlist';
};

function BrandMark() {
  return (
    <span className="web-brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      className={`web-nav-link${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}>
      <Ionicons name={active ? item.activeIcon : item.icon} size={19} color="currentColor" />
      <span>{item.label}</span>
    </Link>
  );
}

export function WebShell({ children }: PropsWithChildren) {
  const pathname = usePathname();

  return (
    <div className="web-app-shell">
      <aside className="web-sidebar">
        <Link href="/" className="web-brand" aria-label="TradingView home">
          <BrandMark />
          <span className="web-brand-name">TradingView</span>
        </Link>

        <nav className="web-primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>

        <div className="web-sidebar-spacer" />
        <Link href="/settings" className={`web-nav-link${pathname.startsWith('/settings') ? ' is-active' : ''}`}>
          <Ionicons
            name={pathname.startsWith('/settings') ? 'settings' : 'settings-outline'}
            size={19}
            color="currentColor"
          />
          <span>Settings</span>
        </Link>
        <div className="web-data-status">
          <span className="web-live-dot" />
          <span>Live markets</span>
        </div>
      </aside>

      <div className="web-main-column">
        <header className="web-topbar">
          <div>
            <p className="web-eyebrow">LIVE WORKSPACE</p>
            <h1>{routeTitle(pathname)}</h1>
          </div>
          <div className="web-topbar-actions">
            <Link href="/markets" className="web-search-link">
              <Ionicons name="search" size={16} color="currentColor" />
              <span>Search markets</span>
              <kbd>/</kbd>
            </Link>
            <Link href="/account" className="web-account-link">
              <span className="web-account-orb">EH</span>
              <span>Portfolio</span>
            </Link>
          </div>
        </header>

        <main className="web-page">{children}</main>
      </div>

      <nav className="web-mobile-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
    </div>
  );
}
