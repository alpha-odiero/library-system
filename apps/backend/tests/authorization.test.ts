import { describe, expect, it } from 'vitest';
import type { AuthPrincipal } from '@lms/shared';
import { NO_MEMBER_PROFILE } from '../src/middleware/ownership.js';

/** RFC 4122 shape, which is what every id column in the schema declares. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { AppError } from '../src/lib/errors.js';
import {
  isBranchInScope,
  assertBranchScope,
  branchScopeFilter,
  resolveEffectiveBranchId,
} from '../src/middleware/scope.js';
import {
  ownMemberFilter,
  ownUserFilter,
  ownOrStaffFilter,
  assertOwned,
  assertCanModifyOwn,
  assertSelfOrPermission,
  assertHasMemberProfile,
} from '../src/middleware/ownership.js';

/**
 * Authorization-gate tests.
 *
 * These are the tests that decide whether `MEMBER` can read another member's
 * loans, and whether a librarian can act outside their branches. They assert the
 * NEGATIVE cases deliberately: a gate test that only proves the allowed path
 * works proves nothing, because the whole point of a gate is to refuse.
 */

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    userId: 'user-1',
    email: 'member@example.com',
    firstName: 'Amina',
    lastName: 'Hassan',
    phone: null,
    roleCode: 'MEMBER',
    sessionId: 'session-1',
    permissions: new Set<string>(),
    branchScope: [],
    libraryScope: null,
    memberId: 'member-1',
    primaryBranchName: 'Central Branch',
    libraryName: null,
    ...overrides,
  };
}

const admin = principal({
  roleCode: 'ADMIN',
  permissions: new Set(['BRANCH_MANAGE_ALL', 'MEMBER_VIEW', 'MEMBER_VIEW_OTHERS', 'LOAN_VIEW']),
  branchScope: null,
  memberId: null,
});

const librarian = principal({
  roleCode: 'LIBRARIAN',
  permissions: new Set(['LOAN_CREATE', 'LOAN_VIEW', 'MEMBER_VIEW']),
  branchScope: ['branch-a', 'branch-b'],
  memberId: null,
});

describe('Gate 3 — branch scope', () => {
  it('treats a null scope as every branch', () => {
    expect(isBranchInScope(admin, 'branch-a')).toBe(true);
    expect(isBranchInScope(admin, 'any-branch-at-all')).toBe(true);
  });

  it('allows only assigned branches for a scoped principal', () => {
    expect(isBranchInScope(librarian, 'branch-a')).toBe(true);
    expect(isBranchInScope(librarian, 'branch-z')).toBe(false);
  });

  it('denies a scoped principal when no branch is supplied', () => {
    // A null branchId with a non-null scope must not pass as "no restriction" —
    // that would let a row with no branch through every branch filter.
    expect(isBranchInScope(librarian, null)).toBe(false);
    expect(isBranchInScope(librarian, undefined)).toBe(false);
  });

  it('throws 403 rather than 404 for an out-of-scope branch', () => {
    // A 403 is correct: the caller is allowed to know branches exist.
    try {
      assertBranchScope(librarian, 'branch-z');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN');
      expect((error as AppError).status).toBe(403);
    }
  });

  it('produces no where-clause for an all-branch principal', () => {
    // An empty filter is correct ONLY for a global scope. See the ownership
    // tests for the same shape being dangerous in the other direction.
    expect(branchScopeFilter(admin, 'homeBranchId')).toEqual({});
  });

  it('restricts the query for a scoped principal', () => {
    expect(branchScopeFilter(librarian, 'homeBranchId')).toEqual({
      homeBranchId: { in: ['branch-a', 'branch-b'] },
    });
  });

  it('defaults to the first assigned branch when none is requested', () => {
    expect(resolveEffectiveBranchId(librarian, null)).toBe('branch-a');
  });

  it('refuses to guess a branch for a principal with no assignment', () => {
    const unassigned = principal({ branchScope: [], memberId: 'member-1' });
    // Placing data in an arbitrary branch would put it somewhere the user cannot
    // subsequently see or correct it.
    expect(() => resolveEffectiveBranchId(unassigned, null)).toThrow(AppError);
  });

  it('rejects a requested branch outside the scope', () => {
    expect(() => resolveEffectiveBranchId(librarian, 'branch-z')).toThrow(AppError);
  });
});

