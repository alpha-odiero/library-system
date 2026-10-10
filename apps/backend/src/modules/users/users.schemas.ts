import { z } from 'zod';
import { ROLE_CODES, uuidSchema } from '@lms/shared';
import { LIMITS, PASSWORD_POLICY } from '../../config/constants.js';

/**
 * Staff-account request schemas.
 *
 * `.strict()` throughout, for the mass-assignment reason documented in
 * `auth.schemas.ts` — a body carrying `roleId` or `roleCode` must FAIL, not be
 * silently dropped. Role is deliberately absent from every schema below: this
 * module provisions LIBRARIAN accounts, and the role row is resolved server-side
 * from that constant, so there is no shape in which a client can ask for ADMIN.
 *
 * `LOCKED` is absent from the status enum: it is set by the login lockout, and a
 * manual status change must not be able to forge (or clear) one silently. An
 * admin unlocks an account by setting it back to ACTIVE, which also requires
 * clearing the lockout — the service does both together.
 */

/** Path parameter: present so a malformed id is a 400 rather than a Prisma error. */
export const userIdParamSchema = z.object({ id: uuidSchema }).strict();

/** An optional free-text field with the three states (absent/null/value). */
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((value) => (value === null || value.length === 0 ? null : value))
    .optional();

/* ── List ───────────────────────────────────────────────────────────────────── */

export const userListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    roleCode: z.enum(ROLE_CODES).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'LOCKED']).optional(),
    /** Free-text over name, email and staff number. */
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/* ── Create / update ────────────────────────────────────────────────────────── */

export const userCreateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(255),
    phone: optionalText(32),
    /** Staff number issued by the library; unique within the library. */
    employeeId: optionalText(50),
    /** Primary desk for the account. Validated against the caller's library. */
    branchId: uuidSchema.optional(),
    profileImageUrl: optionalText(500),
    /**
     * Credential handed to the account holder out of band.
     *
     * Optional: omitted means the service generates one. Either way the account
     * is created with `mustChangePassword`, so the value in this field is a
     * first-sign-in bootstrap rather than a durable secret. Strength is checked
     * by `validatePasswordStrength` in the service, holding desk-set and
     * self-chosen passwords to one policy.
     */
    temporaryPassword: z.string().min(1).max(PASSWORD_POLICY.MAX_LENGTH).optional(),
  })
  .strict();

export const userUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    phone: optionalText(32),
    employeeId: optionalText(50),
    profileImageUrl: optionalText(500),
    branchId: uuidSchema.optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  })
  .strict()
  // A stray empty PATCH must not burn a write, an audit row and an `updatedAt`
  // bump that looks like a real change.
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type UserCreateBody = z.infer<typeof userCreateSchema>;
export type UserUpdateBody = z.infer<typeof userUpdateSchema>;
