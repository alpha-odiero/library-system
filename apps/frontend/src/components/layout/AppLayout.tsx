import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { usePageMeta } from '../../app/pageMeta';
import { displayInitials, displayName } from '../../lib/contracts';
import { subscribeToRealtime } from '../../lib/realtime';
import {
  bottomBarItems,
  navItemActive,
  navItemVisible,
  navItemsFor,
  navSections,
  pageTitle,
  type NavItem,
} from '../../app/navigation';
import { isDashboardPath } from '../../routes/roleRoutes';
import { paths } from '../../routes/paths';
import { Button } from '../ui/Button';
import { Brand } from '../ui/Brand';
import { Icon } from '../ui/Icon';
import { GlobalSearch } from './GlobalSearch';
import { unreadCount } from '../../features/notifications/api';

/**
 * The signed-in shell: sidebar, top bar, mobile drawer and bottom navigation.
 *
 * Four behaviours that are easy to omit and expensive to miss:
 *
 *   1. **Focus management on navigation.** A single-page app swaps content without
 *      moving focus, so a screen reader user is left "on" the link they just
 *      activated. Focus moves to `<main>` after each route change.
 *   2. **The document title changes per route**, because the browser tab is the one
 *      piece of app chrome visible in a window switcher of twelve tabs.
 *   3. **Mobile navigation is a `<dialog>`**, so the drawer traps focus and closes
 *      on Escape for free, with `aria-modal` handled by the platform.
 *   4. **A desktop sidebar and a phone bottom bar read from one list**, so a route
 *      cannot appear in one and not the other.
 *
 * The header shows the user's *name* and role rather than an email address. An email
 * in the top-right corner is what a generic admin template does; on a system shared
 * by a whole library it reads as a support ticket number, and it says nothing about
 * whether the person looking at the screen is the librarian they think they are.
 */
