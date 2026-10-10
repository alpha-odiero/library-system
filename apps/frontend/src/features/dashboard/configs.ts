import type { RoleCode } from '@lms/shared';
import { paths } from '../../routes/paths';
import { QUICK_ACCESS, type QuickLink } from './useDashboardData';

/**
 * Role-shaped dashboard configuration.
 *
 * The three dashboards are one page component with one data hook, because the
 * panels, the arithmetic and the permission gates are genuinely shared. What is
 * NOT shared is which panels a role should see and what they are called: a
 * member's "Recent Circulation" is their own loan history, and titling it the
 * same as the staff table would describe the wrong document.
 *
 * Two rules govern the fields:
 *
 *   1. **Configuration decides visibility, permissions decide truth.** A flag
 *      here omits a panel from the layout; it never substitutes for `can()` —
 *      every request `useDashboardData` fires is still gated on the session's
 *      permissions, and the server re-checks regardless. The two layers are
 *      deliberately redundant: the flag keeps a role's page coherent, the
 *      permission keeps an entitlement honest.
 *   2. **Every quick link still carries its permission.** The tile list below is
 *      filtered by `can()` before render, so an administrator signing in on a
 *      library without the `USER_CREATE` grant sees no dead "Add Librarian"
 *      tile rather than one that 403s when clicked.
 */

export type DashboardVariant = 'admin' | 'librarian' | 'member';

export interface DashboardConfig {
  /** Which role's dashboard this is. Mirrors the route guard's answer. */
  readonly variant: DashboardVariant;
  /** Accessible name of the dashboard region, e.g. "Administrator dashboard". */
  readonly title: string;
  readonly recentTitle: string;
  readonly noticesTitle: string;
  readonly quickLinksTitle: string;
  readonly calendarTitle: string;
  readonly showCalendar: boolean;
  readonly showNoticeBoard: boolean;
  readonly showPerformance: boolean;
  /** Candidate tiles, before permission filtering. */
  readonly quickLinks: readonly QuickLink[];
}

/* ── Quick-link sets ─────────────────────────────────────────────────────────
 * The staff tiles already exist as `QUICK_ACCESS`; the sets below compose them
 * with the tiles only that role's work needs. Members see none of the staff
 * tiles — not because they would 403 (they hold no staff permission, so the
 * filter would drop them anyway) but because a five-tile panel where four tiles
 * are somebody else's job is noise on the page a patron actually opens.
 */

const MEMBER_QUICK_LINKS: readonly QuickLink[] = [
  {
    label: 'Browse Books',
    href: paths.books,
    icon: 'books',
    permission: 'BOOK_VIEW',
    tone: 'blue',
  },
  {
    label: 'My Loans',
    href: paths.loans,
    icon: 'loans',
    permission: 'LOAN_VIEW_OWN',
    tone: 'purple',
  },
  {
    label: 'My Holds',
    href: paths.reservations,
    icon: 'reservations',
    permission: 'RESERVATION_VIEW_OWN',
    tone: 'orange',
  },
  {
    label: 'My Fines',
    href: paths.fines,
    icon: 'fines',
    permission: 'FINE_VIEW_OWN',
    tone: 'red',
  },
  {
    label: 'Notices',
    href: paths.notifications,
    icon: 'megaphone',
    permission: 'NOTIFICATION_VIEW_OWN',
    tone: 'blue',
  },
];

const STAFF_QUICK_LINKS: readonly QuickLink[] = QUICK_ACCESS;

const ADMIN_QUICK_LINKS: readonly QuickLink[] = [
  // The two administrative tiles lead, because provisioning the desk is the one
  // task on this list nothing else on the dashboard shortcuts.
  {
    label: 'Add Librarian',
    href: paths.librarianNew,
    icon: 'userPlus',
    permission: 'USER_CREATE',
    tone: 'green',
  },
  {
    label: 'Library Staff',
    href: paths.librarians,
    icon: 'members',
    permission: 'USER_VIEW',
    tone: 'blue',
  },
  ...STAFF_QUICK_LINKS,
];

/* ── The three configurations ──────────────────────────────────────────────── */

const ADMIN_DASHBOARD: DashboardConfig = {
  variant: 'admin',
  title: 'Administrator dashboard',
  recentTitle: 'Recent Activities',
  noticesTitle: 'Notice Board',
  quickLinksTitle: 'Quick Access',
  calendarTitle: 'Library Calendar',
  showCalendar: true,
  showNoticeBoard: true,
  // The donut can only describe inventory the session may count. An
  // administrator holds both catalogue grants, so the ring is real for them.
  showPerformance: true,
  quickLinks: ADMIN_QUICK_LINKS,
};

const LIBRARIAN_DASHBOARD: DashboardConfig = {
  variant: 'librarian',
  title: 'Librarian dashboard',
  recentTitle: 'Recent Activities',
  noticesTitle: 'Notice Board',
  quickLinksTitle: 'Quick Access',
  calendarTitle: 'Library Calendar',
  showCalendar: true,
  showNoticeBoard: true,
  showPerformance: true,
  // Deliberately not the administrative tiles: a librarian's job is the desk,
  // and the staff directory is behind `USER_VIEW`, which LIBRARIAN does not
  // hold (`packages/shared/src/roles.ts`). The permission filter would drop
  // those tiles anyway; leaving them out of the list says the same thing in
  // the configuration rather than relying on the filter to discover it.
  quickLinks: STAFF_QUICK_LINKS,
};

const MEMBER_DASHBOARD: DashboardConfig = {
  variant: 'member',
  title: 'Member dashboard',
  recentTitle: 'Recent Activities',
  noticesTitle: 'Notice Board',
  quickLinksTitle: 'Quick Actions',
  calendarTitle: 'My Due Dates',
  showCalendar: true,
  showNoticeBoard: true,
  /*
   * The ring is inventory, not borrowing. `assemble` labels it "My Borrowing"
   * for a member while every segment counts library-wide copies, so rendering
   * it would be a heading contradicting its own contents — and the member's
   * stat row already answers "what do I have out, what is late, what do I owe"
   * with figures that ARE theirs. The panel is omitted rather than re-labelled,
   * because there is no honest title for a patron's inventory donut on their
   * own dashboard.
   */
  showPerformance: false,
  quickLinks: MEMBER_QUICK_LINKS,
};

export const DASHBOARD_CONFIGS = {
  ADMIN: ADMIN_DASHBOARD,
  LIBRARIAN: LIBRARIAN_DASHBOARD,
  MEMBER: MEMBER_DASHBOARD,
} as const satisfies Record<RoleCode, DashboardConfig>;

/**
 * The configuration for a role, defaulting to the member's.
 *
 * The default matters for the same reason `dashboardPathFor` falls back to the
 * member path: an unrecognised role code is only reachable when the session
 * carries something this build does not know, and the least-privileged layout
 * is the one that cannot present a screen the account may not be entitled to.
 */
export function dashboardConfigFor(roleCode: string | null | undefined): DashboardConfig {
  switch (roleCode) {
    case 'ADMIN':
      return DASHBOARD_CONFIGS.ADMIN;
    case 'LIBRARIAN':
      return DASHBOARD_CONFIGS.LIBRARIAN;
    default:
      return DASHBOARD_CONFIGS.MEMBER;
  }
}
