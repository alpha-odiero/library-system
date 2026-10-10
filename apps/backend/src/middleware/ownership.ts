import type { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '@lms/shared';
import { forbidden, notFound } from '../lib/errors.js';

/**
 * GATE 4 — RESOURCE OWNERSHIP.
 *
 * The permission `LOAN_VIEW_OWN` is a claim about capability; THIS file is what
 * makes it true. Every `*_OWN` route composes one of these predicates into its
 * query, and the distinction matters:
 *
 *   • Gate 2 answered "may a member call this endpoint at all?"
 *   • Gate 4 answers "may a member see THIS row?"
 *
 * Without Gate 4, `MEMBER` holds `LOAN_VIEW_OWN` and hits
 * `GET /api/v1/loans/:id` with another member's loan id — and gets it. The
 * permission name would be a lie.
 *
 * THE RULE: ownership is a `where` predicate, never a post-fetch comparison.
 *
 * A handler that loads a row and then checks ownership has already read the row,
 * already made it available to the application, and must then get the *error
 * right*: 404 rather than 403, because a 403 confirms the row exists, turning
 * the endpoint into an oracle for enumerating ids. `assertOwned` throws 404 for
 * exactly this reason and exists only for the paths where the row must be loaded
 * first (a relation that must be traversed to find the owner).
 */

/**
 * An impossible UUID, used where an ownership predicate must match nothing.
 *
 * `memberId` and `userId` are non-nullable `String @db.Uuid` columns, so no row
 * can ever carry this value. A string sentinel was used previously, and it was
 * the wrong tool: it relies on the column being non-empty rather than on its
 * type, so a future schema change could make it match something real. An
 * invalid-UUID-shaped constant fails loudly instead.
 */
export const NO_MEMBER_PROFILE = '00000000-0000-0000-0000-000000000000';

/**
 * The predicate for a resource owned by the caller's member record.
 *
 * Returns an always-false predicate when the caller has no member profile — a
 * staff user with no member record owns nothing, and the alternative (an empty
 * `OR`, which Prisma reads as "no constraint") would return EVERY row.
 *
 * This is the single most dangerous shape in the file, so it is stated plainly:
 * never return `{}` from an ownership filter.
 */
export function ownMemberFilter(
  principal: AuthPrincipal,
  field = 'memberId',
): Record<string, unknown> {
  if (!principal.memberId) {
    return { [field]: NO_MEMBER_PROFILE } as Record<string, unknown>;
  }
  return { [field]: principal.memberId } as Record<string, unknown>;
}

/** As `ownMemberFilter`, for a relation path (`'loan.memberId'`). */
export function ownMemberFilterPath(
  principal: AuthPrincipal,
  path: string,
): Record<string, unknown> {
  return ownMemberFilter(principal, path);
}

/**
 * Ownership for a resource keyed by user id rather than member id.
 *
 * Notifications and sessions hang off `users`, so their `*_OWN` variants filter
 * on the user, not the member.
 */
export function ownUserFilter(principal: AuthPrincipal, field = 'userId'): Record<string, unknown> {
  return { [field]: principal.userId } as Record<string, unknown>;
}

/**
 * The predicate for "my own, or anything a staff permission covers".
 *
 * The pattern behind every `*_OWN` vs non-OWN permission pair in the registry:
 * a caller with the staff permission sees the branch-scoped world; a member sees
 * their own rows only. Encoding both in one `OR` keeps that decision in a single
 * reviewable place instead of spread across every handler.
 */
export function ownOrStaffFilter(
  principal: AuthPrincipal,
  staffPermission: string,
  ownerField = 'memberId',
): Record<string, unknown> {
  if (principal.permissions.has(staffPermission)) {
    // Staff see everything; Gate 3 still constrains which branches.
    return {};
  }
  return ownMemberFilter(principal, ownerField);
}

/** As `ownOrStaffFilter`, keyed by user id. */
export function ownUserOrStaffFilter(
  principal: AuthPrincipal,
  staffPermission: string,
  ownerField = 'userId',
): Record<string, unknown> {
  if (principal.permissions.has(staffPermission)) return {};
  return ownUserFilter(principal, ownerField);
}

/**
 * Throws 404 when a loaded record is not the caller's.
 *
 * ONLY for rows already fetched — and the 404 is deliberate. See the file header.
 *
 * The failure is 404 unconditionally, for every caller. An earlier version
 * returned 403 to anyone holding a broad permission such as `MEMBER_VIEW`, on the
 * theory that staff are "allowed to know" the record exists. That was wrong in
 * practice: `assertOwned` is reached on `*_OWN` routes, where a staff caller
 * arriving here has already failed a filter that was supposed to widen their
 * result set. Answering 403 in that situation both leaks existence and points
 * staff at the wrong problem.
 *
 * A caller who legitimately holds a broader permission should use
 * `assertCanModifyOwn`, which returns before this check, or widen the query with
 * `ownOrStaffFilter` so the row is legitimately in scope.
 *
 * Prefer the predicate above this function. It exists for the case where the
 * owner is only reachable through a relation that must be traversed first.
 */
export function assertOwned(
  resource: { memberId?: string | null; userId?: string | null },
  principal: AuthPrincipal,
  resourceName = 'Resource',
): void {
  const isMemberOwner =
    resource.memberId !== undefined &&
    resource.memberId !== null &&
    principal.memberId !== null &&
    resource.memberId === principal.memberId;

  const isUserOwner =
    resource.userId !== undefined &&
    resource.userId !== null &&
    resource.userId === principal.userId;

  if (isMemberOwner || isUserOwner) return;

  throw notFound(resourceName);
}

/**
 * Restricts a mutation to the caller's own record.
 *
 * Returns 404 rather than 403 for a member, for the same reason as above: a
 * self-service route that answers 403 for someone else's id is an enumeration
 * oracle for member ids.
 */
export function assertCanModifyOwn(
  resource: { memberId?: string | null; userId?: string | null },
  principal: AuthPrincipal,
  staffPermission: string,
  resourceName = 'Resource',
): void {
  if (principal.permissions.has(staffPermission)) return;
  assertOwned(resource, principal, resourceName);
}

/**
 * Members may only ever act on their own account.
 *
 * A guard against a whole class of mistake in self-service routes: reading the
 * target id from the URL instead of the principal. A member who can reach
 * `/api/v1/members/:id/renew` with any id must be stopped here, before the
 * handler, because no per-handler discipline is reliable enough to prevent it.
 */
export function assertSelfOrPermission(
  principal: AuthPrincipal,
  targetMemberId: string,
  staffPermission: string,
  resourceName = 'Resource',
): void {
  if (principal.permissions.has(staffPermission)) return;
  if (principal.memberId && principal.memberId === targetMemberId) return;
  throw notFound(resourceName);
}

/**
 * Requires the caller to have a member profile.
 *
 * Staff-only actions that are meaningless for a member (placing a hold on
 * someone's behalf, waiving a fine) should fail loudly rather than operate on a
 * null member id.
 */
export function assertHasMemberProfile(principal: AuthPrincipal): string {
  if (!principal.memberId) {
    throw forbidden('This action requires a library member profile');
  }
  return principal.memberId;
}

/**
 * Composes an ownership filter with branch scope for a list query.
 *
 * Both predicates are spread into one `where`. They are independent concerns
 * (who owns the row vs which branch it lives in) and both must be present — the
 * membership case that motivated this helper was a scoped librarian's list
 * returning out-of-scope rows because one filter overwrote the other.
 */
export function scopedOwnershipFilter(
  principal: AuthPrincipal,
  options: {
    staffPermission: string;
    ownerField?: string;
    branchScopeFilter?: Record<string, unknown>;
  },
): Prisma.MemberWhereInput {
  return {
    ...(options.branchScopeFilter ?? {}),
    ...ownOrStaffFilter(principal, options.staffPermission, options.ownerField),
  } as Prisma.MemberWhereInput;
}
