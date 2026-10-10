import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { sendCreated, sendOk, sendPaginated } from '../../lib/response.js';
import { parsePagination } from '../../lib/pagination.js';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requireLibrary, requirePermission } from '../../middleware/authorize.js';
import { validate, validated } from '../../middleware/validate.js';
import * as users from './users.service.js';
import {
  userCreateSchema,
  userIdParamSchema,
  userListQuerySchema,
  userUpdateSchema,
} from './users.schemas.js';

/**
 * Staff-account routes.
 *
 * Mounted at `/api/v1/users` behind `requireAuth()` (see `routes/v1/index.ts`),
 * so every handler assumes a principal exists. Permission choices:
 *
 *   • `USER_VIEW` to read the directory. Held only by ADMIN — a librarian
 *     holding MEMBER_VIEW can already see the members they serve, but the staff
 *     directory is administrative data.
 *   • `USER_CREATE` to provision an account, plus `requireLibrary()`: the
 *     account is stamped with the caller's own `libraryId`, so a principal with
 *     no tenant has nothing to stamp.
 *   • `USER_UPDATE` to edit one. Role changes are not expressible here at all.
 */

export const usersRouter = Router();

/* ── GET /users ─────────────────────────────────────────────────────────────── */

usersRouter.get(
  '/',
  requireAuth(),
  requirePermission('USER_VIEW'),
  validate({ query: userListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, userListQuerySchema);

    const { users: rows, total } = await users.listUsers(principal, {
      roleCode: query.roleCode,
      status: query.status,
      q: query.q,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });

    sendPaginated(res, rows.map(users.toUserDto), {
      ...parsePagination(req.query as Record<string, unknown>),
      total,
    });
  }),
);

/* ── GET /users/:id ─────────────────────────────────────────────────────────── */

usersRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('USER_VIEW'),
  validate({ params: userIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, userIdParamSchema);

    sendOk(res, { user: users.toUserDto(await users.getUser(principal, id)) });
  }),
);

/* ── POST /users ────────────────────────────────────────────────────────────── */

/**
 * Provisions a staff account.
 *
 * The generated credential is returned ONCE, in this response, and never again —
 * there is no "resend password" for it, because the plaintext does not survive
 * the response. The administrator hands it over out of band; the account is
 * created with `mustChangePassword`, so the first sign-in replaces it.
 */
usersRouter.post(
  '/',
  requireAuth(),
  requirePermission('USER_CREATE'),
  requireLibrary(),
  validate({ body: userCreateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, userCreateSchema);

    const created = await users.createUser(principal, body, {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendCreated(
      res,
      {
        user: users.toUserDto(created.user),
        temporaryPassword: created.generatedPassword,
      },
      'Staff account created',
    );
  }),
);

/* ── PATCH /users/:id ───────────────────────────────────────────────────────── */

usersRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('USER_UPDATE'),
  requireLibrary(),
  validate({ params: userIdParamSchema, body: userUpdateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, userIdParamSchema);
    const body = validated.body(req, userUpdateSchema);

    const user = await users.updateUser(principal, id, body, {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendOk(res, { user: users.toUserDto(user) }, { message: 'Account updated' });
  }),
);
