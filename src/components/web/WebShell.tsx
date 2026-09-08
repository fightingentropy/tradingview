import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname, type Href } from 'expo-router';
import { useEffect, type PropsWithChildren } from 'react';

type NavItem = {
  href: Href;
  match: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', match: '/', label: 'Trade', icon: 'analytics-outline' },
  { href: '/markets', match: '/markets', label: 'Markets', icon: 'grid-outline' },
  { href: { pathname: '/symbol/[id]', params: { id: 'hl:perp:BTC' } }, match: '/symbol/', label: 'Charts', icon: 'bar-chart-outline' },
  { href: '/account', match: '/account', label: 'Portfolio', icon: 'briefcase-outline' },
  { href: '/news', match: '/news', label: 'News', icon: 'newspaper-outline' },
  { href: '/economic-calendar', match: '/economic-calendar', label: 'Calendar', icon: 'calendar-outline' },
];
const SETTINGS: NavItem = { href: '/settings', match: '/settings', label: 'Settings', icon: 'settings-outline' };

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match === '/' ? pathname === '/' : pathname.startsWith(item.match);
  return (
    <Link href={item.href} className={`web-nav-link${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined} accessibilityLabel={item.label}>
      <span className="web-nav-icon" aria-hidden="true"><Ionicons name={item.icon} size={19} color="currentColor" /></span>
      <span className="web-nav-label">{item.label}</span>
    </Link>
  );
}

export function WebShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  const page = [...NAV_ITEMS, SETTINGS].find((item) => item.match === '/' ? pathname === '/' : pathname.startsWith(item.match));
  const title = pathname.startsWith('/related-news') ? 'Related news' : page?.label ?? 'Workspace';

  return (
    <div className="web-app-shell">
      <a className="web-skip-link" href="#workspace">Skip to content</a>
      <header className="web-topbar">
        <Link href="/" className="web-brand" aria-label="XYZ terminal home">
          <span className="web-xyz-wordmark">XYZ<span>terminal</span></span>
        </Link>
        <div className="web-workspace-title"><span>Workspace</span><i aria-hidden="true">/</i><strong>{title}</strong></div>
        <div className="web-topbar-actions">
          <span className="web-read-only"><Ionicons name="eye-outline" size={14} color="currentColor" /> Read only</span>
          <Link href="/account" className="web-quiet-button"><Ionicons name="person-circle-outline" size={16} color="currentColor" /> Account</Link>
        </div>
      </header>

      <aside className="web-sidebar">
        <span className="web-nav-heading">Workspace</span>
        <nav className="web-primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => <NavLink key={item.label} item={item} pathname={pathname} />)}
        </nav>
        <div className="web-sidebar-spacer" />
        <nav className="web-secondary-nav" aria-label="Preferences"><NavLink item={SETTINGS} pathname={pathname} /></nav>
      </aside>

      <div className="web-main-column"><main className="web-page" id="workspace">{children}</main></div>
      <nav className="web-mobile-nav" aria-label="Mobile navigation">
        {[...NAV_ITEMS, SETTINGS].map((item) => <NavLink key={item.label} item={item} pathname={pathname} />)}
      </nav>
    </div>
  );
}
