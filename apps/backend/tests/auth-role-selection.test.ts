import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import {
  accountTypeLabel,
  assertRoleSelection,
  isSelectableRole,
} from '../src/modules/auth/role-selection.js';
import { loginSchema, registerSchema } from '../src/modules/auth/auth.schemas.js';
import {
  userListQuerySchema,
  userCreateSchema,
  userUpdateSchema,
} from '../src/modules/users/users.schemas.js';

/**
 * The login role selector and the request schemas around it.
 *
 * These are the two edges of one decision: the selector says which account type
 * the user THINKS they are, and the schemas decide what may reach the service
 * at all. Both are pure — no database, no HTTP — so the contract is exercised
 * directly rather than through a live sign-in.
 */

describe('assertRoleSelection', () => {
  it('accepts a selection that matches the account role', () => {
    expect(() => assertRoleSelection('ADMIN', 'ADMIN')).not.toThrow();
    expect(() => assertRoleSelection('LIBRARIAN', 'LIBRARIAN')).not.toThrow();
    expect(() => assertRoleSelection('MEMBER', 'MEMBER')).not.toThrow();
  });

  it('accepts an absent selection, whatever the role', () => {
    // Non-browser callers and older clients send no `loginAs`. Their sign-ins
    // must keep working: the check narrows a wrong choice, it never requires one.
    expect(() => assertRoleSelection('ADMIN')).not.toThrow();
    expect(() => assertRoleSelection('MEMBER')).not.toThrow();
  });

  it('throws 422 — not 401 — when the selection contradicts the role', () => {
    // The password has already verified by the time this runs. A 401 would say
    // "wrong credentials" about a request that presented the right ones, and
    // would hand an attacker the same generic answer they get for a bad password.
    let thrown: unknown;
    try {
      assertRoleSelection('ADMIN', 'MEMBER');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    const appError = thrown as AppError;
    expect(appError.code).toBe('UNPROCESSABLE_ENTITY');
    expect(appError.status).toBe(422);
  });

  it('names the account type the credentials actually belong to', () => {
    // The message is the whole point of the 422: it tells a user who picked the
    // wrong tab which tab to pick, without revealing anything to someone who has
    // not already proven the password.
    expect(() => assertRoleSelection('ADMIN', 'MEMBER')).toThrow(/library administrator/);
    expect(() => assertRoleSelection('LIBRARIAN', 'ADMIN')).toThrow(/librarian account/);
    expect(() => assertRoleSelection('MEMBER', 'LIBRARIAN')).toThrow(/member account/);
    expect(() => assertRoleSelection('ADMIN', 'MEMBER')).toThrow(
      /Choose the matching account type/,
    );
  });
});

describe('accountTypeLabel', () => {
  it('reads as the language the login form uses', () => {
    expect(accountTypeLabel('ADMIN')).toBe('library administrator');
    expect(accountTypeLabel('LIBRARIAN')).toBe('librarian');
    expect(accountTypeLabel('MEMBER')).toBe('member');
  });

  it('falls back rather than leaking an unknown role code', () => {
    // A role code this build does not recognise should not be echoed into a
    // message shown to the user; "staff" is the honest generic term.
    expect(accountTypeLabel('SUPER_ADMIN')).toBe('staff');
  });
});

describe('isSelectableRole', () => {
  it('accepts exactly the three selectable types', () => {
    expect(isSelectableRole('ADMIN')).toBe(true);
    expect(isSelectableRole('LIBRARIAN')).toBe(true);
    expect(isSelectableRole('MEMBER')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isSelectableRole('SUPER_ADMIN')).toBe(false);
    expect(isSelectableRole('')).toBe(false);
    expect(isSelectableRole('admin')).toBe(false);
  });
});

/* ── Schemas ─────────────────────────────────────────────────────────────────
 * The recurring assertion below is that unknown keys FAIL. Every schema here is
 * `.strict()` for the mass-assignment reason documented in `auth.schemas.ts`:
 * a body carrying `roleCode` must be rejected at the edge, not silently
 * stripped into something that looks like an innocent request.
 */

const VALID_LOGIN = { email: 'admin@library.test', password: 'correct horse battery' };

describe('loginSchema', () => {
  it('accepts a login with no role selection', () => {
    expect(loginSchema.safeParse(VALID_LOGIN).success).toBe(true);
  });

  it('accepts each selectable account type', () => {
    for (const loginAs of ['ADMIN', 'LIBRARIAN', 'MEMBER'] as const) {
      expect(loginSchema.safeParse({ ...VALID_LOGIN, loginAs }).success).toBe(true);
    }
  });

  it('rejects a role value outside the enum before it reaches the service', () => {
    // Without the enum this would arrive as an arbitrary string and either be
    // ignored (a silent wrong-door sign-in) or compared against the role.
    expect(loginSchema.safeParse({ ...VALID_LOGIN, loginAs: 'SUPER_ADMIN' }).success).toBe(false);
  });

  it('rejects attempt fields such as a forced roleCode', () => {
    expect(loginSchema.safeParse({ ...VALID_LOGIN, roleCode: 'ADMIN' }).success).toBe(false);
    expect(loginSchema.safeParse({ ...VALID_LOGIN, status: 'ACTIVE' }).success).toBe(false);
  });

  it('requires a password', () => {
    expect(loginSchema.safeParse({ email: 'admin@library.test' }).success).toBe(false);
  });
});

const VALID_REGISTER = {
  email: 'owner@library.test',
  password: 'correct horse battery',
  firstName: 'Ada',
  lastName: 'Okello',
};

describe('registerSchema', () => {
  it('accepts registration with no library name (attach to the first active library)', () => {
    expect(registerSchema.safeParse(VALID_REGISTER).success).toBe(true);
  });

  it('accepts a library name, which creates the tenant alongside the account', () => {
    const parsed = registerSchema.safeParse({
      ...VALID_REGISTER,
      libraryName: 'Hillview Community Library',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.libraryName).toBe('Hillview Community Library');
  });

  it('trims the library name and rejects one too short to be a name', () => {
    const trimmed = registerSchema.safeParse({ ...VALID_REGISTER, libraryName: '  Hillview  ' });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) expect(trimmed.data.libraryName).toBe('Hillview');

    // ' A ' trims to 'A' — one character — so the min(2) must apply after the
    // trim, not to the raw string.
    expect(registerSchema.safeParse({ ...VALID_REGISTER, libraryName: ' A ' }).success).toBe(false);
  });

  it('rejects an attempted role grant', () => {
    // Registration creates the role it is designed to create; there is no shape
    // in which the caller can choose a different one.
    expect(registerSchema.safeParse({ ...VALID_REGISTER, roleCode: 'MEMBER' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...VALID_REGISTER, roleId: 'abc' }).success).toBe(false);
  });
});

describe('user schemas (staff provisioning)', () => {
  it('creates an account with no role field anywhere in the schema', () => {
    const parsed = userCreateSchema.safeParse({
      firstName: 'Grace',
      lastName: 'Achieng',
      email: 'grace@library.test',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects every attempt to name a role on create', () => {
    const base = { firstName: 'Grace', lastName: 'Achieng', email: 'grace@library.test' };
    expect(userCreateSchema.safeParse({ ...base, roleCode: 'ADMIN' }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, roleId: 'role-id' }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, role: { code: 'ADMIN' } }).success).toBe(false);
    // The route checks USER_CREATE; the schema additionally refuses a body that
    // tries to skip past the LIBRARIAN constant the service resolves itself.
  });

  it('rejects changing the email through the update schema', () => {
    // Email is an identity, edited through a verified flow if at all — not a
    // PATCH field, where a typo would silently redirect every future notice.
    expect(userUpdateSchema.safeParse({ email: 'new@library.test' }).success).toBe(false);
    expect(userUpdateSchema.safeParse({ roleCode: 'ADMIN' }).success).toBe(false);
  });

  it('rejects a forged LOCKED status', () => {
    // LOCKED belongs to the login lockout. Allowing it here would let an
    // administrator forge (or appear to clear) a lockout without the service
    // performing the paired bookkeeping.
    expect(userUpdateSchema.safeParse({ status: 'LOCKED' }).success).toBe(false);
    expect(userUpdateSchema.safeParse({ status: 'SUSPENDED' }).success).toBe(true);
    expect(userUpdateSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
  });

  it('rejects an empty update rather than burning a write', () => {
    expect(userUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('scopes the list query to known filters', () => {
    expect(
      userListQuerySchema.safeParse({ roleCode: 'LIBRARIAN', status: 'ACTIVE', q: 'grace' })
        .success,
    ).toBe(true);
    expect(userListQuerySchema.safeParse({ direction: 'sideways' }).success).toBe(false);
    expect(userListQuerySchema.safeParse({ libraryId: 'someone-elses-tenant' }).success).toBe(
      false,
    );
  });
});
