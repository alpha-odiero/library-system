import { z } from 'zod';
import { LIMITS, PASSWORD_POLICY } from '../../config/constants.js';
import { uuidSchema } from '@lms/shared';

/**
 * Member and member-type request schemas.
 *
 * `.strict()` throughout, for the mass-assignment reason documented in
 * `auth.schemas.ts`: a silent strip makes a privileged field in a request body
 * look like it was considered and ignored, when in fact nobody decided.
 *
 * Dates arrive as `YYYY-MM-DD` rather than a full timestamp. A date of birth is a
 * calendar fact with no timezone and no time of day, and accepting an ISO
 * datetime here invites `1990-01-01T00:00:00Z`, which means a different birthday
 * for a member in Nairobi than for one in Lagos.
 */

/**
 * An optional free-text field with three distinct states.
 *
 * `undefined` — omitted, meaning "leave whatever is there".
 * `null`       — cleared.
 * `string`     — set.
 *
 * The three states are load-bearing. A service that writes every present key
 * would, on a PATCH of `{ firstName }`, see `address: null` if an omitted field
 * were normalised to null, and blank every column the client never mentioned.
 * That is silent data loss on the most ordinary request in the system.
 *
 * `.optional()` sits outermost so an absent key stays absent and Zod omits it
 * from the parsed output entirely; `z.null()` is accepted explicitly so a client
 * *can* clear a field rather than being stuck setting it to empty string.
 */
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((value) => (value === null || value.length === 0 ? null : value))
    .optional();

/** `YYYY-MM-DD`, validated as a real calendar date, not just a shape. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed)) return false;
    // Rejects 2025-02-30, which the regex above accepts.
    return new Date(parsed).toISOString().slice(0, 10) === value;
  }, 'Enter a real calendar date');

const memberStatus = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED', 'PENDING']);

/** Path parameter: present so a malformed id is a 400 rather than a Prisma error. */
export const memberIdParamSchema = z.object({ id: uuidSchema }).strict();

/* ── Filters ────────────────────────────────────────────────────────────────── */

export const memberListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    status: memberStatus.optional(),
    memberTypeId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
    /** Free-text over name and membership number. */
    q: z.string().trim().min(1).max(120).optional(),
    /** Include soft-deleted members. `MEMBER_VIEW_OTHERS` only. */
    includeDeleted: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict();

/* ── Create / update ────────────────────────────────────────────────────────── */

export const memberCreateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(255),
    phone: optionalText(32),
    memberTypeId: uuidSchema,
    /**
     * The member's home branch. Omitted for a single-branch library: the server
     * defaults to the caller's branch scope (or the library's active branch for an
     * all-branch administrator) instead of making the desk pick the only option.
     */
    homeBranchId: uuidSchema.optional(),
    /** Omitted means the desk allocates one. */
    membershipNumber: z.string().trim().min(1).max(30).optional(),
    dateOfBirth: calendarDate.optional(),
    gender: optionalText(20),
    address: optionalText(500),
    city: optionalText(100),
    occupation: optionalText(100),
    notes: optionalText(2000),
    /** Explicit expiry; otherwise derived from the org policy setting. */
    expiresAt: calendarDate.optional(),
    /**
     * Creates the login account alongside the member record.
     *
     * Optional because most members are registered at the desk and never sign in;
     * the service then generates an unusable credential and sets
     * `mustChangePassword`. When present, `password` is required — an account with
     * no credential would be unusable and would look valid.
     *
     * Shape only. Strength is enforced by `validatePasswordStrength` in the
     * service, so desk-set and self-chosen passwords are held to one policy.
     */
    createAccount: z.boolean().optional().default(false),
    password: z.string().min(1).max(PASSWORD_POLICY.MAX_LENGTH).optional(),
  })
  .strict()
  .refine((value) => !value.createAccount || Boolean(value.password), {
    message: 'A password is required when creating an account',
    path: ['password'],
  });

/**
 * Partial update.
 *
 * `.refine` requires at least one field so a stray empty PATCH does not burn a
 * write, an audit row, and an `updatedAt` bump that looks like a real change.
 */
export const memberUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(255).optional(),
    phone: optionalText(32),
    memberTypeId: uuidSchema.optional(),
    homeBranchId: uuidSchema.optional(),
    dateOfBirth: calendarDate.optional(),
    gender: optionalText(20),
    address: optionalText(500),
    city: optionalText(100),
    occupation: optionalText(100),
    notes: optionalText(2000),
    expiresAt: calendarDate.optional(),
    status: memberStatus.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

/* ── Member types ───────────────────────────────────────────────────────────── */

export const memberTypeListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    includeInactive: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict();

export const memberTypeIdParamSchema = z.object({ id: uuidSchema }).strict();

export const memberTypeCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Use letters, digits, and underscores only'),
    name: z.string().trim().min(1).max(100),
    maxActiveLoans: z.number().int().min(0).max(100).optional(),
    loanDurationDays: z.number().int().min(1).max(365).optional(),
    maxRenewals: z.number().int().min(0).max(50).optional(),
    renewalDurationDays: z.number().int().min(1).max(365).optional(),
    gracePeriodDays: z.number().int().min(0).max(60).optional(),
    /** Decimal string. Never a JS number: 0.1 + 0.2 is not 0.3. */
    finePerDay: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals'),
    /** Null means uncapped, which is a real policy choice and not an omission. */
    maxFineCap: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals')
      .nullable()
      .optional(),
    reservationLimit: z.number().int().min(0).max(100).optional(),
    holdDurationDays: z.number().int().min(1).max(90).optional(),
    requiresApproval: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const memberTypeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    maxActiveLoans: z.number().int().min(0).max(100).optional(),
    loanDurationDays: z.number().int().min(1).max(365).optional(),
    maxRenewals: z.number().int().min(0).max(50).optional(),
    renewalDurationDays: z.number().int().min(1).max(365).optional(),
    gracePeriodDays: z.number().int().min(0).max(60).optional(),
    finePerDay: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional(),
    maxFineCap: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .optional(),
    reservationLimit: z.number().int().min(0).max(100).optional(),
    holdDurationDays: z.number().int().min(1).max(90).optional(),
    requiresApproval: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  // `code` is absent by design: it appears in membership numbers and audit rows,
  // so changing it would silently orphan history written against the old value.
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });
