import { Router } from 'express';
import type { PermissionCode } from '@lms/shared';
import { env, isProduction } from '../../config/env.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { authRouter } from '../../modules/auth/auth.routes.js';
import { branchesRouter } from '../../modules/branches/branches.routes.js';
import {
  authorsRouter,
  booksRouter,
  categoriesRouter,
  copiesRouter,
  publishersRouter,
  tagsRouter,
} from '../../modules/catalogue/catalogue.routes.js';
import { loansRouter, reservationsRouter } from '../../modules/circulation/circulation.routes.js';
import { finesRouter, paymentsRouter } from '../../modules/finance/finance.routes.js';
import { memberTypesRouter, membersRouter } from '../../modules/members/members.routes.js';
import { notificationsRouter } from '../../modules/notifications/notifications.routes.js';
import { realtimeRouter } from '../../modules/realtime/realtime.routes.js';
import { auditLogsRouter } from '../../modules/audit/audit.routes.js';
import { reportsRouter } from '../../modules/reports/reports.routes.js';
import { settingsRouter } from '../../modules/settings/settings.routes.js';
import { usersRouter } from '../../modules/users/users.routes.js';

/**
 * Route manifest.
 *
 * The full manifest lands as each module is delivered alongside `requireAuth`
 * and `requirePermission`. The router shape is fixed here so a module can be
 * mounted without reconsidering it:
 *
 *   router.use('/auth', authRouter);              // declares its own guards
 *   router.use('/users', requireAuth(), userRouter);
 *   router.get('/books', requirePermission('BOOK_VIEW'), listBooks);
 *
 * Two rules enforced by review and by `tests/security/route-manifest.test.ts`:
 *   1. Every route either declares its permissions here or sits behind a
 *      router-level `requireAuth()`. There is no third state.
 *   2. No route is mounted without a guard. An unguarded route fails the security
 *      test, which enumerates the Express router stack and asserts every
 *      `/api/v1` path is protected.
 *
 * `auth` is the one exception, and it is a deliberate one: it is where a request
 * IS allowed to be anonymous, so it declares guards per route instead of
 * inheriting one. Every subsequent module inherits `requireAuth()`.
 */

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  /** Absent means the route is public and must be listed in PUBLIC_ROUTES. */
  permissions?: readonly PermissionCode[];
}

export const v1Router = Router();

/** The only paths permitted to be reached without authentication. */
export const PUBLIC_ROUTES: readonly string[] = [
  'GET /api/v1/',
  'GET /api/v1/auth/csrf',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/reset-password',
  'POST /api/v1/auth/verify-email',
  'GET /api/v1/settings/public',
  // The development token-minting route only exists when it is mounted, so the
  // allowlist must not advertise it in an environment where it is absent.
  ...(!isProduction && env.REQUIRE_EMAIL_VERIFICATION
    ? ['POST /api/v1/auth/dev/verification-token']
    : []),
];

v1Router.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: 'Library Management System API',
      version: 'v1',
      status: 'auth module online — feature modules mount as they are delivered',
    },
  });
});

v1Router.use('/auth', authRouter);
v1Router.use('/settings', settingsRouter);
v1Router.use('/members', requireAuth(), membersRouter);
v1Router.use('/member-types', requireAuth(), memberTypesRouter);
v1Router.use('/users', requireAuth(), usersRouter);
// Read-only. Member registration requires a `homeBranchId` and nothing else may
// return a branch id, so without this the register form has no legal way to fill
// that field in. See `modules/branches/branches.service.ts` for why it is scoped.
v1Router.use('/branches', requireAuth(), branchesRouter);
v1Router.use('/authors', requireAuth(), authorsRouter);
v1Router.use('/publishers', requireAuth(), publishersRouter);
v1Router.use('/categories', requireAuth(), categoriesRouter);
v1Router.use('/tags', requireAuth(), tagsRouter);
v1Router.use('/books', requireAuth(), booksRouter);
v1Router.use('/copies', requireAuth(), copiesRouter);
v1Router.use('/loans', requireAuth(), loansRouter);
v1Router.use('/reservations', requireAuth(), reservationsRouter);
v1Router.use('/fines', requireAuth(), finesRouter);
v1Router.use('/payments', requireAuth(), paymentsRouter);
v1Router.use('/notifications', requireAuth(), notificationsRouter);
v1Router.use('/realtime', requireAuth(), realtimeRouter);
v1Router.use('/audit-logs', requireAuth(), auditLogsRouter);
v1Router.use('/reports', requireAuth(), reportsRouter);

// Modules are mounted here as they are delivered:
//   …

export { requireAuth };
