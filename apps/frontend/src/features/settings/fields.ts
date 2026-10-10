import type { SettingsValueType } from './api';
import type { OrgSectionId } from './sections';

/**
 * Organization-wide policy fields, as a registry rather than as JSX.
 *
 * Every key below exists in `settings` and is seeded by the backend; the label
 * and description here replace the raw key (`org.fine_per_day`) and the column
 * comment with something a person at the desk can read. Keeping the whole set
 * in one array is what lets a section be rendered, validated and saved without
 * a hand-written form per page — and what makes "did we remember to validate
 * the currency?" a question about one function.
 *
 * Two rules:
 *   • The declared `kind` decides the CONTROL and the validation. The row's
 *     `valueType` decides the WIRE FORMAT. They are separate because
 *     `org.fine_per_day` is a number to a person and a decimal string to the
 *     database, and sending `50` where `"50.00"` is declared is a 422 that
 *     looks like a bug in the form.
 *   • Nothing is required that the seed does not define. A blank address is a
 *     library with no address; a blank currency is a broken amount.
 */

export type OrgFieldKind = 'text' | 'email' | 'tel' | 'currency' | 'integer' | 'money' | 'toggle';

export interface OrgFieldDef {
  key: string;
  label: string;
  description: string;
  section: OrgSectionId;
  kind: OrgFieldKind;
  required?: boolean;
  min?: number;
  max?: number;
  /** Placeholder for a field where the shape is not obvious. */
  placeholder?: string;
}

export const ORG_FIELDS: readonly OrgFieldDef[] = [
  /* ── Organization ───────────────────────────────────────────────────────── */
  {
    key: 'org.name',
    label: 'Library name',
    description: 'Shown on the sign-in screen, on receipts and in every report.',
    section: 'organization',
    kind: 'text',
    required: true,
  },
  {
    key: 'org.address',
    label: 'Address',
    description: 'The postal address printed on notices.',
    section: 'organization',
    kind: 'text',
  },
  {
    key: 'org.email',
    label: 'Contact email',
    description: 'Where replies to the library are sent.',
    section: 'organization',
    kind: 'email',
    required: true,
  },
  {
    key: 'org.phone',
    label: 'Contact phone',
    description: 'The number printed on notices and shown before sign-in.',
    section: 'organization',
    kind: 'tel',
  },
  {
    key: 'org.currency',
    label: 'Currency',
    description: 'ISO 4217 code for every amount in the system, such as KES or USD.',
    section: 'organization',
    kind: 'currency',
    required: true,
    placeholder: 'KES',
  },

  /* ── Circulation ────────────────────────────────────────────────────────── */
  {
    key: 'org.default_loan_days',
    label: 'Default loan period (days)',
    description: 'Used when the borrower’s member type sets no loan period of its own.',
    section: 'circulation',
    kind: 'integer',
    min: 1,
    max: 365,
  },
  {
    key: 'org.max_loans',
    label: 'Maximum loans per borrower',
    description: 'Library-wide ceiling on loans at one time, applied after the member-type limit.',
    section: 'circulation',
    kind: 'integer',
    min: 0,
    max: 100,
  },
  {
    key: 'org.renewal_limit',
    label: 'Renewal limit',
    description: 'How many times a loan may be renewed when no other rule applies.',
    section: 'circulation',
    kind: 'integer',
    min: 0,
    max: 20,
  },
  {
    key: 'org.allow_member_self_renew',
    label: 'Allow self-service renewal',
    description: 'Borrowers may renew their own loans instead of returning to the desk.',
    section: 'circulation',
    kind: 'toggle',
  },

  /* ── Fines & payments ───────────────────────────────────────────────────── */
  {
    key: 'org.fine_per_day',
    label: 'Daily fine rate',
    description: 'Charged for each overdue day when the member type has no rate of its own.',
    section: 'fines',
    kind: 'money',
    min: 0,
    placeholder: '50.00',
  },
  {
    key: 'org.grace_period_days',
    label: 'Grace period (days)',
    description: 'Days after the due date before fines start to accrue.',
    section: 'fines',
    kind: 'integer',
    min: 0,
    max: 60,
  },
  {
    key: 'org.block_borrowing_over',
    label: 'Borrowing block threshold',
    description: 'A borrower whose fines exceed this balance may not borrow until it is cleared.',
    section: 'fines',
    kind: 'money',
    min: 0,
    placeholder: '2000.00',
  },

  /* ── Reservations ───────────────────────────────────────────────────────── */
  {
    key: 'org.max_reservations',
    label: 'Maximum reservations per member',
    description: 'How many items a member may have reserved at once.',
    section: 'reservations',
    kind: 'integer',
    min: 0,
    max: 100,
  },
  {
    key: 'org.reservation_hold_days',
    label: 'Hold period (days)',
    description: 'How long a ready reservation waits on the shelf before it is released.',
    section: 'reservations',
    kind: 'integer',
    min: 1,
    max: 60,
  },

  /* ── Membership ─────────────────────────────────────────────────────────── */
  {
    key: 'org.membership_validity_days',
    label: 'Membership validity (days)',
    description: 'Default lifetime of a new membership when no other rule applies.',
    section: 'membership',
    kind: 'integer',
    min: 1,
    max: 3650,
  },

  /* ── Notifications ──────────────────────────────────────────────────────── */
  {
    key: 'org.notify_due_soon_days',
    label: 'Due-soon reminder (days ahead)',
    description: 'How many days before the due date the reminder is sent. 0 turns it off.',
    section: 'notifications',
    kind: 'integer',
    min: 0,
    max: 30,
  },

  /* ── Security & access ──────────────────────────────────────────────────── */
  {
    key: 'org.require_email_verification',
    label: 'Require email verification',
    description: 'New accounts must confirm their address before they can sign in.',
    section: 'security',
    kind: 'toggle',
  },
  {
    key: 'org.allow_audit_log_deletion',
    label: 'Allow audit log deletion',
    description:
      'Permits an administrator to purge the audit log from the Audit Log page. Every purge still requires the administrator’s password, and one row recording the purge always survives.',
    section: 'security',
    kind: 'toggle',
  },
];

