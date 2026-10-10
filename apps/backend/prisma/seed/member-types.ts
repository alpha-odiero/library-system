/**
 * Member types — the borrowing-policy seed.
 *
 * These are the library's *business* policy. Unlike structural limits, every
 * value here is intended to be tuned by an administrator later via the
 * MEMBER_TYPE_MANAGE surface; the code reads them, never hardcodes them.
 */

export interface MemberTypeSeed {
  code: string;
  name: string;
  description: string;
  maxActiveLoans: number;
  loanDurationDays: number;
  maxRenewals: number;
  renewalDurationDays: number;
  gracePeriodDays: number;
  finePerDay: string;
  maxFineCap: string | null;
  reservationLimit: number;
  holdDurationDays: number;
  requiresApproval: boolean;
}

export const MEMBER_TYPE_SEEDS: readonly MemberTypeSeed[] = [
  {
    code: 'PUBLIC',
    name: 'Public',
    description: 'Walk-in public patrons with the most restrictive limits.',
    maxActiveLoans: 3,
    loanDurationDays: 7,
    maxRenewals: 0,
    renewalDurationDays: 7,
    gracePeriodDays: 0,
    finePerDay: '50.00',
    maxFineCap: '2000.00',
    reservationLimit: 2,
    holdDurationDays: 3,
    requiresApproval: false,
  },
  {
    code: 'CHILD',
    name: 'Child',
    description: 'Junior patrons. Guardian consent required at registration.',
    maxActiveLoans: 3,
    loanDurationDays: 14,
    maxRenewals: 1,
    renewalDurationDays: 14,
    gracePeriodDays: 0,
    finePerDay: '20.00',
    maxFineCap: '500.00',
    reservationLimit: 2,
    holdDurationDays: 3,
    requiresApproval: true,
  },
  {
    code: 'STUDENT',
    name: 'Student',
    description: 'Enrolled students. Extended loan period for term-time study.',
    maxActiveLoans: 5,
    loanDurationDays: 14,
    maxRenewals: 2,
    renewalDurationDays: 14,
    gracePeriodDays: 2,
    finePerDay: '30.00',
    maxFineCap: '1500.00',
    reservationLimit: 3,
    holdDurationDays: 4,
    requiresApproval: false,
  },
  {
    code: 'STAFF',
    name: 'Staff',
    description: 'Academic and administrative staff.',
    maxActiveLoans: 10,
    loanDurationDays: 30,
    maxRenewals: 3,
    renewalDurationDays: 30,
    gracePeriodDays: 7,
    finePerDay: '20.00',
    maxFineCap: '3000.00',
    reservationLimit: 5,
    holdDurationDays: 7,
    requiresApproval: false,
  },
  {
    code: 'RESEARCHER',
    name: 'Researcher',
    description: 'Visiting researchers with extended and renewable loans.',
    maxActiveLoans: 25,
    loanDurationDays: 90,
    maxRenewals: 4,
    renewalDurationDays: 90,
    gracePeriodDays: 14,
    finePerDay: '10.00',
    maxFineCap: '10000.00',
    reservationLimit: 10,
    holdDurationDays: 10,
    requiresApproval: true,
  },
  {
    code: 'VIP',
    name: 'VIP',
    description: 'Donors and honorary patrons.',
    maxActiveLoans: 15,
    loanDurationDays: 60,
    maxRenewals: 5,
    renewalDurationDays: 60,
    gracePeriodDays: 14,
    finePerDay: '10.00',
    maxFineCap: '5000.00',
    reservationLimit: 8,
    holdDurationDays: 10,
    requiresApproval: false,
  },
];

/**
 * System settings.
 *
 * Runtime configuration that an administrator can change without a deployment.
 * Anything structural (maximum page size, body size) is deliberately NOT here —
 * it belongs in config/constants.ts and cannot be loosened through the UI.
 */
export interface SettingSeed {
  key: string;
  value: string | number | boolean | Record<string, unknown>;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  category: string;
  description: string;
  isPublic?: boolean;
}

export const SETTING_SEEDS: readonly SettingSeed[] = [
  // ── Organisation (public: needed before login to render branding) ────────
  {
    key: 'org.name',
    value: 'Central Library',
    valueType: 'string',
    category: 'organisation',
    description: 'Display name of the library',
    isPublic: true,
  },
  {
    key: 'org.email',
    value: 'library@centrallibrary.org',
    valueType: 'string',
    category: 'organisation',
    description: 'Public contact email',
    isPublic: true,
  },
  {
    key: 'org.phone',
    value: '+254 20 222 4000',
    valueType: 'string',
    category: 'organisation',
    description: 'Public contact phone',
    isPublic: true,
  },
  {
    key: 'org.address',
    value: 'Library Road, Nairobi',
    valueType: 'string',
    category: 'organisation',
    description: 'Postal address',
  },
  {
    key: 'org.currency',
    value: 'KES',
    valueType: 'string',
    category: 'organisation',
    description: 'ISO 4217 currency code for all monetary values',
  },
  {
    key: 'org.default_loan_days',
    value: 14,
    valueType: 'number',
    category: 'organisation',
    description: 'Fallback loan duration when a member type does not define one',
  },
  {
    key: 'org.max_loans',
    value: 5,
    valueType: 'number',
    category: 'organisation',
    description: 'Library-wide ceiling on concurrent loans, applied after the member-type limit',
  },
  {
    key: 'org.fine_per_day',
    value: '50.00',
    valueType: 'string',
    category: 'fines',
    description: 'Daily fine per overdue day when the member type has no rate of its own',
  },
  {
    key: 'org.grace_period_days',
    value: 3,
    valueType: 'number',
    category: 'fines',
    description: 'Days after the due date before fines begin to accrue',
  },
  {
    key: 'org.reservation_hold_days',
    value: 3,
    valueType: 'number',
    category: 'organisation',
    description: 'Days a ready reservation is held on the shelf',
  },
  {
    key: 'org.max_reservations',
    value: 5,
    valueType: 'number',
    category: 'organisation',
    description: 'Library-wide ceiling on active reservations per member',
  },
  {
    key: 'org.renewal_limit',
    value: 2,
    valueType: 'number',
    category: 'organisation',
    description: 'Fallback renewal limit',
  },
  {
    key: 'org.block_borrowing_over',
    value: '2000.00',
    valueType: 'string',
    category: 'fines',
    description: 'Outstanding fine balance above which borrowing is blocked',
  },
  {
    key: 'org.membership_validity_days',
    value: 365,
    valueType: 'number',
    category: 'policy',
    description: 'Default membership validity period in days',
  },
  {
    key: 'org.require_email_verification',
    value: false,
    valueType: 'boolean',
    category: 'policy',
    description: 'Require members to verify their email before signing in',
  },
  {
    key: 'org.allow_member_self_renew',
    value: true,
    valueType: 'boolean',
    category: 'policy',
    description: 'Allow members to renew their own loans without staff intervention',
  },
  {
    key: 'org.notify_due_soon_days',
    value: 3,
    valueType: 'number',
    category: 'notifications',
    description: 'Days before the due date to send a due-soon reminder',
  },

  // ── Security & destructive actions ─────────────────────────────────────────
  {
    key: 'org.allow_audit_log_deletion',
    value: false,
    valueType: 'boolean',
    category: 'security',
    description:
      'Allow the audit log to be purged by an administrator. When OFF the purge endpoint refuses every request. The entry recording the purge itself is always preserved.',
  },
];
