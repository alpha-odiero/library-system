import { describe, expect, it } from 'vitest';
import { ROLE_CODES } from '@lms/shared';
import { paths } from '../../routes/paths';
import { DASHBOARD_CONFIGS, dashboardConfigFor, type DashboardConfig } from './configs';

/**
 * Dashboard variants.
 *
 * The page itself is shared, so these tests hold the line on what is NOT
 * shared: which panels each role's page contains, what they are called, and
 * that the quick-link sets point at routes that exist and carry the
 * permissions the router will actually check.
 */

describe('dashboardConfigFor', () => {
  it('returns the configuration for each role', () => {
    expect(dashboardConfigFor('ADMIN').variant).toBe('admin');
    expect(dashboardConfigFor('LIBRARIAN').variant).toBe('librarian');
    expect(dashboardConfigFor('MEMBER').variant).toBe('member');
  });

  it('falls back to the member configuration for anything unknown', () => {
    // Same reasoning as `dashboardPathFor`: an unrecognised role gets the
    // least-privileged layout, not the richest one.
    expect(dashboardConfigFor(null).variant).toBe('member');
    expect(dashboardConfigFor(undefined).variant).toBe('member');
    expect(dashboardConfigFor('ROOT').variant).toBe('member');
  });

  it('covers every declared role code exactly', () => {
    expect(Object.keys(DASHBOARD_CONFIGS).sort()).toEqual([...ROLE_CODES].sort());
  });
});

describe('panel visibility per variant', () => {
  const member = dashboardConfigFor('MEMBER');

  it('omits the performance donut for members', () => {
    // The ring can only describe inventory, while the heading `assemble` gives
    // it for a member is "My Borrowing" — a caption contradicting its own
    // contents. The member's stat row already answers that question.
    expect(member.showPerformance).toBe(false);
    expect(dashboardConfigFor('ADMIN').showPerformance).toBe(true);
    expect(dashboardConfigFor('LIBRARIAN').showPerformance).toBe(true);
  });

  it('keeps the calendar and notice board on every variant', () => {
    for (const role of ROLE_CODES) {
      const config = dashboardConfigFor(role);
      expect(config.showCalendar).toBe(true);
      expect(config.showNoticeBoard).toBe(true);
    }
  });

  it('uses consistent recent activity and notice headings across roles', () => {
    expect(member.recentTitle).toBe('Recent Activities');
    expect(dashboardConfigFor('ADMIN').recentTitle).toBe('Recent Activities');
    expect(dashboardConfigFor('LIBRARIAN').recentTitle).toBe('Recent Activities');
    expect(member.noticesTitle).toBe('Notice Board');
    expect(dashboardConfigFor('ADMIN').noticesTitle).toBe('Notice Board');
    expect(dashboardConfigFor('LIBRARIAN').noticesTitle).toBe('Notice Board');
    expect(member.calendarTitle).toBe('My Due Dates');
  });

  it('names each variant’s region for assistive technology', () => {
    expect(dashboardConfigFor('ADMIN').title).toBe('Administrator dashboard');
    expect(dashboardConfigFor('LIBRARIAN').title).toBe('Librarian dashboard');
    expect(member.title).toBe('Member dashboard');
  });
});

describe('quick-link sets', () => {
  const hrefs = (config: DashboardConfig): string[] => config.quickLinks.map((link) => link.href);

  it('gives administrators the staff-provisioning shortcuts', () => {
    const admin = dashboardConfigFor('ADMIN');
    expect(hrefs(admin)).toContain(paths.librarianNew);
    expect(hrefs(admin)).toContain(paths.librarians);
  });

  it('leaves the directory out of the librarian’s set', () => {
    // LIBRARIAN holds neither USER_VIEW nor USER_CREATE, so the permission
    // filter would drop them anyway — but the configuration saying so means
    // the intent lives in one place rather than being rediscovered by filtering.
    const librarian = dashboardConfigFor('LIBRARIAN');
    expect(hrefs(librarian)).not.toContain(paths.librarianNew);
    expect(hrefs(librarian)).not.toContain(paths.librarians);
  });

  it('gives members their own five destinations', () => {
    expect(hrefs(dashboardConfigFor('MEMBER'))).toEqual([
      paths.books,
      paths.loans,
      paths.reservations,
      paths.fines,
      paths.notifications,
    ]);
  });

  it('carries a permission and an internal href on every tile', () => {
    // The permission is what the filter AND the router rely on; a tile without
    // one would render for a session that then 403s on click.
    for (const role of ROLE_CODES) {
      for (const link of dashboardConfigFor(role).quickLinks) {
        expect(link.permission).toMatch(/^[A-Z_]+$/);
        expect(link.href.startsWith('/')).toBe(true);
      }
    }
  });
});