export function AppLayout(): ReactNode {
  const { session, can, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const items = useMemo(
    // Role-resolved so the Dashboard entry links to (and highlights at) this
    // session's own dashboard path rather than the `/` alias — see `navItemsFor`.
    () =>
      navItemsFor(session?.roleCode).filter((item) => navItemVisible(item, can, session?.roleCode)),
    [can, session?.roleCode],
  );
  const bar = useMemo(() => bottomBarItems(items), [items]);

  // Close the drawer on navigation: on a phone it covers the page the user just
  // asked for, and nothing in the flow would close it for them.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // Dashboards, registers and member data must not appear in search engines.
  usePageMeta({ robots: 'noindex, follow' });

  useEffect(() => {
    document.title = `${pageTitle(location.pathname)} · Soma360`;
  }, [location.pathname]);

  // Move focus into the new page after each navigation. `#main` already carries
  // `tabIndex={-1}`, so it is focusable without being a tab stop.
  //
  // Skipped on first render: arriving at the app should not yank focus out of the
  // browser chrome or off the control that submitted the sign-in form.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    document.getElementById('main')?.focus();
  }, [location.pathname]);

  const closeAccount = useCallback(() => setAccountOpen(false), []);

  return (
    <div
      className={['shell', sidebarCollapsed && 'shell--collapsed'].filter(Boolean).join(' ')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeAccount();
      }}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="topbar">
        <button
          type="button"
          className="topbar__menu icon-button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
        >
          <Icon name="menu" />
        </button>

        <Link className="topbar__brand" to={paths.dashboard} aria-label="Soma360 dashboard">
          <Brand compact />
        </Link>

        {/*
          Always present, dashboard included. It used to be hidden here and, on
          every other page, a button that dispatched an event nothing handled —
          so the one header control promising search never searched.
        */}
        <GlobalSearch />

        <div className="topbar__spacer" />

        <NotificationBell />

        <Button
          variant="ghost"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        </Button>

        <div className="user-menu">
          <button
            type="button"
            className="user-menu__trigger"
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            onClick={() => setAccountOpen((open) => !open)}
          >
            <span className="avatar" aria-hidden="true">
              {displayInitials(session)}
            </span>
            <span className="user-menu__copy">
              <span className="user-menu__name">{displayName(session)}</span>
              <span className="user-menu__meta">{roleLabel(session?.roleCode)}</span>
            </span>
            <Icon name="chevronDown" className="user-menu__chevron" />
          </button>

          <AccountMenu open={accountOpen} onClose={closeAccount} onSignOut={() => void signOut()} />
        </div>
      </header>

      <nav className="sidebar" aria-label="Main">
        <div className="sidebar__brand">
          <Link to={paths.dashboard} aria-label="Soma360 dashboard">
            <Brand />
          </Link>
          <button
            type="button"
            className="sidebar__collapse icon-button"
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'chevronLeft'} />
          </button>
        </div>

        <NavigationSections
          items={items}
          pathname={location.pathname}
          collapsed={sidebarCollapsed}
        />

        <div className="sidebar__foot">
          <p className="sidebar__foot-label">Soma360 LMS</p>
          <p className="sidebar__foot-note">Keep learning. Small steps make big progress!</p>
        </div>
      </nav>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={items}
        pathname={location.pathname}
      />

      <main className="content" id="main" tabIndex={-1}>
        <Outlet />
      </main>

      {/*
        The bottom bar's overflow slot is a real button rather than a fifth link,
        because there is no fifth destination: everything that does not fit lives in
        the drawer this opens.
      */}
      <nav className="bottom-nav" aria-label="Primary">
        <ul className="bottom-nav__list">
          {bar.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={isDashboardPath(item.to)}
                className={({ isActive }) =>
                  [
                    'bottom-nav__link',
                    (isActive || navItemActive(item, location.pathname)) && 'is-current',
                  ]
                    .filter(Boolean)
                    .join(' ')
                }
                aria-current={navItemActive(item, location.pathname) ? 'page' : undefined}
              >
                <Icon name={item.icon} />
                <span>{shortLabel(item.label)}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="bottom-nav__link"
              onClick={() => setDrawerOpen(true)}
              aria-label="More destinations"
            >
              <Icon name="moreHorizontal" />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}

/**
 * The unread notification count.
 *
 * Fetched once on mount and polled slowly rather than on every navigation, and a
 * failure renders no badge at all. A bell showing "0" when the count could not be
 * read is a claim the system cannot support; no badge is merely quiet.
 */
function NotificationBell(): ReactNode {
  const { can } = useAuth();
  const entitled = can('NOTIFICATION_VIEW_OWN');
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!entitled) return;

    const controller = new AbortController();
    let cancelled = false;

    const read = (): void => {
      void unreadCount()
        .then((value) => {
          if (!cancelled) setCount(value);
        })
        .catch(() => {
          if (!cancelled) setCount(null);
        });
    };

    read();
    // Sixty seconds is frequent enough that a reminder arriving is noticed, and rare
    // enough that an open dashboard is not holding a request open every second.
    const timer = setInterval(read, 60_000);
    // Realtime makes the badge reflect a new notice the moment it is broadcast,
    // instead of waiting for the poll tick.
    const unsubscribe = subscribeToRealtime('notifications', read);

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
      controller.abort();
    };
  }, [entitled]);

  if (!entitled || count === null || count === 0) return null;

  return (
    <Link
      className="icon-button"
      to={paths.notifications}
      aria-label={`${count} unread notifications`}
    >
      <Icon name="megaphone" />
      <span className="notice-dot">{count > 9 ? '9+' : count}</span>
    </Link>
  );
}

