import type { RoleCode } from '@lms/shared';

/**
 * The settings navigation, by role.
 *
 * Three sessions open `/settings` and expect three different products: an
 * administrator tuning organization-wide policy, a librarian arranging their
 * own desk, and a student arranging their own account. The registry below is
 * what makes that a declaration rather than a chain of conditionals inside the
 * page — and it is the reason no role is ever shown a section it cannot use.
 *
 * Two rules the list obeys:
 *   • Nothing that requires a permission the role does not hold appears here.
 *     The administrator's organization sections are the only such content, and
 *     they are behind `SETTINGS_UPDATE` on the server as well as here.
 *   • No empty categories. Sections the product cannot actually serve (a
 *     privacy policy, a per-branch switchboard) are simply absent rather than
 *     present as a heading over an empty panel.
 */

export type SettingsSectionId =
  | 'account'
  | 'organization'
  | 'circulation'
  | 'fines'
  | 'reservations'
  | 'membership'
  | 'notifications'
  | 'security'
  | 'appearance'
  | 'work'
  | 'library';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
}

const ACCOUNT: SettingsSection = {
  id: 'account',
  label: 'Account',
  description: 'Your name and contact details as the library holds them.',
};

const ORGANIZATION: SettingsSection = {
  id: 'organization',
  label: 'Organization',
  description: 'Name, contact details and the currency every amount is shown in.',
};

const CIRCULATION: SettingsSection = {
  id: 'circulation',
  label: 'Circulation',
  description: 'Loan periods and limits, applied wherever a member type sets no limit of its own.',
};

const FINES: SettingsSection = {
  id: 'fines',
  label: 'Fines & Payments',
  description: 'Daily rates, the grace period, and the balance at which borrowing stops.',
};

const RESERVATIONS: SettingsSection = {
  id: 'reservations',
  label: 'Reservations',
  description: 'How many items a member may reserve, and how long a held item waits.',
};

const MEMBERSHIP: SettingsSection = {
  id: 'membership',
  label: 'Membership',
  description: 'How long a new membership stays valid when no other rule applies.',
};

const NOTIFICATIONS: SettingsSection = {
  id: 'notifications',
  label: 'Notifications',
  description: 'When the library reminds people that something is due, and what reaches you.',
};

const SECURITY: SettingsSection = {
  id: 'security',
  label: 'Security',
  description: 'Your password and the devices signed in to this account.',
};

const SECURITY_ADMIN: SettingsSection = {
  id: 'security',
  label: 'Security & Access',
  description: 'Sign-in policy for the whole library, and the security of your own account.',
};

const APPEARANCE: SettingsSection = {
  id: 'appearance',
  label: 'Appearance',
  description: 'Light, dark, or follow the setting your device is using.',
};

const WORK: SettingsSection = {
  id: 'work',
  label: 'Work Preferences',
  description: 'Confirmations and warnings at the circulation desk, for you alone.',
};

const LIBRARY: SettingsSection = {
  id: 'library',
  label: 'Library Preferences',
  description: 'How the catalogue is presented when you browse it.',
};

/** Sections that edit organization-wide policy — administrator only. */
export const ORG_SECTION_IDS = [
  'organization',
  'circulation',
  'fines',
  'reservations',
  'membership',
  'notifications',
  'security',
] as const satisfies readonly SettingsSectionId[];

export type OrgSectionId = (typeof ORG_SECTION_IDS)[number];

export function isOrgSection(id: SettingsSectionId): id is OrgSectionId {
  return (ORG_SECTION_IDS as readonly string[]).includes(id);
}

const ADMIN_SECTIONS: readonly SettingsSection[] = [
  ACCOUNT,
  ORGANIZATION,
  CIRCULATION,
  FINES,
  RESERVATIONS,
  MEMBERSHIP,
  NOTIFICATIONS,
  SECURITY_ADMIN,
  APPEARANCE,
];

const LIBRARIAN_SECTIONS: readonly SettingsSection[] = [
  ACCOUNT,
  WORK,
  NOTIFICATIONS,
  SECURITY,
  APPEARANCE,
];