export function orgFieldsFor(section: OrgSectionId): readonly OrgFieldDef[] {
  return ORG_FIELDS.filter((field) => field.section === section);
}

export function orgFieldFor(key: string): OrgFieldDef | undefined {
  return ORG_FIELDS.find((field) => field.key === key);
}

/** A stored value as the text a control shows. */
export function draftFromValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/**
 * ISO 4217 validity, checked against the platform rather than a regex.
 *
 * A three-letter pattern accepts `ZZZ`; `Intl.NumberFormat` only accepts codes
 * the runtime actually knows, which is the same list the money formatting in
 * the rest of the app will use to display this value.
 */
export function isCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
}

export type FieldResult = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * Parses one draft string against the field's rules and the row's type.
 *
 * The backend re-validates everything — this exists so a typo is corrected in
 * the field it belongs to, with a sentence about that field, instead of
 * arriving as one 422 for the whole section.
 */
export function parseOrgField(
  field: OrgFieldDef,
  draft: string,
  valueType: SettingsValueType,
): FieldResult {
  const text = draft.trim();

  const asWire = (value: unknown): FieldResult => {
    if (valueType === 'boolean') return { ok: true, value: value === true || value === 'true' };
    if (valueType === 'number') {
      const numeric = typeof value === 'number' ? value : Number(value);
      return { ok: true, value: numeric };
    }
    if (valueType === 'json') {
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch {
        return { ok: false, message: 'Not valid JSON' };
      }
    }
    return { ok: true, value: typeof value === 'string' ? value : String(value) };
  };

  switch (field.kind) {
    case 'toggle':
      return { ok: true, value: text === 'true' };

    case 'text': {
      if (field.required && text === '')
        return { ok: false, message: `${field.label} is required` };
      if (text.length > 255) return { ok: false, message: `${field.label} is too long` };
      return asWire(text);
    }

    case 'email':
      if (text === '') return { ok: false, message: `${field.label} is required` };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        return { ok: false, message: 'Enter a valid email address' };
      }
      return asWire(text.toLowerCase());

    case 'tel':
      if (text === '') return asWire('');
      if (!/^\+?[0-9][0-9\s().-]{4,24}$/.test(text)) {
        return { ok: false, message: 'Enter a valid phone number, digits only' };
      }
      return asWire(text);

    case 'currency': {
      const code = text.toUpperCase();
      if (code === '') return { ok: false, message: `${field.label} is required` };
      if (!isCurrencyCode(code)) {
        return { ok: false, message: 'Enter a three-letter ISO 4217 code, such as KES or USD' };
      }
      return asWire(code);
    }

    case 'integer': {
      if (!/^\d+$/.test(text)) return { ok: false, message: 'Enter a whole number' };
      const parsed = Number(text);
      if (field.min !== undefined && parsed < field.min) {
        return { ok: false, message: `Must be at least ${field.min}` };
      }
      if (field.max !== undefined && parsed > field.max) {
        return { ok: false, message: `Must be no more than ${field.max}` };
      }
      return asWire(parsed);
    }

    case 'money': {
      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        return { ok: false, message: 'Enter an amount such as 50.00' };
      }
      const amount = Number(text);
      if (field.min !== undefined && amount < field.min) {
        return { ok: false, message: `Must be at least ${field.min}` };
      }
      // The seed stores money as a decimal STRING (`'50.00'`), so the wire form
      // is two decimal places rather than the number a person typed.
      if (valueType === 'string') return { ok: true, value: amount.toFixed(2) };
      return asWire(amount);
    }

    default:
      return { ok: false, message: `${field.key} has an unsupported input type` };
  }
}
