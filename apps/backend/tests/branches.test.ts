import { describe, expect, it } from 'vitest';
import {
  branchListQuerySchema,
  branchIdParamSchema,
} from '../src/modules/branches/branches.schemas.js';
import { branchScopeFilter } from '../src/middleware/scope.js';
import type { AuthPrincipal } from '@lms/shared';

/**
 * Branch read tests.
 *
 * These are schema and predicate tests, deliberately not database tests: the
 * questions worth pinning are "can a caller widen the query" and "does the scope
 * predicate compose with the caller's own filters", both of which are decided
 * before Prisma is ever reached. A test that needed a live database to prove them
 * would be slower and would prove less.
 */

function principal(branchScope: string[] | null): AuthPrincipal {
  return {
    userId: 'user-1',
    email: 'a@example.org',
    firstName: 'John',
    lastName: 'Kamau',
    phone: '+254 700 000 000',
    roleCode: 'LIBRARIAN',
    sessionId: 'session-1',
    permissions: new Set<string>(['BRANCH_VIEW']),
    branchScope,
    libraryScope: 'lib-1',
    memberId: null,
    primaryBranchName: 'Nairobi Central',
    libraryName: 'Central Library',
  };
}

describe('branch query schema', () => {
  it('rejects an unknown query parameter rather than ignoring it', () => {
    // A silently dropped `includeAll=true` would read as a decision nobody made.
    const result = branchListQuerySchema.safeParse({ includeAll: 'true' });
    expect(result.success).toBe(false);
  });

  it('coerces includeInactive to a boolean', () => {
    expect(branchListQuerySchema.parse({ includeInactive: 'true' }).includeInactive).toBe(true);
    expect(branchListQuerySchema.parse({}).includeInactive).toBe(false);
  });

  it('trims a search term and rejects an over-long one', () => {
    expect(branchListQuerySchema.parse({ q: '  main  ' }).q).toBe('main');
    expect(branchListQuerySchema.safeParse({ q: 'x'.repeat(121) }).success).toBe(false);
    // min(1) on the query, so `?q=` is a 400 rather than an unfiltered list.
    expect(branchListQuerySchema.safeParse({ q: '' }).success).toBe(false);
  });

  it('rejects a malformed id before it reaches Prisma', () => {
    expect(branchIdParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    expect(
      branchIdParamSchema.safeParse({ id: '3f1a8c22-6d4b-4a1e-9f0d-2b7c5e9a1c34' }).success,
    ).toBe(true);
  });
});

describe('branch scope predicate', () => {
  it('restricts a scoped principal to its own branches', () => {
    expect(branchScopeFilter(principal(['b1', 'b2']), 'id')).toEqual({ id: { in: ['b1', 'b2'] } });
  });

  it('is empty for an all-branch principal', () => {
    // `{}` rather than `{ id: { in: [] } }`: an empty array would be `false` in SQL
    // and return no rows at all, silently emptying the picker for an administrator.
    expect(branchScopeFilter(principal(null), 'id')).toEqual({});
  });

  it('returns a copy, so a caller cannot widen the scope it was handed', () => {
    const scope = ['b1'];
    const filter = branchScopeFilter(principal(scope), 'id');
    (filter as { id: { in: string[] } }).id.in.push('b2');
    expect(scope).toEqual(['b1']);
  });

  it('composes with another predicate instead of replacing it', () => {
    // The spread form the service uses. An exclusive implementation would drop
    // the status filter, or the scope, whichever it did not own.
    const where = { ...branchScopeFilter(principal(['b1']), 'id'), isActive: true };
    expect(where).toEqual({ id: { in: ['b1'] }, isActive: true });
  });

  it('yields no rows for a principal with no branch assigned', () => {
    // Distinguished from all-branch by `null` rather than `[]`, so an empty scope
    // means "no access" and must return nothing.
    expect(branchScopeFilter(principal([]), 'id')).toEqual({ id: { in: [] } });
  });
});
