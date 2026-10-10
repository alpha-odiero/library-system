import type { PermissionCode, RoleCode } from '@lms/shared';
import { paths } from '../routes/paths';
import { dashboardPathFor, isDashboardPath } from '../routes/roleRoutes';
import type { IconName } from '../components/ui/Icon';

/**
 * The navigation model.
 *
 * One declarative list drives the sidebar, the mobile drawer, the bottom
 * navigation bar, and the global search palette. They would otherwise drift: a
 * link appears in the drawer that the router refuses, and the user gets a 403 page
 * with no explanation.
 *
 * Three rules govern what goes in:
 *
 *   1. **Only routes that exist.** Items whose module has no API yet are absent.
 *      Analytics, Users and Roles are the remaining entries, and they belong here
 *      the day each endpoint does — not before. Reports, Audit Log and Settings
 *      now have real endpoints, so they are present.
 *   2. **Visibility is declarative.** `permissions` is a list, not a hand-written
 *      `can()` call per link, so a member can never be shown an administration
 *      entry by a forgotten conditional. Hiding a link is UX; the backend re-checks
 *      every request regardless.
 *   3. **Sections are role-shaped.** A member's sidebar is four sections of
 *      mostly-loans-and-notifications. An administrator's is eight. The structure
 *      is shared, the content is not — a member sees a sidebar full of entries
 *      that 403, which teaches them the interface does not know what they can do.
 */
export type NavSection =
  | 'Overview'
  | 'My Library'
  | 'Library'
  | 'Circulation'
  | 'People'
  | 'Insights'
  | 'Account'
  | 'System';

/**
 * Section order, with the label rendered above each group.
 *
 * Ordered by task frequency, not alphabetically: what a user does every day sits
 * at the top, what they do once a year at the bottom.
 */
const SECTION_ORDER: readonly NavSection[] = [
  'Overview',
  'My Library',
  'Library',
  'Circulation',
  'People',
  'Insights',
  'Account',
  'System',
];

export interface NavItem {
  label: string;
  to: string;
  section: NavSection;
  icon: IconName;
  /** Visible when the session holds at least one of these. */
  permissions: readonly PermissionCode[];
  /** Matched as a prefix so `/members/:id` keeps the entry highlighted. */
  matchPrefix?: boolean;
  /** Restrict to a role. Absent means any role that holds the permissions. */
  roles?: readonly RoleCode[];
  /** Excluded from the mobile bottom bar, which holds only five destinations. */
  notInBottomBar?: boolean;
  /** Keywords the command palette matches on, beyond the label. */
  keywords?: readonly string[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Dashboard',
    to: paths.dashboard,
    section: 'Overview',
    icon: 'dashboard',
    permissions: [],
    keywords: ['home', 'overview', 'start'],
  },

  /* ── Library ────────────────────────────────────────────────────────────── */
  {
    label: 'Books',
    to: paths.books,
    section: 'Library',
    icon: 'books',
    permissions: ['BOOK_VIEW'],
    matchPrefix: true,
    keywords: ['catalogue', 'catalog', 'titles', 'isbn'],
  },
  {
    label: 'Book Copies',
    to: paths.copies,
    section: 'Library',
    icon: 'copies',
    permissions: ['COPY_VIEW'],
    keywords: ['inventory', 'barcode', 'accession', 'items'],
  },
  {
    label: 'Authors',
    to: paths.authors,
    section: 'Library',
    icon: 'authors',
    permissions: ['AUTHOR_VIEW'],
    keywords: ['writers'],
  },
  {
    label: 'Categories',
    to: paths.categories,
    section: 'Library',
    icon: 'categories',
    permissions: ['CATEGORY_VIEW'],
    keywords: ['subjects', 'classification', 'genres'],
  },
  {
    label: 'Publishers',
    to: paths.publishers,
    section: 'Library',
    icon: 'publishers',
    permissions: ['PUBLISHER_VIEW'],
    keywords: ['imprints', 'presses'],
  },

  /* ── Circulation ────────────────────────────────────────────────────────── */
  {
    label: 'Borrowing',
    to: paths.loans,
    section: 'Circulation',
    icon: 'loans',
    permissions: ['LOAN_VIEW'],
    keywords: ['borrow', 'borrowed', 'issue', 'circulation'],
  },
  {
    label: 'Returns',
    to: paths.returns,
    section: 'Circulation',
    icon: 'returns',
    permissions: ['LOAN_VIEW'],
    keywords: ['check in', 'return', 'checkin'],
  },
  {
    label: 'Reservations',
    to: paths.reservations,
    section: 'Circulation',
    icon: 'reservations',
    permissions: ['RESERVATION_VIEW'],
    keywords: ['holds', 'holds queue', 'waiting', 'queue'],
  },
  {
    label: 'Fines',
    to: paths.fines,
    section: 'Circulation',
    icon: 'fines',
    permissions: ['FINE_VIEW'],
    keywords: ['penalties', 'charges', 'owed', 'outstanding'],
  },
  {
    label: 'Payments',
    to: paths.payments,
    section: 'Circulation',
    icon: 'payments',
    permissions: ['PAYMENT_VIEW'],
    keywords: ['receipts', 'mpesa', 'cash', 'settle'],
  },

