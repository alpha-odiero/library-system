import type { AuthPrincipal } from '@lms/shared';
import { forbidden } from '../lib/errors.js';

/**
 * GATE 2 (tenant layer) — LIBRARY SCOPE.
 *
 * "May this user act on data belonging to library X?" sits ABOVE branch scope and
 * answers a strictly broader question. A user authorised at every branch of one
 * library still must not reach another library, and branch ids cannot express that
 * boundary at all: branch scope is a flat list, while library scope is a partition
 * of those branches into tenants.
 *
 * ── THE RULE THAT MATTERS ────────────────────────────────────────────────────
 *
 * `principal.libraryScope === null` means **NO LIBRARY SCOPE**, and every
 * library-scoped operation must be REFUSED. It does not mean "all libraries".
 *
 * This is deliberately different from `branchScope === null`, which genuinely does
 * mean "all branches" because an explicit data permission grants it. There is no
 * such permission for libraries, so the only safe reading of an unresolved scope
 * is "none". Conflating the two — the natural shortcut, since both fields are
 * nullable — is the single most dangerous mistake available in this codebase: it
 * turns an unattributed account into a cross-tenant superuser.
 *
 * A null scope is reachable in practice, not just theoretically: accounts that
 * predate the `users.library_id` column, and users seeded with no branch in an
 * install that has more than one library. Both are exactly the accounts a tenant
 * separation is supposed to contain.
 *
 * ── WHY QUERIES, NOT CHECKS ─────────────────────────────────────────────────
 *
 * As with branch scope, the predicate below must be spread INTO the Prisma
 * `where`. A helper that fetched the row and compared afterwards has already read
 * another tenant's data, and reports its existence through its error.
 */

export class MissingLibraryScopeError extends Error {
  constructor() {
    super('This account has no library scope and cannot perform library-scoped operations');
    this.name = 'MissingLibraryScopeError';
  }
}

/**
 * The principal's library scope, or throws 403.
 *
 * Use this at the top of every library-scoped service method. It converts the
 * fail-closed rule into a single call site, so a new feature cannot forget it.
 */
export function requireLibraryScope(principal: AuthPrincipal): string {
  if (!principal.libraryScope) {
    throw forbidden(
      'This account is not assigned to a library and cannot perform library-scoped operations',
    );
  }
  return principal.libraryScope;
}

/** Non-throwing form, for branching on whether isolation is enforceable. */
export function libraryScopeOrNull(principal: AuthPrincipal): string | null {
  return principal.libraryScope ?? null;
}

/** True when the principal has a resolvable library scope. */
export function hasLibraryScope(principal: AuthPrincipal): boolean {
  return principal.libraryScope !== null;
}

/**
 * The `where` fragment that confines a query to the principal's library.
 *
 * This is the function that actually enforces the boundary, and it fails closed:
 * with no library scope it returns an always-false predicate rather than `{}`.
 *
 * `{}` would mean "no restriction" to Prisma and select the whole table. The
 * impossible id means the query returns nothing, which is the honest answer for a
 * user who has no library.
 */
export function libraryScopeFilter<K extends string>(
  principal: AuthPrincipal,
  field: K,
): Record<K, string> | Record<string, never> {
  if (!principal.libraryScope) {
    // A null scope must not widen to "everything". Matching a literal that no
    // uuid can equal is the only way to express "none" in a positive filter, and
    // it stays correct if the column is later made NOT NULL.
    return { [field]: '00000000-0000-0000-0000-000000000000' } as Record<K, string>;
  }
  return { [field]: principal.libraryScope } as Record<K, string>;
}

/**
 * The same predicate for a relation path, e.g. `'copy.branch.libraryId'`.
 *
 * Prisma accepts dotted paths in `where`, so this confines a query whose entity
 * reaches its library indirectly.
 */
export function libraryScopeFilterPath(
  principal: AuthPrincipal,
  path: string,
): Record<string, string> | Record<string, never> {
  if (!principal.libraryScope) {
    return { [path]: '00000000-0000-0000-0000-000000000000' };
  }
  return { [path]: principal.libraryScope };
}

/**
 * Guards a record whose library was resolved by a lookup.
 *
 * For services that load an entity and then act on it (approving a request,
 * issuing a copy) rather than filtering a list. Pairs with the query predicate:
 * the filter decides what is visible, this decides what may be changed.
 */
export function assertLibraryScope(
  principal: AuthPrincipal,
  libraryId: string | null | undefined,
): void {
  // No scope resolved → fail closed, regardless of the record's library.
  if (!principal.libraryScope) {
    throw forbidden(
      'This account is not assigned to a library and cannot perform library-scoped operations',
    );
  }
  if (!libraryId || libraryId !== principal.libraryScope) {
    throw forbidden('You do not have access to this library');
  }
}

/**
 * Rejects a client-supplied `libraryId` that disagrees with the principal's scope.
 *
 * Borrowing requests and library settings both accept a library in the body.
 * Trusting it would let a student file a request against a rival's library — the
 * staff there could read it, and the isolation rules it would bypass. The
 * authoritative value always comes from the principal.
 */
export function assertRequestedLibraryAllowed(
  principal: AuthPrincipal,
  requested: string | null | undefined,
): void {
  if (!requested) return;
  assertLibraryScope(principal, requested);
}

/**
 * Whether every branch in `branchIds` belongs to the principal's library.
 *
 * Cross-library guard for creation paths that take a branch rather than a
 * library. A branch id alone cannot reveal its library to the caller, so this is
 * resolved server-side from the branch row rather than trusted from the client.
 */
export function assertBranchesInLibrary(
  principal: AuthPrincipal,
  branchIds: readonly (string | null | undefined)[],
  ownsBranch: (branchId: string) => Promise<string | null>,
): Promise<void> {
  const libraryId = requireLibraryScope(principal);
  return Promise.all(
    branchIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map(async (branchId) => {
        const owner = await ownsBranch(branchId);
        if (owner !== libraryId) {
          throw forbidden('The selected branch belongs to another library');
        }
      }),
  ).then(() => undefined);
}
