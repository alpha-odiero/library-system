import { Prisma, type AuditAction } from '@prisma/client';
import type { Tx } from '../../config/database.js';
import { prisma } from '../../config/database.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../config/logger.js';
import { diffForAudit, redact } from '../../lib/redact.js';
import type { AuthPrincipal } from '@lms/shared';

/**
 * Audit logging.
 *
 * Append-only, and the ONLY writer of `audit_logs`. The table has a database
 * trigger (§C of the invariants migration) that raises on UPDATE or DELETE, plus
 * `REVOKE UPDATE, DELETE` from the application role (§E), so history cannot be
 * rewritten even by a service that tries.
 *
 * Two properties the schema depends on, and both are why the actor is passed in
 * rather than read from a global:
 *
 *   1. Actor fields are SNAPSHOTTED (`actorEmail`, `actorRole`). An audit row
 *      must stay readable after the account is deleted; `actorId` is `SET NULL`
 *      for exactly that reason.
 *   2. `before`/`after` are REDACTED diffs, not whole records. A snapshot that
 *      held a password hash would be a second copy of a credential in a table
 *      nobody thinks to protect.
 *
 * Writes take an optional `tx` so an audit entry and the change it describes
 * commit together. An audit row describing a rolled-back transaction is worse
 * than no row: it claims something happened that did not.
 */

/** Where the entry came from. Attached by `expressMiddleware`, read from `req`. */
export interface AuditContext {
  requestId?: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface RecordAuditInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  description: string;
  /** The change, for a diff. Omit for create events that have no prior state. */
  before?: unknown;
  after?: unknown;
  /** Restricts the diff to these fields. Omit to diff everything. */
  fields?: readonly string[];
  /** Who performed it. Omit only for genuinely anonymous actions (failed login). */
  actor?: AuditActor | null;
  context?: AuditContext;
  tx?: Tx;
}

export interface AuditActor {
  userId?: string | null;
  email: string;
  roleCode?: string | null;
}

/**
 * Builds the actor from the authenticated principal.
 *
 * Anonymous callers (a failed login, a password-reset request for an unknown
 * address) get no actor at all. Recording them under a synthetic user id would
 * be worse than recording nothing: the row would look attributable when it is not.
 */
export function actorFromPrincipal(principal: AuthPrincipal | undefined): AuditActor | null {
  if (!principal) return null;
  return {
    userId: principal.userId,
    email: principal.email,
    roleCode: principal.roleCode,
  };
}

/** Actor for a login attempt where the password never verified. */
export const ANONYMOUS_ACTOR = null;

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  const { action, entityType, entityId, description, before, after, fields, actor, context, tx } =
    input;

  const diff =
    before !== undefined || after !== undefined
      ? diffForAudit(before, after, fields ? { fields } : undefined)
      : { before: undefined, after: undefined };

  const payload: Omit<Prisma.AuditLogUncheckedCreateInput, 'actor'> = {
    actorId: actor?.userId ?? null,
    // Not null in the schema: an unauthenticated entry still records WHO WAS
    // ATTEMPTED, which is the useful part of a failed-login trail.
    actorEmail: actor?.email ?? 'anonymous',
    actorRole: actor?.roleCode ?? null,
    action,
    entityType,
    entityId: entityId ?? null,
    description: description.slice(0, 1000),
    before: diff.before ?? Prisma.JsonNull,
    after: diff.after ?? Prisma.JsonNull,
    ip: context?.ip ?? null,
    userAgent: context?.userAgent?.slice(0, 500) ?? null,
    requestId: context?.requestId ?? null,
  };

  try {
    await (tx ?? prisma).auditLog.create({ data: payload });
  } catch (error) {
    /**
     * An audit failure must never fail the business operation it describes.
     *
     * It is also never swallowed silently: a database that rejects writes to
     * `audit_logs` is a broken or full database, and the operator has to hear
     * about it. `logContext` carries the entity so the row can be reconstructed.
     */
    logger.error(
      {
        err: error,
        event: 'audit.write_failed',
        action,
        entityType,
        entityId,
      },
      'Failed to write audit log entry',
    );
  }
}

/**
 * Writes several entries for one operation.
 *
 * Used where a single transaction changes several entities and each change needs
 * its own row — a return that updates a loan, a copy, a fine and a reservation.
 */
export async function recordAuditBatch(inputs: readonly RecordAuditInput[]): Promise<void> {
  for (const input of inputs) {
    // Sequential, not `createMany`: each call needs its own try/catch so one
    // failure does not lose the others, and volumes here are single digits.
    await recordAudit(input);
  }
}

/* ── Purge ─────────────────────────────────────────────────────────────────── */

export interface PurgeAuditLogsInput {
  actor: AuditActor;
  context: AuditContext;
  /** Delete only rows at or before this instant. Omit to purge everything. */
  olderThan?: Date;
}

export interface PurgeAuditLogsResult {
  deleted: number;
  markerId: string;
}

/**
 * Purges audit-log rows through `prunes_audit_logs()`.
 *
 * This is the single privileged escape hatch from the append-only log, and it
 * is deliberately a migration-owned database function rather than a grant:
 *
 *   • `audit_logs` has REVOKEd UPDATE/DELETE from the application role and an
 *     immutability trigger (§C/§E), so `prisma.auditLog.deleteMany` can never
 *     work — Prisma lacks the privilege even when this code runs.
 *   • The SECURITY DEFINER function runs with the migration owner's privileges,
 *     inserts the AUDIT_LOGS_DELETED marker row first, then disables the
 *     trigger for exactly one DELETE inside the same transaction.
 *   • The route enforces the two gates this function deliberately does not know
 *     about — the `org.allow_audit_log_deletion` setting and a re-verification
 *     of the caller's password — because a function cannot be asked for a
 *     password, and the requirement that deletion stay OFF by default is policy
 *     living with the rest of the policy.
 *
 * The column casts are written explicitly so the typed parameters do not depend
 * on PostgreSQL's function-argument coercion rules.
 */
export async function purgeAuditLogs(input: PurgeAuditLogsInput): Promise<PurgeAuditLogsResult> {
  const rows = await prisma.$queryRaw<
    Array<{ deleted: bigint; marker_id: { toString: () => string } }>
  >`SELECT deleted, marker_id FROM public.prunes_audit_logs(
    ${input.actor.userId ?? null}::uuid,
    ${input.actor.email}::varchar,
    ${input.actor.roleCode ?? null}::varchar,
    ${input.context.ip ?? null}::varchar,
    ${input.context.userAgent ?? null}::text,
    ${input.context.requestId ?? null}::varchar,
    ${input.olderThan ?? null}::timestamptz
  )`;

  const row = rows[0];
  if (!row) {
    // The function always returns one row; failing loudly beats forging a
    // "purged 0 rows" success from a rollback that never reported.
    throw new AppError('INTERNAL_ERROR', 'Audit purge reported no result');
  }

  return {
    deleted: Number(row.deleted),
    markerId: String(row.marker_id),
  };
}

/** Redacted copy of an entity for embedding in a log line (never a response). */
export function forLog(value: unknown): unknown {
  return redact(value);
}
