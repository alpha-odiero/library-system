import { describe, expect, it } from 'vitest';
import { paths } from './paths';
import {
  DASHBOARD_PATHS,
  dashboardPathFor,
  isDashboardPath,
  roleForDashboardPath,
} from './roleRoutes';

/**
 * Role → dashboard routing.
 *
 * These mappings are read by the sign-in redirect, the sidebar's active check
 * and the `RequireRole` bounce. A drift between any two of them is a user
 * redirected to a dashboard they are then bounced out of, so the contract is
 * pinned here rather than left to a manual walk-through of three roles.
 */

describe('dashboardPathFor', () => {
  it('maps each role to its own dashboard', () => {
    expect(dashboardPathFor('ADMIN')).toBe(paths.adminDashboard);
    expect(dashboardPathFor('LIBRARIAN')).toBe(paths.librarianDashboard);
    expect(dashboardPathFor('MEMBER')).toBe(paths.memberDashboard);
  });

  it('falls back to the member dashboard for anything unknown', () => {
    // The least-privileged answer: an unrecognised role code should land where
    // it cannot be shown a screen built for a more powerful account.
    expect(dashboardPathFor(null)).toBe(paths.memberDashboard);
    expect(dashboardPathFor(undefined)).toBe(paths.memberDashboard);
    expect(dashboardPathFor('ROOT')).toBe(paths.memberDashboard);
    expect(dashboardPathFor('')).toBe(paths.memberDashboard);
  });
});

describe('isDashboardPath', () => {
  it('recognises the index alias and all three explicit paths', () => {
    expect(isDashboardPath(paths.dashboard)).toBe(true);
    expect(isDashboardPath(DASHBOARD_PATHS.ADMIN)).toBe(true);
    expect(isDashboardPath(DASHBOARD_PATHS.LIBRARIAN)).toBe(true);
    expect(isDashboardPath(DASHBOARD_PATHS.MEMBER)).toBe(true);
  });

  it('rejects everything that only looks like one', () => {
    // `/admin` and `/admin/dashboard/` are the near-misses a string prefix check
    // would wrongly accept.
    expect(isDashboardPath('/admin')).toBe(false);
    expect(isDashboardPath('/admin/dashboard/edit')).toBe(false);
    expect(isDashboardPath('/login')).toBe(false);
    expect(isDashboardPath('/librarians')).toBe(false);
  });
});

describe('roleForDashboardPath', () => {
  it('names the owning role of each explicit path', () => {
    expect(roleForDashboardPath(paths.adminDashboard)).toBe('ADMIN');
    expect(roleForDashboardPath(paths.librarianDashboard)).toBe('LIBRARIAN');
    expect(roleForDashboardPath(paths.memberDashboard)).toBe('MEMBER');
  });

  it('returns null for the index alias and for non-dashboard paths', () => {
    // The alias belongs to whichever role is signed in, so it answers to no
    // single role — the guard therefore treats it as "not a role dashboard".
    expect(roleForDashboardPath(paths.dashboard)).toBeNull();
    expect(roleForDashboardPath(paths.books)).toBeNull();
  });
});
