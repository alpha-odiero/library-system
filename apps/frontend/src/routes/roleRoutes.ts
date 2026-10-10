import type { RoleCode } from '@lms/shared';
import { paths } from './paths';

/**
 * Role → dashboard routing.
 *
 * One module so the mapping cannot drift between the three places that read it:
 * the sign-in redirect, the nav item's `to`/active check, and the `RequireRole`
 * bounce. A dashboard path that the guard rejects but the nav highlights (or the
 * other way round) is the exact class of bug this file exists to prevent.
 */

export const DASHBOARD_PATHS = {
  ADMIN: paths.adminDashboard,
  LIBRARIAN: paths.librarianDashboard,
  MEMBER: paths.memberDashboard,
} as const satisfies Record<RoleCode, string>;

/**
 * Where a role's dashboard lives.
 *
 * An unknown (or absent) role resolves to the MEMBER path rather than the
 * administrator's: the fallback is only reachable when the session carries a role
 * this build does not recognise, and the least-privileged answer is the one that
 * cannot expose a screen the account may not be entitled to. The backend decides
 * what the role *is*; this decides only where a browser goes when it does not
 * know.
 */
export function dashboardPathFor(roleCode: string | null | undefined): string {
  switch (roleCode) {
    case 'ADMIN':
      return DASHBOARD_PATHS.ADMIN;
    case 'LIBRARIAN':
      return DASHBOARD_PATHS.LIBRARIAN;
    default:
      return DASHBOARD_PATHS.MEMBER;
  }
}

/** True for the role-aware index and every explicit role dashboard path. */
export function isDashboardPath(pathname: string): boolean {
  return (
    pathname === paths.dashboard ||
    pathname === DASHBOARD_PATHS.ADMIN ||
    pathname === DASHBOARD_PATHS.LIBRARIAN ||
    pathname === DASHBOARD_PATHS.MEMBER
  );
}

/** The role a dashboard path belongs to, or null when it is not one. */
export function roleForDashboardPath(pathname: string): RoleCode | null {
  switch (pathname) {
    case DASHBOARD_PATHS.ADMIN:
      return 'ADMIN';
    case DASHBOARD_PATHS.LIBRARIAN:
      return 'LIBRARIAN';
    case DASHBOARD_PATHS.MEMBER:
      return 'MEMBER';
    default:
      return null;
  }
}