function AccountMenu({
  open,
  onClose,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
}): ReactNode {
  const { session } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <div
      className="account-menu"
      role="menu"
      hidden={!open}
      onClick={(event) => {
        // Any click inside closes it; the trigger is outside this element.
        if ((event.target as HTMLElement).closest('a, button')) onClose();
      }}
    >
      <div className="account-menu__identity">
        <p className="account-menu__name">{displayName(session)}</p>
        <p className="account-menu__meta">
          {roleLabel(session?.roleCode)}
          {session?.primaryBranchName ? ` · ${session.primaryBranchName}` : ''}
        </p>
        <p className="account-menu__meta">{session?.email}</p>
      </div>

      <Link className="account-menu__item" to={paths.profile} role="menuitem">
        <Icon name="profile" />
        Your profile
      </Link>

      {/*
        The theme toggle is offered here as well as in the top bar. The top-bar
        button is for someone who wants to flip it once; this is for someone who
        arrived on a laptop at a desk and needs dark for the rest of the shift.
      */}
      <button
        type="button"
        className="account-menu__item"
        role="menuitem"
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      >
        <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        {theme === 'light' ? 'Dark mode' : 'Light mode'}
      </button>

      <div className="account-menu__divider" role="separator" />

      <button
        type="button"
        className="account-menu__item account-menu__item--danger"
        role="menuitem"
        onClick={onSignOut}
      >
        <Icon name="logout" />
        Sign out
      </button>
    </div>
  );
}

function MobileDrawer({
  open,
  onClose,
  items,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  items: readonly NavItem[];
  pathname: string;
}): ReactNode {
  const ref = (element: HTMLDialogElement | null): void => {
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>('a, button')?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  };

  return (
    <dialog
      className="drawer"
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="drawer__brand">
        <Brand />
        <Button variant="ghost" aria-label="Close navigation" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>
      <NavigationSections items={items} pathname={pathname} onNavigate={onClose} />
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </dialog>
  );
}

function NavigationSections({
  items,
  pathname,
  collapsed = false,
  onNavigate,
}: {
  items: readonly NavItem[];
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}): ReactNode {
  const className = onNavigate ? 'drawer__list' : 'sidebar__list';
  const linkClass = onNavigate ? 'drawer__link' : 'sidebar__link';

  return (
    <div className="nav-sections">
      {navSections(items).map(({ section, items: sectionItems }) => (
        <section className="nav-section" key={section} aria-label={section}>
          {!collapsed && <h2 className="nav-section__title">{section}</h2>}
          <ul className={className}>
            {sectionItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={isDashboardPath(item.to)}
                  title={collapsed ? item.label : undefined}
                  onClick={onNavigate}
                  aria-current={navItemActive(item, pathname) ? 'page' : undefined}
                  className={({ isActive }) =>
                    [
                      linkClass,
                      (isActive || navItemActive(item, pathname)) && 'sidebar__link--current',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  }
                >
                  <Icon name={item.icon} className="sidebar__icon" />
                  <span className="sidebar__link-label">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** `ADMIN` reads as `Administrator` in a header; the enum does not. */
function roleLabel(role: string | undefined): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrator';
    case 'LIBRARIAN':
      return 'Librarian';
    case 'MEMBER':
      return 'Student';
    default:
      return 'Signed in';
  }
}

/**
 * The bottom bar has room for an icon and about seven characters.
 *
 * `Books Borrowed` at that width would either wrap to two lines and shift the bar,
 * or shrink the text below a legible size, so the bar uses the short form and the
 * drawer shows the full label.
 *
 * The map is explicit rather than a `.slice()`: truncating to a fixed length cuts a
 * label off mid-word ("Books Bor", "Fines Owe") and two lines of bottom bar shifting
 * every time a route changes is worse than any label being slightly informal. Only
 * the labels that genuinely do not fit need an entry — the rest pass through.
 */
const SHORT_LABELS: Record<string, string> = {
  'Books Borrowed': 'Borrowed',
  'Fines Owed': 'Fines',
  Student: 'Student',
  Students: 'Students',
};

function shortLabel(label: string): string {
  const mapped = SHORT_LABELS[label];
  if (mapped) return mapped;

  return label
    .replace(/^My\s+/, '')
    .replace('Notifications', 'Notices')
    .slice(0, 9);
}
