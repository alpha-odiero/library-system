import type { AuthPrincipal } from '@lms/shared';
import { prisma } from '../../config/database.js';

/**
 * Builds the request identity (Gate 1 output).
 *
 * Permissions and branch scope are read from the DATABASE on every request, not
 * from the signed token. That costs one indexed join, and it buys the property
 * that matters: revoking a role grant, suspending an account, or narrowing a
 * librarian's branches takes effect on the very next request. A token carrying
 * its own permission list would keep the old grants alive until it expired —
 * fifteen minutes of a librarian still holding `USER_UPDATE` after an admin
 * revoked it.
 *
 * The single query below is deliberately flat. The join path is
 * user → role → role_permissions → permission; splitting it into three queries
 * would triple the latency of every authenticated request in the system.
 */
export async function buildPrincipal(
  userId: string,
  sessionId: string,
): Promise<AuthPrincipal | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      status: true,
      deletedAt: true,
      mustChangePassword: true,
      // Gate 2. Library scope is read here, on the same row as everything else,
      // so it costs nothing extra. `libraryId` is nullable in the schema by
      // design and resolves to `libraryScope: null` below, which fails closed.
      libraryId: true,
      library: { select: { name: true } },
      primaryBranchId: true,
      primaryBranch: { select: { name: true } },
      role: {
        select: {
          code: true,
          // Reached through the Role, not directly on User: a user holds exactly
          // one role, and `role_permissions` is keyed by role.
          permissions: { select: { permission: { select: { code: true } } } },
        },
      },
      branchAssignments: { select: { branchId: true } },
      memberProfile: { select: { id: true } },
    },
  });

  if (!user) return null;
  if (user.deletedAt !== null) return null;
  if (user.status !== 'ACTIVE') return null;

  const permissions = new Set<string>(user.role.permissions.map((rp) => rp.permission.code));

  /**
   * Branch scope, Gate 3's input.
   *
   * `null` means every branch, and it is granted by the DATA permission
   * `BRANCH_MANAGE_ALL` — not by the role code. Reading it from the role would
   * make the grant unrevocable without a code change, which contradicts the
   * shared role definitions that describe it as "granted by default (still
   * revocable)".
   *
   * Everyone else is confined to `user_branches` plus their home branch. The
   * union matters: a librarian created directly in the database without a
   * `user_branches` row still has a home branch to operate at.
   */
  const branchScope = permissions.has('BRANCH_MANAGE_ALL')
    ? null
    : [
        ...new Set([
          ...(user.primaryBranchId ? [user.primaryBranchId] : []),
          ...user.branchAssignments.map((assignment) => assignment.branchId),
        ]),
      ];

  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    roleCode: user.role.code,
    sessionId,
    permissions,
    branchScope,
    // Carried through VERBATIM, including the null. There is deliberately no
    // fallback here: inferring a library from the home branch, from the role, or
    // from "there is only one library" would silently grant a tenant-wide view to
    // an account that was never attributed to one. Call sites use
    // `requireLibraryScope()` / `libraryScopeFilter()` so that forgetting to check
    // is a type error rather than a leak.
    libraryScope: user.libraryId,
    memberId: user.memberProfile?.id ?? null,
    primaryBranchName: user.primaryBranch?.name ?? null,
    libraryName: user.library?.name ?? null,
  };
}