describe('Gate 4 — ownership', () => {
  const member = principal({ memberId: 'member-1' });
  const staffWithoutView = librarian;

  it("scopes a query to the caller's own member record", () => {
    expect(ownMemberFilter(member)).toEqual({ memberId: 'member-1' });
  });

  it('matches nothing for a staff principal with no member profile', () => {
    // THE critical case. Returning `{}` here would match EVERY member row: a
    // librarian without a member profile would see the whole membership.
    const filter = ownMemberFilter(staffWithoutView);

    expect(filter).not.toEqual({});
    expect(filter).toEqual({ memberId: NO_MEMBER_PROFILE });
    // Nothing in the schema can ever equal this, so the query returns no rows.
    // The sentinel is an impossible UUID, and `memberId` is non-nullable here.
    expect(NO_MEMBER_PROFILE).toMatch(UUID_PATTERN);
    expect(NO_MEMBER_PROFILE).not.toBe('');
  });

  it('scopes a query to the calling user for user-owned resources', () => {
    expect(ownUserFilter(member)).toEqual({ userId: 'user-1' });
  });

  it('gives staff the unrestricted filter', () => {
    expect(ownOrStaffFilter(staffWithoutView, 'LOAN_VIEW')).toEqual({});
  });

  it('gives a member the ownership filter when staff lacks the permission', () => {
    // This is the MEMBER path: `MEMBER` holds `LOAN_VIEW_OWN`, not `LOAN_VIEW`,
    // so it receives `memberId = own` and cannot see another member's loans.
    expect(ownOrStaffFilter(member, 'LOAN_VIEW')).toEqual({ memberId: 'member-1' });
  });

  it('filters member records by their primary key for self-service reads', () => {
    expect(ownOrStaffFilter(member, 'MEMBER_VIEW_OTHERS', 'id')).toEqual({ id: 'member-1' });
  });

  it('allows authorized staff to read member records within branch scope', () => {
    expect(ownOrStaffFilter(admin, 'MEMBER_VIEW_OTHERS', 'id')).toEqual({});
  });

  it('accepts a record the caller owns', () => {
    expect(() => assertOwned({ memberId: 'member-1' }, member)).not.toThrow();
  });

  it("throws 404 — not 403 — for another member's record", () => {
    try {
      // `member` (member-1) asking for a loan belonging to member-2.
      assertOwned({ memberId: 'member-2' }, member, 'Loan');
      expect.unreachable('should have thrown');
    } catch (error) {
      // 403 would confirm the row exists, turning the endpoint into an oracle
      // for enumerating loan and member ids.
      expect((error as AppError).code).toBe('NOT_FOUND');
      expect((error as AppError).status).toBe(404);
    }
  });

  it('returns 404 even when the caller holds a broad permission', () => {
    // `MEMBER_VIEW` must not convert this into a 403. `assertOwned` is reached on
    // `*_OWN` routes; a staff caller who should see this row should have had the
    // query widened with `ownOrStaffFilter`, or used `assertCanModifyOwn`.
    const withView = principal({ permissions: new Set(['MEMBER_VIEW']), memberId: 'member-1' });
    try {
      assertOwned({ memberId: 'member-2' }, withView, 'Member');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).status).toBe(404);
    }
  });

  it('lets a staff caller through assertCanModifyOwn with the permission', () => {
    const staff = principal({ permissions: new Set(['MEMBER_UPDATE']), memberId: null });
    expect(() =>
      assertCanModifyOwn({ memberId: 'member-2' }, staff, 'MEMBER_UPDATE', 'Member'),
    ).not.toThrow();
  });

  it('still refuses a staff caller lacking the permission', () => {
    const staff = principal({ permissions: new Set(['MEMBER_VIEW']), memberId: null });
    expect(() =>
      assertCanModifyOwn({ memberId: 'member-2' }, staff, 'MEMBER_UPDATE', 'Member'),
    ).toThrow(AppError);
  });

  it("lets a member act on their own id and nobody else's", () => {
    expect(() => assertSelfOrPermission(member, 'member-1', 'MEMBER_UPDATE')).not.toThrow();
    expect(() => assertSelfOrPermission(member, 'member-2', 'MEMBER_UPDATE')).toThrow(AppError);
  });

  it('lets staff with the permission act on any id', () => {
    const staff = principal({ permissions: new Set(['MEMBER_UPDATE']), memberId: null });
    expect(() => assertSelfOrPermission(staff, 'member-2', 'MEMBER_UPDATE')).not.toThrow();
  });

  it('requires a member profile for member-scoped staff actions', () => {
    const staff = principal({ permissions: new Set(['LOAN_CREATE']), memberId: null });
    expect(() => assertHasMemberProfile(staff)).toThrow(AppError);
  });
});
