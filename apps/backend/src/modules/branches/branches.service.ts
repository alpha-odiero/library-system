import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { SORTABLE_FIELDS } from '../../config/constants.js';
import { notFound } from '../../lib/errors.js';
import { orderBy, skipTake, type PaginationQuery } from '../../lib/pagination.js';
import { branchScopeFilter } from '../../middleware/scope.js';
import { libraryScopeFilter } from '../../middleware/library-scope.js';
import type { AuthPrincipal } from '@lms/shared';

/**
 * Branch reads.
 *
 * SCOPE, NOT PERMISSION, IS THE POINT OF THIS MODULE.
 *
 * `BRANCH_VIEW` answers "may this user read branch data at all". It does not
 * answer "which branches". Those are different questions, and conflating them is
 * how a multi-branch deployment ends up showing a Nairobi librarian a list of
 * every branch in the country.
 *
 * So both functions take Gate 3 as an input and apply it as a `where` predicate
 * INSIDE the query:
 *
 *   • List — `branchScopeFilter(principal, 'id')`. A scoped principal sees only
 *     their own branches; a null scope (`BRANCH_MANAGE_ALL`) sees all of them.
 *   • Fetch one — `findUnique` on id alone would answer "does this branch exist?"
 *     to someone outside its scope, which leaks the existence of the org's layout
 *     and is exactly what `assertBranchScope` in the route layer exists to stop.
 *     The scoped `findFirst` below means an out-of-scope branch is a 404, not a
 *     403 — the caller learns nothing about records they may not see.
 *
 * WRITE OPERATIONS ARE ABSENT DELIBERATELY. Branches are created by a seed or a
 * migration, not by a librarian; adding `POST /branches` before the admin module
 * exists would expose an unguarded way to mint a branch id and, with it, a way to
 * place records outside every other librarian's scope.
 */

/** Fields a branch response includes. Deliberately excludes `libraryId`. */
const BRANCH_SELECT = {
  id: true,
  code: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  isActive: true,
  openedAt: true,
  createdAt: true,
} satisfies Prisma.BranchSelect;

type BranchRow = Prisma.BranchGetPayload<{ select: typeof BRANCH_SELECT }>;

export function toBranchDto(branch: BranchRow) {
  return {
    id: branch.id,
    code: branch.code,
    name: branch.name,
    email: branch.email,
    phone: branch.phone,
    address: branch.address,
    isActive: branch.isActive,
    openedAt: branch.openedAt?.toISOString() ?? null,
    createdAt: branch.createdAt.toISOString(),
  };
}

/**
 * Every branch this principal may read.
 *
 * Used to populate the home-branch picker on member registration and the branch
 * filter on the member register. Both need the whole in-scope list in one call —
 * a paginated picker would force a user with eleven branches to page through a
 * dropdown — which is why `includeInactive` defaults to false but the route passes
 * a caller-chosen limit.
 */
export async function listBranches(
  principal: AuthPrincipal,
  filters: {
    q?: string;
    includeInactive?: boolean;
    pagination: PaginationQuery;
    sort?: string;
    direction?: 'asc' | 'desc';
  },
): Promise<{ branches: BranchRow[]; total: number }> {
  const where: Prisma.BranchWhereInput = {
    // Spread, so this composes with the caller's predicates rather than being
    // overwritten by them — see `branchScopeFilter`.
    ...branchScopeFilter(principal, 'id'),
    // A null branch scope (`BRANCH_MANAGE_ALL`) genuinely means "all branches" —
    // but only WITHIN the caller's library. Without this, an admin's picker would
    // list another tenant's branches, and selecting one would come back as "The
    // selected branch belongs to another library" from the creation services. The
    // library filter is what keeps the picker inside one tenant; the branch scope
    // keeps it inside one person's share of it.
    ...libraryScopeFilter(principal, 'libraryId'),
    ...(filters.includeInactive ? {} : { isActive: true }),
    ...(filters.q
      ? {
          // `mode: 'insensitive'` because a librarian types "main" and expects to
          // find "Main Library" — Postgres `LIKE` is case-sensitive by default.
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { code: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [branches, total] = await Promise.all([
    prisma.branch.findMany({
      where,
      select: BRANCH_SELECT,
      orderBy: orderBy(
        (['name', 'code', 'createdAt'] as const).filter((field) =>
          filters.sort ? (SORTABLE_FIELDS.branch as readonly string[]).includes(field) : true,
        ),
        filters.direction ?? 'asc',
        SORTABLE_FIELDS.branch,
      ),
      ...skipTake(filters.pagination),
    }),
    prisma.branch.count({ where }),
  ]);

  return { branches, total };
}

/**
 * One branch, or 404.
 *
 * `findFirst` with the scope predicate rather than `findUnique` + scope check in
 * the route: an out-of-scope id must be indistinguishable from a nonexistent one,
 * otherwise the response codes turn this endpoint into a probe for which branch
 * ids exist.
 */
export async function getBranch(principal: AuthPrincipal, id: string): Promise<BranchRow> {
  const branch = await prisma.branch.findFirst({
    // `AND` rather than `{ id, ...scopeFilter }`: writing the two into one object
    // literal duplicates the `id` key, and a duplicate key resolves to whichever
    // appears last — which is how a scope predicate ends up silently dropped and
    // a librarian reads a branch outside their assignment. In an `AND` array both
    // predicates are applied, and an empty `{}` from a null scope is a no-op.
    where: {
      AND: [
        { id },
        branchScopeFilter(principal, 'id'),
        libraryScopeFilter(principal, 'libraryId'),
      ],
    },
    select: BRANCH_SELECT,
  });

  if (!branch) throw notFound('Branch');
  return branch;
}