  /* ── My Library: the reader's own view ──────────────────────────────────────
   * Separate entries from the staff ones above rather than shared ones, for two
   * reasons. The permissions differ (`LOAN_VIEW` vs `LOAN_VIEW_OWN`), so one item
   * would need two permission lists. The labels differ too — a reader looking for
   * their borrowing history should not have to guess whether "Borrowing" means the
   * whole library or just their copy of it. `navSections` de-duplicates by `to`, so
   * exactly one of each pair survives for any given session.
   */
  {
    label: 'Books Borrowed',
    to: paths.loans,
    section: 'My Library',
    icon: 'loans',
    permissions: ['LOAN_VIEW_OWN'],
    keywords: ['borrow', 'borrowed', 'my books', 'what i have'],
  },
  {
    label: 'Fines Owed',
    to: paths.fines,
    section: 'My Library',
    icon: 'fines',
    permissions: ['FINE_VIEW_OWN'],
    keywords: ['my fines', 'owed', 'penalties', 'charges'],
  },
  {
    label: 'My Holds',
    to: paths.reservations,
    section: 'My Library',
    icon: 'reservations',
    permissions: ['RESERVATION_VIEW_OWN'],
    keywords: ['my holds', 'hold queue', 'waiting', 'reserved'],
  },

  /* ── People ─────────────────────────────────────────────────────────────── */
  {
    label: 'Students',
    to: paths.members,
    section: 'People',
    icon: 'members',
    permissions: ['MEMBER_VIEW'],
    matchPrefix: true,
    keywords: ['patrons', 'register', 'borrowers', 'users'],
  },
  {
    label: 'Student Types',
    to: paths.memberTypes,
    section: 'People',
    icon: 'memberTypes',
    permissions: ['MEMBER_TYPE_VIEW'],
    keywords: ['membership', 'policy', 'tiers', 'limits'],
  },
  {
    /*
     * The staff directory. `USER_VIEW` is ADMIN-only in practice, so this entry
     * appears on exactly one role's sidebar — which is the point: the permission
     * decides, the role does not, and a future role granted `USER_VIEW` inherits
     * the entry without a second declaration here.
     */
    label: 'Staff',
    to: paths.librarians,
    section: 'People',
    icon: 'members',
    permissions: ['USER_VIEW'],
    matchPrefix: true,
    keywords: ['staff', 'accounts', 'provision', 'employee', 'users', 'team'],
  },

  /* ── Account ────────────────────────────────────────────────────────────── */
  {
    label: 'Notifications',
    to: paths.notifications,
    section: 'Account',
    icon: 'megaphone',
    permissions: ['NOTIFICATION_VIEW_OWN'],
    keywords: ['inbox', 'alerts', 'notices', 'announcements'],
  },
  {
    label: 'My Profile',
    to: paths.profile,
    section: 'Account',
    icon: 'profile',
    permissions: [],
    matchPrefix: true,
    keywords: ['account', 'password', 'me', 'security'],
    notInBottomBar: true,
  },
  {
    /*
     * Visible to every role, because every role has an account to arrange: the
     * page offers a librarian their desk preferences and a student their
     * catalogue ones, and an administrator the organization's policy. What a
     * role may CHANGE inside it is decided by the API (`SETTINGS_UPDATE` + the
     * administrator role), not by whether the link exists — a sidebar entry that
     * 403s is a promise the router cannot keep.
     */
    label: 'Settings',
    to: paths.settings,
    section: 'Account',
    icon: 'settings',
    permissions: [],
    keywords: ['preferences', 'configuration', 'theme', 'notifications', 'policy', 'loan period'],
  },

  /* ── Insights ───────────────────────────────────────────────────────────── */
  {
    label: 'Reports',
    to: paths.reports,
    section: 'Insights',
    icon: 'reports',
    permissions: ['REPORT_VIEW'],
    keywords: ['analytics', 'figures', 'summary', 'statistics', 'circulation'],
  },

  /*
   * ── System ─────────────────────────────────────────────────────────────────
   * Administration that no role below ADMIN holds, and a librarian is never
   * asked to audit the desk they operate. See the permission registry in
   * `packages/shared/src/permissions.ts`: AUDIT_* is not granted to LIBRARIAN,
   * so this entry appears on exactly the sidebar that may use it.
   */
  {
    label: 'Audit Log',
    to: paths.audit,
    section: 'System',
    icon: 'auditLog',
    permissions: ['AUDIT_VIEW'],
    keywords: ['audit', 'trail', 'history', 'who changed', 'log'],
  },
];

/**
 * The navigation for one session.
 *
 * `NAV_ITEMS` declares the dashboard entry against `paths.dashboard` (`/`),
 * because that is the path the index route, the guards and every fallback in
 * the app understand. What the sidebar must actually link to is the role's
 * own dashboard — `/admin/dashboard` and friends — so the URL on screen says
 * which dashboard is open. Resolving that here, once, is what keeps the link's
 * destination, its active check and the guard's allowed path in agreement;
 * deriving any of them separately is how a sidebar ends up highlighting a
 * dashboard the router has just bounced the user out of.
 */
