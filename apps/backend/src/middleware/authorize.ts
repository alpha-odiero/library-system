import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PermissionCode } from '@lms/shared';
import { forbidden, unauthenticated } from '../lib/errors.js';
import { currentPrincipal } from './authenticate.js';
import { assertBranchScope, isBranchInScope } from './scope.js';
import { requireLibraryScope } from './library-scope.js';

/**
 * GATES 2, 3 and 4 — AUTHORIZATION.
 *
 * Four gates, applied in order, each answering exactly one question:
 *
 *   Gate 1  Who is this?                    → middleware/authenticate.ts
 *   Gate 2  May they perform this action?    → requirePermission (below)
 *   Gate 3  May they touch THIS branch?      → middleware/scope.ts
 *   Gate 4  Is THIS record theirs to see?    → ownership filters in the query
 *
 * They are separate because they fail differently and are fixed differently.
 * Collapsing them into one "authorize" helper is how systems end up with a 403
 * where a 404 was required (confirming a resource exists to someone who may not
 * know it does), or with a permission check standing in for a missing `WHERE`
 * clause and serving another member's loans.
 *
 * The dangerous failure mode this file exists to prevent: a route that has a
 * permission check but no ownership predicate. `MEMBER` holds
 * `LOAN_VIEW_OWN` — the OWN suffix is load-bearing, and the repository below is
 * what makes it real. See `ownership.ts`.
 */

/**
 * GATE 2 — requires a permission.
 *
 * `requirePermission('LOAN_CREATE')` and `requireAllPermissions('X', 'Y')` are
 * thin wrappers over one implementation so the semantics of OR/AND cannot drift
 * between call sites.
 */
export function requirePermission(...required: PermissionCode[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = currentPrincipal(req);
    const held = required.filter((code) => principal.permissions.has(code));

    // No permission held, none required → allow. This is the explicit
    // "authenticated is enough" form, and it is only reachable by naming it.
    if (required.length > 0 && held.length === 0) {
      next(forbidden('You do not have permission to perform this action', required[0]));
      return;
    }
    next();
  };
}

/** Requires every listed permission (AND). */
export function requireAllPermissions(...required: PermissionCode[]): RequestHandler {
  return (req, _res, next) => {
    const principal = currentPrincipal(req);
    const missing = required.filter((code) => !principal.permissions.has(code));

    if (missing.length > 0) {
      next(forbidden('You do not have permission to perform this action', missing[0]));
      return;
    }
    next();
  };
}

/**
 * Requires one of several roles.
 *
 * A coarse gate for the handful of places where "which kind of staff is this"
 * is the real question (the user-administration screen, for example). Prefer
 * permissions everywhere else: a role check hard-codes a code into a route, while
 * a permission check lets a grant be changed in the database.
 */
export function requireRole(...allowed: string[]): RequestHandler {
  return (req, _res, next) => {
    const principal = currentPrincipal(req);
    if (!allowed.includes(principal.roleCode)) {
      next(forbidden());
      return;
    }
    next();
  };
}

/**
 * LIBRARY-SCOPE GATE — rejects callers with no resolvable library.
 *
 * Mount this in front of any route that reads or writes tenant data. It is
 * middleware rather than a service call because the failure must happen before
 * the handler runs: a handler that forgets to check would otherwise already have
 * executed its query.
 *
 * Note it does NOT accept a library id from the client. Which library the caller
 * may touch is answered by the principal alone; a client-supplied value is only
 * ever checked against that scope (`assertRequestedLibraryAllowed`), never
 * believed.
 */
export function requireLibrary(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = currentPrincipal(req);
    try {
      requireLibraryScope(principal);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * GATE 3 — requires that the caller may act on a specific branch.
 *
 * Reads the branch from the validated request (`req.validated.params.id` for a
 * nested route, or an explicit header for cross-branch lists) and rejects with
 * 403 when it falls outside the principal's scope.
 *
 * A 403 is correct here and NOT a 404: the caller is allowed to know that
 * branches exist, so revealing that a branch id is outside their scope leaks
 * nothing. It is Gate 4 where existence must stay hidden.
 */
export function requireBranchScope(
  source: BranchScopeSource = BranchScopeSource.PARAM_ID,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = currentPrincipal(req);
    const branchId = resolveBranchId(req, source);

    // No branch in the request: nothing to check, and the query below will run
    // against the principal's whole scope anyway.
    if (!branchId) {
      next();
      return;
    }

    if (!isBranchInScope(principal, branchId)) {
      next(forbidden('You do not have access to this branch'));
      return;
    }
    next();
  };
}

/**
 * Where a route carries its branch id.
 *
 * Explicit rather than sniffed: inferring "the first uuid-looking thing in the
 * path" would silently start checking the wrong field the day a route gains a
 * second identifier.
 */
export enum BranchScopeSource {
  /** `req.validated.params.id` — routes like `/branches/:id/...`. */
  PARAM_ID,
  /** `req.validated.params.branchId`. */
  PARAM_BRANCH_ID,
  /** `req.validated.query.branchId` — list endpoints that filter by branch. */
  QUERY_BRANCH_ID,
}

function resolveBranchId(req: Request, source: BranchScopeSource): string | undefined {
  const params = (req.validated?.params ?? req.params) as Record<string, unknown> | undefined;
  const query = req.validated?.query as Record<string, unknown> | undefined;

  const candidate =
    source === BranchScopeSource.PARAM_ID
      ? params?.['id']
      : source === BranchScopeSource.PARAM_BRANCH_ID
        ? params?.['branchId']
        : query?.['branchId'];

  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

/**
 * Rejects requests from anonymous callers on routes that were declared public by
 * mistake.
 *
 * `PUBLIC_ROUTES` in `routes/v1/index.ts` is the allowlist of endpoints that
 * intentionally serve anonymous callers. This middleware is the runtime guard:
 * it does not consult that list, so a new route is protected unless it is
 * explicitly wrapped in `allowAnonymous`. That inverts the default — forgetting
 * to protect a route closes it, rather than exposing it.
 */
export function denyAnonymous(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    next();
  };
}

/**
 * Applies Gate 3 to a branch id a service resolved itself (e.g. the home branch
 * of the copy in a return). Shared with the service layer so a rule cannot be
 * enforced in middleware and forgotten in a query.
 */
export { assertBranchScope };
