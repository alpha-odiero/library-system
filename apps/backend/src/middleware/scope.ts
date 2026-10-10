import type { AuthPrincipal } from '@lms/shared';
import { forbidden } from '../lib/errors.js';

/**
 * GATE 3 — BRANCH SCOPE.
 *
 * "May this user act on data belonging to branch X?" is a different question from
 * "does this user have the LOAN_CREATE permission", and answering it with a
 * permission check is the classic multi-branch vulnerability: a librarian with
 * `LOAN_CREATE` who can post a loan against a copy at a branch they have never
 * been assigned to.
 *
 * The scope itself is `AuthPrincipal.branchScope`, computed in `principal.service`
 * as `null` for all-branch access (the `BRANCH_MANAGE_ALL` grant) or a list of
 * branch ids otherwise. This file only tests it.
 *
 * CRITICAL: a scope test is never sufficient on its own. It must be applied
 * INSIDE the Prisma query as a `where` predicate, because a check that loads the
 * row and then compares is still a check that happens after the row is read —
 * and a `findUnique` followed by a scope test leaks existence through timing and
 * error messages. `branchScopeFilter()` below produces the predicate to embed.
 */

/** True when the principal may act on `branchId`. */
export function isBranchInScope(
  principal: AuthPrincipal,
  branchId: string | null | undefined,
): boolean {
  // null scope = every branch.
  if (principal.branchScope === null) return true;
  if (!branchId) return false;
  return principal.branchScope.includes(branchId);
}

/**
 * Throws 403 when a branch is out of scope.
 *
 * For service-layer use, where the branch id is only known after resolving the
 * entity (the home branch of the copy being returned, say).
 */
export function assertBranchScope(
  principal: AuthPrincipal,
  branchId: string | null | undefined,
): void {
  if (!isBranchInScope(principal, branchId)) {
    throw forbidden('You do not have access to this branch');
  }
}

/**
 * The `where` fragment for a branch-scoped query.
 *
 * This is the function that actually enforces Gate 3. `null` means "no
 * restriction"; an array becomes `branchId: { in: [...] }`.
 *
 * Used as `where: { ...branchScopeFilter(principal, 'homeBranchId'), status }` —
 * spread, so it composes with the caller's own predicates instead of replacing
 * them. A helper that returned a whole `where` object would be easy to
 * accidentally overwrite, silently dropping the scope and opening every row.
 */
export function branchScopeFilter<K extends string>(
  principal: AuthPrincipal,
  field: K,
): Record<K, { in: string[] } | undefined> | Record<string, never> {
  if (principal.branchScope === null) return {};
  return { [field]: { in: [...principal.branchScope] } } as Record<K, { in: string[] } | undefined>;
}

/**
 * The same predicate for a relation path, e.g. `'copy.homeBranchId'`.
 *
 * Prisma accepts a dotted path in `where`, so a scope check on a copy reachable
 * through a loan works the same way.
 */
export function branchScopeFilterPath(
  principal: AuthPrincipal,
  path: string,
): Record<string, { in: string[] } | undefined> | Record<string, never> {
  if (principal.branchScope === null) return {};
  return { [path]: { in: [...principal.branchScope] } };
}

/**
 * Resolves the branch to operate on for a request, or throws.
 *
 * For create-style endpoints where the client may omit the branch: falls back to
 * the principal's home branch. If the caller has an EMPTY scope and no branch was
 * supplied, there is nothing valid to default to and the request is rejected —
 * guessing a branch would place data somewhere the user cannot see it.
 */
export function resolveEffectiveBranchId(
  principal: AuthPrincipal,
  requested: string | null | undefined,
): string {
  if (requested) {
    assertBranchScope(principal, requested);
    return requested;
  }

  if (principal.branchScope === null) {
    throw forbidden('A branch must be specified');
  }

  const [first] = principal.branchScope;
  if (!first) {
    throw forbidden('You are not assigned to a branch');
  }
  return first;
}

/**
 * Whether the principal may see records from every branch.
 * Convenience for list endpoints that branch their response shape on this.
 */
export function hasGlobalBranchScope(principal: AuthPrincipal): boolean {
  return principal.branchScope === null;
}

/** Branch ids in scope; empty array means "all", distinguished by scope === null. */
export function scopedBranchIds(principal: AuthPrincipal): readonly string[] | null {
  return principal.branchScope;
}

/**
 * Asserts a list endpoint's `branchId` filter is permitted.
 *
 * A caller must not be able to widen their view by filtering on a branch they
 * cannot access; without this, `?branchId=<other>` on a scoped list route either
 * returns another branch's data or errors inconsistently with the unscoped call.
 */
export function assertRequestedBranchAllowed(
  principal: AuthPrincipal,
  requested: string | null | undefined,
): void {
  if (!requested) return;
  assertBranchScope(principal, requested);
}
