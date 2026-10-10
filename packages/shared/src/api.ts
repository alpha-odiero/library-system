import { z } from 'zod';

/* ── API envelope ─────────────────────────────────────────────────────────── */

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  message?: string;
  meta?: PaginationMeta;
  requestId?: string;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

/* ── Primitives ───────────────────────────────────────────────────────────── */

export const uuidSchema = z.string().uuid();

/**
 * Money is transported as a DECIMAL STRING, never a JSON number.
 *
 * IEEE-754 doubles cannot represent 0.01 exactly; a `number` in JSON would
 * silently corrupt currency amounts on the client. Values are decimal strings
 * with at most 2 fraction digits (KES). Parsing happens once, explicitly, via
 * `lib/money.ts` on the server and a `Decimal` polyfill-free helper on the client.
 */
export const moneySchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Must be a decimal amount with at most 2 decimal places');

/** ISO-8601 instant, always UTC with offset (e.g. 2026-10-01T09:30:00.000Z). */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Calendar date with no timezone (e.g. 2026-10-01). Used for dates of record. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO calendar date (YYYY-MM-DD)');

/* ── Query parameter contracts ────────────────────────────────────────────── */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(1_000_000).default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().min(1).max(50).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function buildPaginationMeta(input: {
  page: number;
  limit: number;
  total: number;
}): PaginationMeta {
  const { page, limit, total } = input;
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

/* ── System status enums exposed to the client ────────────────────────────── */

export const userStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'LOCKED']);
export const memberStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED', 'PENDING']);
export const copyStatusSchema = z.enum([
  'AVAILABLE',
  'BORROWED',
  'RESERVED',
  'LOST',
  'DAMAGED',
  'MAINTENANCE',
  'REMOVED',
]);
export const loanStatusSchema = z.enum(['ACTIVE', 'RETURNED', 'OVERDUE', 'LOST', 'DAMAGED']);
export const reservationStatusSchema = z.enum([
  'ACTIVE',
  'READY',
  'FULFILLED',
  'CANCELLED',
  'EXPIRED',
]);
export const fineStatusSchema = z.enum(['OUTSTANDING', 'PARTIAL', 'PAID', 'WAIVED', 'VOID']);
export const paymentMethodSchema = z.enum(['CASH', 'MPESA', 'BANK', 'CARD', 'OTHER']);

export type UserStatusDto = z.infer<typeof userStatusSchema>;
export type MemberStatusDto = z.infer<typeof memberStatusSchema>;
export type CopyStatusDto = z.infer<typeof copyStatusSchema>;
export type LoanStatusDto = z.infer<typeof loanStatusSchema>;
export type ReservationStatusDto = z.infer<typeof reservationStatusSchema>;
export type FineStatusDto = z.infer<typeof fineStatusSchema>;
export type PaymentMethodDto = z.infer<typeof paymentMethodSchema>;

/* ── Authenticated principal (attached to the request by Gate 1) ──────────── */

/**
 * The server-built identity. The client NEVER supplies this; a body/query
 * field with any of these names is stripped or rejected by validation.
 */
export interface AuthPrincipal {
  userId: string;
  email: string;
  /**
   * Display name. Present so the interface can greet a user by name instead of by
   * email address — "Welcome back, Grace" rather than "Welcome back,
   * g.wanjiru@cbc.go.ke". Both are already in the row this query selects, so
   * carrying them costs nothing and saves every screen a second request.
   */
  firstName: string;
  lastName: string;
  /**
   * Contact number on file, or `null` when the account has none.
   *
   * Carried for the same reason as the name: the settings screen edits it, and
   * editing a value the client cannot first read means either a blind write or
   * a second endpoint that exists only to fetch one column.
   */
  phone: string | null;
  roleCode: string;
  sessionId: string;
  permissions: ReadonlySet<string>;
  /**
   * Branch scope. `null` = every branch, granted via the DATA permission
   * `BRANCH_MANAGE_ALL` — never inferred from the role code, so the grant stays
   * revocable.
   */
  branchScope: readonly string[] | null;
  /**
   * Library scope (Gate 2).
   *
   * `string` = every row in that library is reachable.
   *
   * `null` = NO library scope has been resolved, and library-scoped operations
   * MUST fail closed. It does NOT mean "all libraries" and MUST NOT be widened
   * to null-as-unrestricted anywhere in the codebase. A user with no resolvable
   * library — an unattributed account from before the library column existed, or
   * one seeded without a branch in a multi-library install — may authenticate and
   * may do non-scoped work, but may not read or write another tenant's data.
   *
   * The asymmetry with `branchScope` is deliberate. Branch scope has an explicit
   * grant that means "every branch"; library scope has no such grant, so the only
   * safe reading of "missing" is "none".
   */
  libraryScope: string | null;
  memberId: string | null;
  /** The user's home branch. Null for an account with none assigned. */
  primaryBranchName: string | null;
  /** The user's home library. Null when library scope could not be resolved. */
  libraryName: string | null;
}

export interface PublicUserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  status: string;
  roleCode: string;
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
}
