import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { AuthPrincipal } from '@lms/shared';
import { permissionsForRole, ROLE_CODES } from '@lms/shared';
import { requireRole } from '../src/middleware/authorize.js';
import { AppError } from '../src/lib/errors.js';
import { updateProfileSchema } from '../src/modules/auth/auth.schemas.js';

/**
 * Settings authorization.
 *
 * `PATCH /settings` is the one write in the system that changes what the
 * circulation desk does to every borrower at once — the fine rate, the loan
 * period, the borrowing block. It is gated twice, on purpose: by permission
 * (`SETTINGS_UPDATE`) and by role (`requireRole('ADMIN')`), because the first
 * answer lives in a database row that a later grant could widen, while the
 * second is the product's statement about who owns organization-wide policy.
 *
 * Both halves are asserted here, DB-free: the grant table is data the seed
 * writes, and the middleware is what enforces it at runtime. The anonymous
 * refusal for the route itself is covered by the route-manifest test.
 */

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    userId: 'user-1',
    email: 'someone@example.com',
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

/** Runs one middleware and returns the error it passed to `next`, if any. */
function run(handler: ReturnType<typeof requireRole>, auth: Request['auth']) {
  const next = vi.fn();

  handler({ auth } as Request, {} as Response, next as unknown as NextFunction);

  // Every guard terminates: one call, or the request hangs rather than fails.
  expect(next.mock.calls).toHaveLength(1);
  const argument = next.mock.calls[0]?.[0] as unknown;
  return argument instanceof AppError ? argument : undefined;
}

describe('settings grants — who the product lets write policy', () => {
  it('grants SETTINGS_UPDATE to the administrator and to nobody else', () => {
    // The whole reason this file exists: if a future seed or a permission-edit
    // screen hands SETTINGS_UPDATE to a desk account, the role gate below is
    // what still refuses the write.
    const holders = ROLE_CODES.filter((code) => permissionsForRole(code).has('SETTINGS_UPDATE'));

    expect(holders).toEqual(['ADMIN']);
  });

  it('grants SETTINGS_VIEW to the administrator only', () => {
    const holders = ROLE_CODES.filter((code) => permissionsForRole(code).has('SETTINGS_VIEW'));

    expect(holders).toEqual(['ADMIN']);
  });
});

describe('requireRole gate on the settings write', () => {
  const gate = requireRole('ADMIN');

  it('lets an administrator through', () => {
    expect(run(gate, principal({ roleCode: 'ADMIN' }))).toBeUndefined();
  });

  it('refuses a librarian even if a grant handed them SETTINGS_UPDATE', () => {
    // Permission and role disagree here by construction: the permission says
    // yes, the role says no. 403 is the answer, and the permission must not be
    // consulted as a tie-breaker.
    const error = run(
      gate,
      principal({
        roleCode: 'LIBRARIAN',
        permissions: new Set(['SETTINGS_UPDATE', 'SETTINGS_VIEW']),
      }),
    );

    expect(error?.status).toBe(403);
    expect(error?.code).toBe('FORBIDDEN');
  });

  it('refuses a member', () => {
    expect(run(gate, principal({ roleCode: 'MEMBER' }))?.status).toBe(403);
  });
});

describe('updateProfileSchema — the self-service profile edit', () => {
  it('accepts a name-only edit and leaves phone absent', () => {
    const parsed = updateProfileSchema.parse({ firstName: 'Amina', lastName: 'Hassan' });

    // Absent stays absent: the service treats `undefined` as "do not touch",
    // so a name edit cannot quietly clear the phone number.
    expect(parsed.phone).toBeUndefined();
    expect(parsed.firstName).toBe('Amina');
  });

  it('clears the phone only when it is sent as an empty string', () => {
    expect(updateProfileSchema.parse({ phone: '' }).phone).toBeNull();
    expect(updateProfileSchema.parse({ phone: '  +254 712 345 678  ' }).phone).toBe(
      '+254 712 345 678',
    );
  });

  it('rejects an empty body rather than auditing a no-op', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });

  it('refuses fields no account may grant itself', () => {
    // Mass assignment. `.strict()` rejects rather than stripping, so the
    // attempt is a visible 400 instead of a request that looks like a
    // successful name change.
    for (const forbidden of [
      { roleCode: 'ADMIN' },
      { email: 'attacker@example.com' },
      { status: 'ACTIVE' },
      { libraryScope: null },
      { permissions: ['SETTINGS_UPDATE'] },
    ]) {
      expect(updateProfileSchema.safeParse(forbidden).success).toBe(false);
    }
  });

  it('rejects blank or over-long names', () => {
    expect(updateProfileSchema.safeParse({ firstName: '   ' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ lastName: 'x'.repeat(101) }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ phone: 'x'.repeat(33) }).success).toBe(false);
  });
});