const MEMBER_SECTIONS: readonly SettingsSection[] = [
  ACCOUNT,
  LIBRARY,
  NOTIFICATIONS,
  SECURITY,
  APPEARANCE,
];

/** The settings navigation for a session. Never empty: `account` is universal. */
export function sectionsFor(role: RoleCode | null | undefined): readonly SettingsSection[] {
  switch (role) {
    case 'ADMIN':
      return ADMIN_SECTIONS;
    case 'LIBRARIAN':
      return LIBRARIAN_SECTIONS;
    default:
      // Signed out, or a role the product does not know: the sections that need
      // nothing but the caller's own account.
      return MEMBER_SECTIONS;
  }
}

/* ── Personal preferences ──────────────────────────────────────────────────── */

/**
 * Preferences the server does not model.
 *
 * These belong to a person on a device, not to a tenant row, so they are stored
 * in the browser (see `lib/preferences.ts`) and every screen that shows them
 * says so. They are listed per role because a librarian's desk and a student's
 * account are different work.
 */
export type PreferenceKind = 'toggle' | 'select';

export interface PreferenceDef {
  id: string;
  label: string;
  description: string;
  kind: PreferenceKind;
  default: boolean | number;
  options?: readonly { value: number; label: string }[];
}

const NOTIFICATION_BASE: readonly PreferenceDef[] = [
  {
    id: 'dueSoon',
    label: 'Due soon reminders',
    description: 'A reminder while there is still time to renew or return.',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'overdue',
    label: 'Overdue notices',
    description: 'Told when something has passed its due date.',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'reservationReady',
    label: 'Reservation ready',
    description: 'When a reserved item is waiting on the shelf.',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'reservationExpiring',
    label: 'Reservations about to expire',
    description: 'Before a held item is returned to the shelf for someone else.',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'reservationCancelled',
    label: 'Reservations cancelled',
    description: 'When the library releases a reservation on your behalf.',
    kind: 'toggle',
    default: false,
  },
  {
    id: 'fines',
    label: 'Fine and payment notices',
    description: 'New charges, receipts, and payments recorded against your account.',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'announcements',
    label: 'Library announcements',
    description: 'Opening hours, closures and other notices from the library.',
    kind: 'toggle',
    default: true,
  },
];

const STAFF_NOTIFICATIONS: readonly PreferenceDef[] = [
  {
    id: 'system',
    label: 'System notices',
    description: 'Changes to the library configuration you administer.',
    kind: 'toggle',
    default: false,
  },
];

export function notificationPreferencesFor(
  role: RoleCode | null | undefined,
): readonly PreferenceDef[] {
  return role === 'ADMIN' || role === 'LIBRARIAN'
    ? [...NOTIFICATION_BASE, ...STAFF_NOTIFICATIONS]
    : NOTIFICATION_BASE;
}

export const WORK_PREFERENCES: readonly PreferenceDef[] = [
  {
    id: 'confirmIssue',
    label: 'Confirm before issuing',
    description: 'Ask for a second click before an issue is recorded.',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'confirmReturn',
    label: 'Confirm before returning',
    description: 'Ask for a second click before a return is recorded.',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'overdueWarnings',
    label: 'Show overdue warnings',
    description: 'Flag an overdue item while the borrower is at the desk.',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'reservationAlerts',
    label: 'Show reservation alerts',
    description: 'Surface a pending reservation when a copy comes back.',
    kind: 'toggle',
    default: true,
  },
];

export const LIBRARY_PREFERENCES: readonly PreferenceDef[] = [
  {
    id: 'pageSize',
    label: 'Results per page',
    description: 'How many rows the catalogue shows before it paginates.',
    kind: 'select',
    default: 20,
    options: [
      { value: 10, label: '10' },
      { value: 20, label: '20' },
      { value: 50, label: '50' },
    ],
  },
  {
    id: 'availableOnly',
    label: 'Only show what I can borrow',
    description: 'Start the catalogue filtered to copies that are on the shelf.',
    kind: 'toggle',
    default: false,
  },
];
