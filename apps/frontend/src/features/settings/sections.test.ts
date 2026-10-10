import { describe, expect, it } from 'vitest';
import {
  LIBRARY_PREFERENCES,
  ORG_SECTION_IDS,
  WORK_PREFERENCES,
  isOrgSection,
  notificationPreferencesFor,
  sectionsFor,
  type SettingsSectionId,
} from './sections';

/**
 * The settings registry.
 *
 * The page renders whatever this file declares, so the declaration IS the
 * permission check as far as the sidebar is concerned. These tests pin the two
 * rules the file promises: an administrator is the only session offered
 * organization policy, and no role is ever handed an empty or duplicated list.
 */

const ADMIN_ONLY_SECTIONS: readonly SettingsSectionId[] = [
  'organization',
  'circulation',
  'fines',
  'reservations',
  'membership',
];

function ids(role: Parameters<typeof sectionsFor>[0]): SettingsSectionId[] {
  return sectionsFor(role).map((section) => section.id);
}

describe('sectionsFor', () => {
  it('offers an administrator the organization policy sections', () => {
    const admin = ids('ADMIN');

    for (const id of ADMIN_ONLY_SECTIONS) expect(admin).toContain(id);
    // …alongside the sections every session shares, so their own account is
    // still one click away from the same page.
    expect(admin).toContain('account');
    expect(admin).toContain('appearance');
    expect(admin).toContain('notifications');
    expect(admin).toContain('security');
  });

  it('keeps organization policy off a librarian’s list', () => {
    const librarian = ids('LIBRARIAN');

    for (const id of ADMIN_ONLY_SECTIONS) expect(librarian).not.toContain(id);
    // The desk preferences exist for a librarian and for nobody else's section
    // list — a student has no circulation desk to arrange.
    expect(librarian).toContain('work');
    expect(librarian).toContain('account');
  });

  it('gives a student their own account and catalogue sections', () => {
    const member = ids('MEMBER');

    expect(member).toEqual(['account', 'library', 'notifications', 'security', 'appearance']);
    // A student sees neither the administrator's policy nor the librarian's
    // desk: both would be a promise the API cannot keep.
    for (const id of ADMIN_ONLY_SECTIONS) expect(member).not.toContain(id);
    expect(member).not.toContain('work');
  });

  it('falls back to the student list without a known role', () => {
    // Signed out, or a role code the product does not know — the sections that
    // need nothing but a caller's own account.
    expect(ids(undefined)).toEqual(ids('MEMBER'));
    expect(ids(null)).toEqual(ids('MEMBER'));
  });

  it('never returns an empty or duplicated list', () => {
    for (const role of ['ADMIN', 'LIBRARIAN', 'MEMBER'] as const) {
      const list = ids(role);
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('isOrgSection', () => {
  it('accepts exactly the administrator’s organization ids', () => {
    for (const id of ORG_SECTION_IDS) expect(isOrgSection(id)).toBe(true);

    // `notifications` and `security` are organization sections ONLY in the
    // administrator's list — the same id on a student's list renders a
    // personal card, so the guard must not be the thing deciding that.
    expect(isOrgSection('account')).toBe(false);
    expect(isOrgSection('work')).toBe(false);
    expect(isOrgSection('library')).toBe(false);
    expect(isOrgSection('appearance')).toBe(false);
  });
});

describe('notificationPreferencesFor', () => {
  it('adds system notices to a staff list and only there', () => {
    const idsFor = (role: Parameters<typeof notificationPreferencesFor>[0]): string[] =>
      notificationPreferencesFor(role).map((preference) => preference.id);

    expect(idsFor('ADMIN')).toContain('system');
    expect(idsFor('LIBRARIAN')).toContain('system');
    expect(idsFor('MEMBER')).not.toContain('system');
    expect(idsFor(undefined)).toEqual(idsFor('MEMBER'));
  });
});

describe('preference definitions', () => {
  it('offers page sizes the catalogue actually accepts', () => {
    // BookListPage reads `pageSize` back through a 10–100 range check; a
    // declared option outside it would silently fall back to the default.
    const pageSize = LIBRARY_PREFERENCES.find((preference) => preference.id === 'pageSize');
    expect(pageSize?.kind).toBe('select');

    for (const option of pageSize?.options ?? []) {
      expect(option.value).toBeGreaterThanOrEqual(10);
      expect(option.value).toBeLessThanOrEqual(100);
    }
    expect(pageSize?.options?.map((option) => option.value)).toContain(pageSize?.default);
  });

  it('declares only kinds the settings UI knows how to render', () => {
    const all = [...WORK_PREFERENCES, ...LIBRARY_PREFERENCES];
    for (const preference of all) expect(['toggle', 'select']).toContain(preference.kind);
  });
});