export function navItemsFor(role: RoleCode | null | undefined): readonly NavItem[] {
  const dashboardTo = dashboardPathFor(role);
  return NAV_ITEMS.map((item) =>
    item.to === paths.dashboard ? { ...item, to: dashboardTo } : item,
  );
}

/**
 * Groups items into sections, dropping any `to` that appears twice.
 *
 * The de-duplication is what makes the role-shaped pairs work. A librarian holds
 * both `LOAN_VIEW` and `LOAN_VIEW_OWN`, so "Loans" and "My Loans" are both visible —
 * and both point at the same page. Rendering both would put two entries for one
 * destination in the same sidebar under different headings, which reads as a bug.
 * The staff entry is kept because it appears first in `NAV_ITEMS`.
 */
export function navSections(
  items: readonly NavItem[],
): { section: NavSection; items: NavItem[] }[] {
  const seen = new Set<string>();
  const grouped = new Map<NavSection, NavItem[]>();

  for (const item of items) {
    if (seen.has(item.to)) continue;
    seen.add(item.to);

    const existing = grouped.get(item.section);
    if (existing) existing.push(item);
    else grouped.set(item.section, [item]);
  }

  return SECTION_ORDER.filter((section) => grouped.has(section)).map((section) => ({
    section,
    items: grouped.get(section) ?? [],
  }));
}

/**
 * True when the session may see this entry.
 *
 * `roles` is checked as well as permissions because two entries can share a
 * destination while differing in who they are for. The permission check alone is
 * the important one — this is UX; the backend re-checks every request.
 */
export function navItemVisible(
  item: NavItem,
  can: (permission: PermissionCode) => boolean,
  role?: RoleCode,
): boolean {
  if (item.roles && role && !item.roles.includes(role)) return false;
  return item.permissions.length === 0 || item.permissions.some(can);
}

/**
 * Chooses the bottom bar's four primary destinations plus its overflow entry.
 *
 * A bottom bar with more than five items gives each under 72px on a 375px screen,
 * which is below a comfortable touch target and starts mis-tapping. The fifth slot
 * is always "More", which opens the drawer holding everything else — so the bar is
 * the same shape for every role and only its contents differ.
 *
 * Returned rather than declared, because which items qualify depends on the
 * session: a member has no catalogue to browse and a librarian may hold no
 * member-registration rights, so a fixed array would leave holes in the bar.
 */
export function bottomBarItems(items: readonly NavItem[]): NavItem[] {
  const preferred: readonly NavItem['to'][] = [
    paths.dashboard,
    paths.books,
    paths.loans,
    paths.notifications,
  ];

  /*
   * The dashboard entry matches by shape rather than by string: its `to` is the
   * role's dashboard path (see `navItemsFor`), so comparing it to `paths.dashboard`
   * would never hit and the bar would lose its first slot on every role.
   */
  const chosen = preferred
    .map((to) =>
      items.find((item) => (to === paths.dashboard ? isDashboardPath(item.to) : item.to === to)),
    )
    .filter((item): item is NavItem => item !== undefined);

  return chosen.length >= 4 ? chosen.slice(0, 4) : items.slice(0, 4);
}

export function navItemActive(item: NavItem, pathname: string): boolean {
  /*
   * The dashboard entry compares two ways: its own explicit path, and the `/`
   * alias that renders the same page (a brand click, a back navigation, a saved
   * bookmark). Another role's dashboard path is deliberately NOT matched — the
   * guard would have bounced the visitor off it, so highlighting their own
   * entry there would be a lie about which screen is showing.
   */
  if (isDashboardPath(item.to)) return pathname === item.to || pathname === paths.dashboard;
  return item.matchPrefix
    ? pathname === item.to || pathname.startsWith(`${item.to}/`)
    : pathname === item.to;
}

/**
 * The document title for a route. Drives the header and the browser tab.
 *
 * Falls back to the nearest known ancestor, not to "Dashboard": arriving at
 * `/members/:id` should say "Students", because a tab titled "Dashboard" is useless
 * once there are six of them open.
 */
export function pageTitle(pathname: string): string {
  // Checked first: the explicit dashboard paths are not `to` values in the
  // static list (whose dashboard entry reads `/`), so neither the exact nor the
  // prefix match below would recognise them and the tab would fall through to
  // the generic fallback for the app's most-visited route.
  if (isDashboardPath(pathname)) return NAV_ITEMS[0]?.label ?? 'Dashboard';

  const exact = NAV_ITEMS.find((item) => item.to === pathname);
  if (exact) return exact.label;

  const prefixed = NAV_ITEMS.find((item) => item.matchPrefix && pathname.startsWith(`${item.to}/`));
  if (prefixed) return prefixed.label;

  return NAV_ITEMS[0]?.label ?? 'Dashboard';
}
