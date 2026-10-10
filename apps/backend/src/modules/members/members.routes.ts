import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { sendCreated, sendNoContent, sendOk, sendPaginated } from '../../lib/response.js';
import { parsePagination } from '../../lib/pagination.js';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requireLibrary, requirePermission } from '../../middleware/authorize.js';
import { validate, validated } from '../../middleware/validate.js';
import * as members from './members.service.js';
import {
  memberCreateSchema,
  memberIdParamSchema,
  memberListQuerySchema,
  memberTypeCreateSchema,
  memberTypeIdParamSchema,
  memberTypeListQuerySchema,
  memberTypeUpdateSchema,
  memberUpdateSchema,
} from './members.schemas.js';

/**
 * Member routes.
 *
 * Mounted at `/api/v1/members` behind `requireAuth()`. Every handler therefore
 * assumes a principal exists; none of them re-check for one.
 *
 * Permission choices worth naming:
 *
 *   • `GET /` and `GET /:id` take `MEMBER_VIEW`, not `MEMBER_VIEW_OTHERS`. A member
 *     holding only `MEMBER_VIEW` passes the gate and then the ownership filter
 *     narrows the query to their own record. Gating on `VIEW_OTHERS` instead
 *     would make a member unable to see their own profile through this route.
 *   • `GET /me` is a separate path with no permission at all. Reading yourself
 *     requires only being signed in.
 */

export const membersRouter = Router();

/* ── Members ────────────────────────────────────────────────────────────────── */

/**
 * The caller's own member record.
 *
 * Declared before `/:id` because Express matches in registration order — the
 * literal path wins over the parameter, but only if it comes first. 404 when the
 * caller has no member record, which is the normal state for STAFF.
 */
membersRouter.get(
  '/me',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    if (!principal.memberId) {
      sendOk(res, { member: null });
      return;
    }

    const member = await members.getMember(principal, principal.memberId);
    sendOk(res, { member: members.toMemberDto(member) });
  }),
);

membersRouter.get(
  '/',
  requireAuth(),
  requirePermission('MEMBER_VIEW'),
  validate({ query: memberListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, memberListQuerySchema);

    const { members: rows, total } = await members.listMembers(principal, {
      status: query.status,
      memberTypeId: query.memberTypeId,
      branchId: query.branchId,
      q: query.q,
      includeDeleted: query.includeDeleted,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });

    sendPaginated(res, rows.map(members.toMemberDto), {
      ...parsePagination(req.query as Record<string, unknown>),
      total,
    });
  }),
);

membersRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('MEMBER_VIEW'),
  validate({ params: memberIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, memberIdParamSchema);

    sendOk(res, { member: members.toMemberDto(await members.getMember(principal, id)) });
  }),
);

membersRouter.post(
  '/',
  requireAuth(),
  requirePermission('MEMBER_CREATE'),
  // Creation is library-scoped: the new account's `libraryId` comes from the
  // principal, so a principal with no scope has nothing to attribute it to.
  requireLibrary(),
  validate({ body: memberCreateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, memberCreateSchema);

    const member = await members.createMember(principal, body, {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendCreated(res, { member: members.toMemberDto(member) });
  }),
);

membersRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('MEMBER_UPDATE'),
  validate({ params: memberIdParamSchema, body: memberUpdateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, memberIdParamSchema);
    const body = validated.body(req, memberUpdateSchema);

    const member = await members.updateMember(principal, id, body, {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendOk(res, { member: members.toMemberDto(member) }, { message: 'Member updated' });
  }),
);

/**
 * Archives a member.
 *
 * DELETE on the collection member returns 204 with no body, per the API
 * convention. The underlying operation is a soft delete, so a client that
 * re-fetches the record sees it gone from lists — but the row, its loans and its
 * fines remain for audit.
 */
membersRouter.delete(
  '/:id',
  requireAuth(),
  requirePermission('MEMBER_DELETE'),
  validate({ params: memberIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, memberIdParamSchema);

    await members.archiveMember(principal, id, {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendNoContent(res);
  }),
);

/* ── Member types ───────────────────────────────────────────────────────────── */

/**
 * Member types are library-wide policy rather than branch records, so this is
 * mounted at `/api/v1/member-types` and takes `MEMBER_TYPE_VIEW` — not the branch
 * scope that applies to member records themselves.
 */
export const memberTypesRouter = Router();

memberTypesRouter.get(
  '/',
  requireAuth(),
  requirePermission('MEMBER_TYPE_VIEW'),
  validate({ query: memberTypeListQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = validated.query(req, memberTypeListQuerySchema);
    const pagination = parsePagination(req.query as Record<string, unknown>);

    const { memberTypes, total } = await members.listMemberTypes({
      includeInactive: query.includeInactive,
      pagination,
      sort: query.sort,
      direction: query.direction,
    });

    sendPaginated(res, memberTypes.map(members.toMemberTypeDto), { ...pagination, total });
  }),
);

memberTypesRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('MEMBER_TYPE_VIEW'),
  validate({ params: memberTypeIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, memberTypeIdParamSchema);
    sendOk(res, { memberType: members.toMemberTypeDto(await members.getMemberType(id)) });
  }),
);

memberTypesRouter.post(
  '/',
  requireAuth(),
  requirePermission('MEMBER_TYPE_MANAGE'),
  validate({ body: memberTypeCreateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, memberTypeCreateSchema);

    const created = await members.createMemberType(principal, body, {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendCreated(res, { memberType: members.toMemberTypeDto(created) });
  }),
);

memberTypesRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('MEMBER_TYPE_MANAGE'),
  validate({ params: memberTypeIdParamSchema, body: memberTypeUpdateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, memberTypeIdParamSchema);
    const body = validated.body(req, memberTypeUpdateSchema);

    const updated = await members.updateMemberType(principal, id, body, {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendOk(
      res,
      { memberType: members.toMemberTypeDto(updated) },
      { message: 'Member type updated' },
    );
  }),
);

/**
 * Deactivation, not deletion.
 *
 * A member type is referenced by every member and loan row that used it; deleting
 * it would orphan history, and the schema's `onDelete: Restrict` would refuse
 * anyway. POST to a `/:id/deactivate` action states the intent plainly, where a
 * DELETE that does not delete would not.
 */
memberTypesRouter.post(
  '/:id/deactivate',
  requireAuth(),
  requirePermission('MEMBER_TYPE_MANAGE'),
  validate({ params: memberTypeIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, memberTypeIdParamSchema);

    await members.deactivateMemberType(principal, id, {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendNoContent(res);
  }),
);
