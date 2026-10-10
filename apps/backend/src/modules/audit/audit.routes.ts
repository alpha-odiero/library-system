import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { forbidden, unauthenticated } from '../../lib/errors.js';
import { parsePagination } from '../../lib/pagination.js';
import { sendOk, sendPaginated } from '../../lib/response.js';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { sensitiveRateLimit } from '../../middleware/rate-limit.js';
import { validate, validated } from '../../middleware/validate.js';
import { verifyPassword } from '../auth/password.service.js';
import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { getSetting, SETTING_KEYS } from '../settings/settings.service.js';
import { actorFromPrincipal, purgeAuditLogs, recordAudit } from './audit.service.js';
import { auditLogQuerySchema, auditPurgeBodySchema } from './audit.schemas.js';
import { auditLogToCsv, exportAuditLogs, listAuditLogs } from './audit-log.service.js';

/**
 * Audit-log routes, mounted at `/api/v1/audit-logs`.
 *
 * `audit.service.ts` is the ONLY writer — the database enforces that with a
 * trigger and `REVOKE UPDATE, DELETE`. These routes are the read side and the
 * two deliberately narrow exceptions: export (AUDIT_EXPORT) and the
 * settings-gated, password-confirmed purge (AUDIT_DELETE). All three are
 * administrator-only: `AUDIT_VIEW` / `AUDIT_EXPORT` / `AUDIT_DELETE` are not
 * granted to LIBRARIAN, which is what keeps the staff who operate a desk from
 * auditing the desk they operate.
 */

export const auditLogsRouter = Router();

/* ── GET / ──────────────────────────────────────────────────────────────────── */

auditLogsRouter.get(
  '/',
  requireAuth(),
  requirePermission('AUDIT_VIEW'),
  validate({ query: auditLogQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = validated.query(req, auditLogQuerySchema);
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const input = {
      action: query.action,
      entityType: query.entityType,
      actorEmail: query.actorEmail,
      from: query.from,
      to: query.to,
      q: query.q,
    };

    const { rows, total } = await listAuditLogs(input, pagination);
    sendPaginated(res, rows, { ...pagination, total });
  }),
);

/* ── GET /export (CSV) ──────────────────────────────────────────────────────── */

auditLogsRouter.get(
  '/export',
  requireAuth(),
  requirePermission('AUDIT_EXPORT'),
  validate({ query: auditLogQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, auditLogQuerySchema);
    const input = {
      action: query.action,
      entityType: query.entityType,
      actorEmail: query.actorEmail,
      from: query.from,
      to: query.to,
      q: query.q,
    };

    const rows = await exportAuditLogs(input);
    const csv = auditLogToCsv(rows);

    // Exporting the log is itself an event worth logging — the row that leaves
    // the system must show who took it out.
    await recordAudit({
      action: 'AUDIT_EXPORTED',
      entityType: 'audit-log',
      description: `Exported ${rows.length} audit log ${rows.length === 1 ? 'entry' : 'entries'}`,
      actor: actorFromPrincipal(principal),
      context: { requestId: req.requestId, ip: req.ip, userAgent: req.headers['user-agent'] },
    });

    // Delivered inside the standard envelope so the client triggers the
    // download from the JSON response (fetch cannot read a raw attachment when
    // called through the shared client). The client builds a Blob.
    sendOk(res, { csv });
  }),
);

/* ── POST /purge — settings-gated, password-confirmed destructive purge ─────── */

auditLogsRouter.post(
  '/purge',
  requireAuth(),
  requirePermission('AUDIT_DELETE'),
  sensitiveRateLimit,
  validate({ body: auditPurgeBodySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, auditPurgeBodySchema);
    const context = {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };

    // Gate 1 — the capability is a setting OFF by default, not a permanent
    // grant. When disabled the endpoint refuses *before* touching the password:
    // a disabled switch should not even prompt for credentials.
    const allowDeletion = await getSetting(
      SETTING_KEYS.ALLOW_AUDIT_LOG_DELETION,
      false,
    );
    if (!allowDeletion) {
      throw forbidden(
        'Audit log deletion is disabled. Enable it under Settings > Security to purge the audit log.',
        'org.allow_audit_log_deletion',
      );
    }

    // Gate 2 — prove the person is who their session claims, by re-checking
    // the password against the stored hash (mirrors the change-password flow).
    const user = await prisma.user.findUnique({
      where: { id: principal.userId },
      select: { passwordHash: true },
    });
    if (!user || !(await verifyPassword(user.passwordHash, body.confirmationPassword))) {
      throw unauthenticated(
        'Incorrect password. The audit log was not changed.',
        'INVALID_CREDENTIALS',
      );
    }

    // Gate 3 — the database function. It records the AUDIT_LOGS_DELETED marker
    // and removes everything else; if it fails, its transaction rolls back and
    // the marker never appears.
    const result = await purgeAuditLogs({
      actor: actorFromPrincipal(principal) ?? { userId: principal.userId, email: principal.email },
      context,
      olderThan: body.olderThan,
    });

    logger.info(
      { event: 'audit.purged', deleted: result.deleted, by: principal.userId },
      'Audit log purged',
    );

    sendOk(res, {
      deleted: result.deleted,
      markerId: result.markerId,
    }, {
      message:
        result.deleted === 0
          ? 'No audit log entries matched'
          : `Deleted ${result.deleted} audit log ${result.deleted === 1 ? 'entry' : 'entries'}. The row recording this deletion is preserved.`,
    });
  }),
);
