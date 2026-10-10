import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { sendOk } from '../../lib/response.js';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { circulationReport, financialReport, librarySummary } from './reports.service.js';

/**
 * Report routes, mounted at `/api/v1/reports` behind `requireAuth()`.
 *
 * Summary and circulation read at `REPORT_VIEW` (the librarian's grant).
 * Financial figures — revenue and outstanding balances — sit behind
 * `REPORT_VIEW_FINANCIAL`, which is administrator-only: a desk told the fine
 * schedule does not need the library's tax position.
 */

export const reportsRouter = Router();

/* ── GET /reports/summary ───────────────────────────────────────────────────── */

reportsRouter.get(
  '/summary',
  requireAuth(),
  requirePermission('REPORT_VIEW'),
  asyncHandler(async (req, res) => {
    sendOk(res, { report: await librarySummary(currentPrincipal(req)) });
  }),
);

/* ── GET /reports/circulation ───────────────────────────────────────────────── */

reportsRouter.get(
  '/circulation',
  requireAuth(),
  requirePermission('REPORT_VIEW'),
  asyncHandler(async (req, res) => {
    sendOk(res, { report: await circulationReport(currentPrincipal(req)) });
  }),
);

/* ── GET /reports/financial ─────────────────────────────────────────────────── */

reportsRouter.get(
  '/financial',
  requireAuth(),
  requirePermission('REPORT_VIEW_FINANCIAL'),
  asyncHandler(async (req, res) => {
    sendOk(res, { report: await financialReport(currentPrincipal(req)) });
  }),
);
