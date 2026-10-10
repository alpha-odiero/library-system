import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { invalidOperation } from '../../lib/errors.js';
import { sendOk } from '../../lib/response.js';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requireLibrary, requirePermission, requireRole } from '../../middleware/authorize.js';
import { validate, validated } from '../../middleware/validate.js';
import { actorFromPrincipal, recordAudit } from '../audit/audit.service.js';
import { settingsListQuerySchema, settingsUpdateSchema } from './settings.schemas.js';
import {
  getPublicSettings,
  getSettingRow,
  listSettings,
  updateSetting,
} from './settings.service.js';

/**
 * Settings routes.
 *
 * Two surfaces, one module:
 *
 *   • `GET /public` — the unauthenticated slice; only rows flagged `is_public`
 *     in the database are served (the filter is in the SQL, never a projection).
 *   • `GET /` and `PATCH /` — the administrative surface, mounted per-route
 *     behind `SETTINGS_VIEW` / `SETTINGS_UPDATE`. Every write is audit-logged
 *     with the before/after diff so a roaming fine-rate change is traceable to
 *     the administrator who made it.
 */

export const settingsRouter = Router();

settingsRouter.get(
  '/public',
  asyncHandler(async (_req, res) => {
    // Read before the login screen: branding, contact details, loan periods.
    sendOk(res, await getPublicSettings());
  }),
);

/* ── GET /settings — every setting, grouped by category (SETTINGS_VIEW) ──────── */

settingsRouter.get(
  '/',
  requireAuth(),
  requirePermission('SETTINGS_VIEW'),
  validate({ query: settingsListQuerySchema }),
  asyncHandler(async (req, res) => {
    const { category } = validated.query(req, settingsListQuerySchema);
    sendOk(res, { settings: await listSettings(category) });
  }),
);

/* ── PATCH /settings — update one or more settings (ADMIN, SETTINGS_UPDATE) ── */

settingsRouter.patch(
  '/',
  requireAuth(),
  requirePermission('SETTINGS_UPDATE'),
  // Organization-wide policy, gated on the role as well as the permission.
  // `SETTINGS_UPDATE` is granted only to ADMIN today, so this is redundant
  // until it is not: a permission grant that lands in the database for a
  // librarian would otherwise silently hand over the fine rate and the loan
  // period. The settings screen is the administrator's, not the desk's.
  requireRole('ADMIN'),
  requireLibrary(),
  validate({ body: settingsUpdateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { updates } = validated.body(req, settingsUpdateSchema);
    const context = {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };

    const keys = Object.keys(updates);

    // Validate every key before writing any of them, so a partial update cannot
    // apply a handful of the keys before hitting one that does not exist.
    for (const key of keys) {
      const existing = await getSettingRow(key);
      if (!existing) {
        throw invalidOperation('SETTINGS_INVALID', `Unknown setting: ${key}`);
      }
    }

    const applied: Array<Record<string, unknown>> = [];
    for (const key of keys) {
      const before = await getSettingRow(key);
      const updated = await updateSetting(key, updates[key], principal.userId);

      await recordAudit({
        action: 'SETTINGS_UPDATED',
        entityType: 'setting',
        entityId: key,
        description: `System setting ${key} updated`,
        before: before?.value,
        after: updated.value,
        actor: actorFromPrincipal(principal),
        context,
      });

      applied.push({
        key: updated.key,
        value: updated.value,
        valueType: updated.valueType,
        description: updated.description,
      });
    }

    sendOk(
      res,
      { settings: applied },
      { message: `${applied.length} setting${applied.length === 1 ? '' : 's'} updated` },
    );
  }),
);
