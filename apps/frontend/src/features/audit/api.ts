import type { Paginated } from '../../lib/api';
import { api } from '../../lib/api';

/**
 * Audit log — the append-only trail of who changed what.
 *
 * The backend writes every meaningful action into `audit_logs`, with the before/
 * after diff for edits and the actor's identity. These routes are the read side,
 * gated by `AUDIT_VIEW` / `AUDIT_EXPORT` — grants the LIBRARIAN role does not
 * hold, because the desk that operates the branch must not audit the desk.
 *
 * Every filter is optional. `q` is free-text over description, entity and
 * request-id; `action`, `entityType`, `actorEmail` and the date range are exact.
 */

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  description: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

/** The immutable verbs the backend can record. Kept in sync with the schema. */
export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'LOGOUT_ALL',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'EMAIL_VERIFIED',
  'BOOK_CREATED',
  'BOOK_UPDATED',
  'BOOK_ARCHIVED',
  'BOOK_DELETED',
  'AUTHOR_CREATED',
  'AUTHOR_UPDATED',
  'CATEGORY_CREATED',
  'CATEGORY_UPDATED',
  'PUBLISHER_CREATED',
  'PUBLISHER_UPDATED',
  'COPY_CREATED',
  'COPY_UPDATED',
  'COPY_MOVED',
  'COPY_REMOVED',
  'MEMBER_CREATED',
  'MEMBER_UPDATED',
  'MEMBER_DELETED',
  'MEMBER_TYPE_CREATED',
  'MEMBER_TYPE_UPDATED',
  'LOAN_CREATED',
  'BOOK_RETURNED',
  'BOOK_RENEWED',
  'LOAN_MARKED_LOST',
  'LOAN_MARKED_DAMAGED',
  'RESERVATION_CREATED',
  'RESERVATION_CANCELLED',
  'RESERVATION_READY',
  'RESERVATION_EXPIRED',
  'RESERVATION_FULFILLED',
  'BORROW_REQUEST_CREATED',
  'BORROW_REQUEST_APPROVED',
  'BORROW_REQUEST_REJECTED',
  'BORROW_REQUEST_CANCELLED',
  'BORROW_REQUEST_ISSUED',
  'FINE_CREATED',
  'FINE_UPDATED',
  'FINE_PAID',
  'FINE_WAIVED',
  'PAYMENT_VOIDED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'ROLE_CHANGED',
  'PERMISSION_CHANGED',
  'SETTINGS_UPDATED',
  'BRANCH_CREATED',
  'BRANCH_UPDATED',
  'LIBRARY_CREATED',
  'LIBRARY_UPDATED',
  'USER_CREDENTIALS_ISSUED',
  'USER_PASSWORD_RESET_BY_ADMIN',
  'DIGITAL_RESOURCE_CREATED',
  'DIGITAL_RESOURCE_DELETED',
  'DIGITAL_ACCESS',
  'REPORT_EXPORTED',
  'AUDIT_EXPORTED',
  'AUDIT_LOGS_DELETED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditFilters = {
  page?: number | undefined;
  limit?: number | undefined;
  action?: AuditAction | '' | undefined;
  entityType?: string | undefined;
  actorEmail?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
};

export function getAuditLogs(filters: AuditFilters, signal?: AbortSignal) {
  return api.get<AuditLogEntry[]>('/audit-logs', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<AuditLogEntry>>;
}

/**
 * Exports every matching row as CSV text.
 *
 * The server returns the CSV inside the standard envelope; the client turns it
 * into a Blob download so a signed-in page can capture the data without a raw
 * navigation (which would lose cookies/CSRF and could not be refreshed).
 */
export function exportAuditLogs(filters: AuditFilters, signal?: AbortSignal) {
  return api.get<{ csv: string }>('/audit-logs/export', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  });
}

export interface PurgeAuditLogsInput {
  /** The administrator's own password, re-verified by the server immediately before the purge. */
  confirmationPassword: string;
  /** Purge only entries recorded at or before this instant. Omit to purge everything. */
  olderThan?: string;
}

export interface PurgeAuditLogsResult {
  deleted: number;
  markerId: string;
}

/**
 * Purges audit entries (settings-gated, AUDIT_DELETE, ADMIN only).
 *
 * The server re-checks the `org.allow_audit_log_deletion` setting and re-verifies
 * the caller's password, then deletes through a SECURITY DEFINER function that
 * first appends an `AUDIT_LOGS_DELETED` marker row. That marker is the reason a
 * subsequent read never shows silence — a purge is itself an audit event.
 */
export function purgeAuditLogs(input: PurgeAuditLogsInput) {
  return api.post<PurgeAuditLogsResult>('/audit-logs/purge', input);
}
