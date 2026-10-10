import { z } from 'zod';
import { AuditAction } from '@prisma/client';
import { LIMITS } from '../../config/constants.js';

/**
 * Audit-log query filters.
 *
 * `AUDIT_VIEW` is the only gate on these routes, so the filters are free-text
 * where that is useful (entity/actor/description search) and enum-checked where
 * a mismatch would hit Prisma as a 500 instead of a validation error.
 */

/** The writable verb list, derived from the generated enum so it cannot drift. */
export const AUDIT_ACTIONS = Object.values(AuditAction) as [string, ...string[]];

export const auditLogQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    action: z.enum(AUDIT_ACTIONS).optional(),
    entityType: z.string().trim().min(1).max(50).optional(),
    actorEmail: z.string().trim().email('Enter a valid email address').max(255).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** Free-text over description, entity and request-id. */
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/**
 * The destructive purge body.
 *
 * `confirmationPassword` is the caller's own password, re-verified server-side
 * just before the purge—the same convention as a password change. The body only
 * constrains shape; the actual gates live in the route and the database
 * function because they are policy, not request parsing.
 */
export const auditPurgeBodySchema = z
  .object({
    confirmationPassword: z.string().trim().min(1).max(200).regex(/\S/, 'Enter your password'),
    /** Purge only entries at or before this instant (ISO 8601). Omit for all. */
    olderThan: z.coerce.date().optional(),
  })
  .strict();

export type AuditPurgeBody = z.infer<typeof auditPurgeBodySchema>;
