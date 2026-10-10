import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { sendOk, sendPaginated } from '../../lib/response.js';
import { parsePagination } from '../../lib/pagination.js';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate, validated } from '../../middleware/validate.js';
import * as branches from './branches.service.js';
import { branchIdParamSchema, branchListQuerySchema } from './branches.schemas.js';

/**
 * Branch routes.
 *
 * Mounted at `/api/v1/branches` behind `requireAuth()`. Read-only: there is no
 * POST, PATCH or DELETE, because no branch administration exists yet. The
 * reasoning is in `branches.service.ts`; the short version is that creating a
 * branch is how you mint a location outside every other librarian's scope, and
 * that belongs behind `BRANCH_MANAGE` in the admin module, not here.
 *
 * `BRANCH_VIEW` alone is not enough. The service composes Gate 3 (branch scope)
 * into every query, so the permission decides *whether* the list is readable and
 * the scope decides *which rows* it contains.
 */
export const branchesRouter = Router();

branchesRouter.get(
  '/',
  requireAuth(),
  requirePermission('BRANCH_VIEW'),
  validate({ query: branchListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, branchListQuerySchema);

    const { branches: rows, total } = await branches.listBranches(principal, {
      q: query.q,
      includeInactive: query.includeInactive,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });

    sendPaginated(res, rows.map(branches.toBranchDto), {
      ...parsePagination(req.query as Record<string, unknown>),
      total,
    });
  }),
);

branchesRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('BRANCH_VIEW'),
  validate({ params: branchIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, branchIdParamSchema);

    sendOk(res, { branch: branches.toBranchDto(await branches.getBranch(principal, id)) });
  }),
);
