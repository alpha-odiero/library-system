import { describe, expect, it } from 'vitest';
import { paths } from '../routes/paths';
import {
  NAV_ITEMS,
  bottomBarItems,
  navItemActive,
  navItemVisible,
  navItemsFor,
  navSections,
  pageTitle,
  type NavItem,
} from './navigation';

/**
 * Navigation.
 *
 * The sidebar is the map of the application: an entry that points at the wrong
 * dashboard, highlights on the wrong page, or shows a member the staff
 * directory is a promise the router will not keep. These tests pin the three
 * rules the file declares — role-shaped destinations, permission-driven
 * visibility, and an active check that agrees with the guard.
 */

const always = (): boolean => true;
const never = (): boolean => false;

function itemNamed(items: readonly NavItem[], label: string): NavItem {
  const found = items.find((item) => item.label === label);
  if (!found) throw new Error(`No nav item labelled "${label}"`);
  return found;
}

describe('navItemsFor', () => {
  it('points the dashboard entry at each role’s own path', () => {
    expect(itemNamed(navItemsFor('ADMIN'), 'Dashboard').to).toBe(paths.adminDashboard);
    expect(itemNamed(navItemsFor('LIBRARIAN'), 'Dashboard').to).toBe(paths.librarianDashboard);
    expect(itemNamed(navItemsFor('MEMBER'), 'Dashboard').to).toBe(paths.memberDashboard);
    expect(itemNamed(navItemsFor(null), 'Dashboard').to).toBe(paths.memberDashboard);
  });

  it('declares the dashboard against the index path and only resolves it per session', () => {
    // `NAV_ITEMS` is the single source shared with `pageTitle` and the command
    // palette; rewriting it in place would mutate a module-level constant on
    // every render of the shell.
    expect(itemNamed(NAV_ITEMS, 'Dashboard').to).toBe(paths.dashboard);
  });

  it('leaves every other entry exactly as declared', () => {
    for (const role of ['ADMIN', 'LIBRARIAN', 'MEMBER'] as const) {
      const items = navItemsFor(role);
      expect(itemNamed(items, 'Books').to).toBe(paths.books);
      expect(itemNamed(items, 'Students').to).toBe(paths.members);
      expect(items).toHaveLength(NAV_ITEMS.length);
    }
  });
});

describe('navItemActive', () => {
  const dashboard = itemNamed(navItemsFor('ADMIN'), 'Dashboard');

  it('is active at the role dashboard and at the index alias', () => {
    // Both render the same page, so the sidebar must highlight at either —
    // a brand click to `/` that leaves the entry dark reads as a dead link.
    expect(navItemActive(dashboard, paths.adminDashboard)).toBe(true);
    expect(navItemActive(dashboard, paths.dashboard)).toBe(true);
  });

  it('is inactive on another role’s dashboard and on content pages', () => {
    expect(navItemActive(dashboard, paths.librarianDashboard)).toBe(false);
    expect(navItemActive(dashboard, paths.memberDashboard)).toBe(false);
    expect(navItemActive(dashboard, paths.books)).toBe(false);
  });

  it('keeps a prefix-matched entry current on its child routes', () => {
    const staff = itemNamed(navItemsFor('ADMIN'), 'Staff');
    expect(navItemActive(staff, paths.librarians)).toBe(true);
    expect(navItemActive(staff, paths.librarianNew)).toBe(true);
    // A near-miss must not match: `/librarians-archive` is not the directory.
    expect(navItemActive(staff, `${paths.librarians}-archive`)).toBe(false);
  });
});

describe('navItemVisible', () => {
  it('shows the staff directory only to a session holding USER_VIEW', () => {
    const staff = itemNamed(NAV_ITEMS, 'Staff');

    expect(navItemVisible(staff, () => true, 'ADMIN')).toBe(true);
    expect(navItemVisible(staff, (permission) => permission === 'USER_VIEW', 'ADMIN')).toBe(true);
    // A librarian holds MEMBER_VIEW but not USER_VIEW — the entry is absent
    // rather than present-and-403, which is the file's second rule.
    expect(navItemVisible(staff, (permission) => permission === 'MEMBER_VIEW', 'LIBRARIAN')).toBe(
      false,
    );
    expect(navItemVisible(staff, never, 'MEMBER')).toBe(false);
  });

  it('shows permissionless entries to everyone', () => {
    const dashboard = itemNamed(NAV_ITEMS, 'Dashboard');
    expect(navItemVisible(dashboard, never, 'MEMBER')).toBe(true);
  });
});

describe('navSections', () => {
  it('groups by section with no duplicated destinations', () => {
    const sections = navSections(navItemsFor('ADMIN'));
    const destinations = sections.flatMap((group) => group.items.map((item) => item.to));

    expect(new Set(destinations).size).toBe(destinations.length);
    expect(sections.map((group) => group.section)).toContain('People');
    expect(
      sections.find((group) => group.section === 'People')?.items.map((item) => item.label),
    ).toEqual(['Students', 'Student Types', 'Staff']);
  });
});

describe('bottomBarItems', () => {
  it('keeps a dashboard slot for a role-resolved destination', () => {
    // The bar prefers `paths.dashboard`, but the entry's `to` is the role's
    // path — a plain string comparison would drop the first slot on every role.
    const items = navItemsFor('ADMIN').filter((item) => navItemVisible(item, always, 'ADMIN'));
    const bar = bottomBarItems(items);

    expect(bar).toHaveLength(4);
    expect(bar[0]?.label).toBe('Dashboard');
    expect(bar.map((item) => item.label)).toEqual([
      'Dashboard',
      'Books',
      'Borrowing',
      'Notifications',
    ]);
  });
});

describe('pageTitle', () => {
  it('names every dashboard path "Dashboard"', () => {
    // All three explicit paths render the same page under different guards, so
    // the tab says what the screen is, not which route got you there.
    expect(pageTitle(paths.dashboard)).toBe('Dashboard');
    expect(pageTitle(paths.adminDashboard)).toBe('Dashboard');
    expect(pageTitle(paths.librarianDashboard)).toBe('Dashboard');
    expect(pageTitle(paths.memberDashboard)).toBe('Dashboard');
  });

  it('falls back to the nearest known ancestor on deep routes', () => {
    expect(pageTitle(paths.librarianNew)).toBe('Staff');
    expect(pageTitle('/members/abc-123')).toBe('Students');
    expect(pageTitle(paths.books)).toBe('Books');
  });
});
