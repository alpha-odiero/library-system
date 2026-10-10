import type { AuditAction, AuditLog, Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { skipTake, type PaginationQuery } from '../../lib/pagination.js';

/**
 * Audit-log READING.
 *
 * `audit.service.ts` owns WRITING the log (it is the only writer). Reading is a
 * separate concern and kept in its own file so the write path stays focused on
 * the one guarantee that matters: append-only.
 *
 * The log is deliberately not branch-scoped. `audit_logs` carries no `branch_id`
 * column — an action like a settings change or a user provisioning has no
 * branch — and `AUDIT_VIEW` is an administrator-only grant, so the rows are
 * scoped by the permission rather than by geography.
 */

export interface AuditLogFilter {
  action?: string;
  entityType?: string;
  actorEmail?: string;
  from?: Date;
  to?: Date;
  q?: string;
}

export interface AuditLogEntryDto {
  id: string;
  actorId: string | null;
  actorEmail: string;
  actorRole: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  description: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  createdAt: string;
}

function buildWhere(input: AuditLogFilter): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (input.action) where.action = input.action as AuditAction;
  if (input.entityType) where.entityType = input.entityType;
  if (input.actorEmail) where.actorEmail = { contains: input.actorEmail, mode: 'insensitive' };
  if (input.from || input.to) {
    where.createdAt = {
      ...(input.from ? { gte: input.from } : {}),
      ...(input.to ? { lte: input.to } : {}),
    };
  }
  if (input.q) {
    where.OR = [
      { description: { contains: input.q, mode: 'insensitive' } },
      { entityType: { contains: input.q, mode: 'insensitive' } },
      { requestId: { contains: input.q } },
    ];
  }

  return where;
}

function toEntryDto(row: AuditLog): AuditLogEntryDto {
  return {
    // BigInt ids stringify as numbers in JSON; forcing the string prevents
    // precision loss for logs past 2^53 entries — unlikely, but a log reader is
    // no place for a silent overflow.
    id: row.id.toString(),
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    description: row.description,
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAuditLogs(
  input: AuditLogFilter,
  pagination: PaginationQuery,
): Promise<{ rows: AuditLogEntryDto[]; total: number }> {
  const where = buildWhere(input);
  const { skip, take } = skipTake(pagination);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows: rows.map(toEntryDto), total };
}

/** Every matching row, newest first. Used by the CSV export (`AUDIT_EXPORT`). */
export async function exportAuditLogs(input: AuditLogFilter): Promise<AuditLogEntryDto[]> {
  const rows = await prisma.auditLog.findMany({
    where: buildWhere(input),
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toEntryDto);
}

/**
 * Serialises a page of entries to CSV.
 *
 * Fields are quoted only when they contain a delimiter (`"`, `,` or a newline),
 * so a clean log stays human-readable and never bloats with stray quotes.
 * `before` / `after` are the redacted diffs the writer stored, serialised as
 * JSON so the column keeps one value per cell.
 */
export function auditLogToCsv(rows: readonly AuditLogEntryDto[]): string {
  const HEADER = [
    'id',
    'createdAt',
    'actorEmail',
    'actorRole',
    'action',
    'entityType',
    'entityId',
    'description',
    'ip',
    'requestId',
    'before',
    'after',
  ] as const;

  const lines = [HEADER.join(',')];

  for (const row of rows) {
    lines.push(
      HEADER.map((field) =>
        csvCell(field === 'before' || field === 'after' ? JSON.stringify(row[field]) : row[field]),
      ).join(','),
    );
  }

  return lines.join('\r\n');
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  // A value that is not primitive would otherwise stringify as "[object Object]";
  // the only object-shaped cells are the JSON diffs, passed in already serialised.
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
