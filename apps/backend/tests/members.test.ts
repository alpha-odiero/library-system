import { describe, expect, it } from 'vitest';
import {
  memberCreateSchema,
  memberListQuerySchema,
  memberTypeCreateSchema,
  memberTypeUpdateSchema,
  memberUpdateSchema,
  memberIdParamSchema,
} from '../src/modules/members/members.schemas.js';
import { LIMITS } from '../src/config/constants.js';

/**
 * Member schema tests.
 *
 * These schemas are the only thing standing between a request body and a
 * privileged Prisma `data` object, so the cases that matter are the ones where a
 * careless transform turns "absent" into "cleared" — silent data loss on a PATCH
 * is far worse than a rejected request.
 *
 * No database is involved: everything here is pure Zod.
 */

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

/* ── Absent vs. explicitly cleared ───────────────────────────────────────────── */

describe('optional member fields', () => {
  it('leaves an omitted field undefined rather than null', () => {
    const parsed = memberUpdateSchema.parse({ firstName: 'Ada' });

    // `undefined` is the signal the service checks before assigning. A `null` here
    // would make every PATCH wipe every optional column it never mentioned.
    expect(parsed.phone).toBeUndefined();
    expect(parsed.address).toBeUndefined();
    expect(parsed.city).toBeUndefined();
    expect(parsed.occupation).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
    expect(parsed.gender).toBeUndefined();
  });

  it('does not add absent keys to the output object', () => {
    const parsed = memberUpdateSchema.parse({ lastName: 'Lovelace' });

    expect(Object.keys(parsed)).toEqual(['lastName']);
  });

  it('treats an empty string as an explicit clear', () => {
    // Nulling a field is a real, intentional action; it must survive the
    // transform so the service can tell it apart from "not mentioned".
    const parsed = memberUpdateSchema.parse({ address: '   ', city: '' });

    expect(parsed.address).toBeNull();
    expect(parsed.city).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    const parsed = memberUpdateSchema.parse({ occupation: '  Engineer  ' });

    expect(parsed.occupation).toBe('Engineer');
  });
});

/* ── Empty patches ───────────────────────────────────────────────────────────── */

describe('empty updates', () => {
  it('rejects a PATCH that changes nothing', () => {
    const result = memberUpdateSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('accepts a PATCH that clears a single field', () => {
    // Clearing is a change, so the "at least one field" guard must not block it.
    expect(memberUpdateSchema.safeParse({ notes: null }).success).toBe(true);
  });

  it('rejects a member-type PATCH that changes nothing', () => {
    expect(memberTypeUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a member-type PATCH that raises the fine cap to uncapped', () => {
    // Null means "no cap", which is a policy decision, not an omission.
    expect(memberTypeUpdateSchema.safeParse({ maxFineCap: null }).success).toBe(true);
  });
});

/* ── Strictness ──────────────────────────────────────────────────────────────── */

describe('strictness', () => {
  it('rejects an unknown member field instead of stripping it', () => {
    const result = memberCreateSchema.safeParse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.org',
      memberTypeId: UUID_A,
      homeBranchId: UUID_B,
      roleCode: 'ADMIN',
    });

    // A silently stripped field reads as "considered and rejected" when in fact
    // nobody decided. This is the mass-assignment guard.
    expect(result.success).toBe(false);
  });

  it('rejects an unknown member-type field', () => {
    expect(
      memberTypeCreateSchema.safeParse({
        code: 'STAFF',
        name: 'Staff',
        finePerDay: '0',
        isAdmin: true,
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown query parameter', () => {
    expect(memberListQuerySchema.safeParse({ page: '1', includeAllBranches: 'true' }).success).toBe(
      false,
    );
  });

  it('rejects a malformed path id before it reaches Prisma', () => {
    expect(memberIdParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });
});

/* ── Calendar dates ───────────────────────────────────────────────────────────── */

describe('calendar dates', () => {
  it('accepts a plain date', () => {
    const parsed = memberUpdateSchema.parse({ dateOfBirth: '1815-12-10' });

    expect(parsed.dateOfBirth).toBe('1815-12-10');
  });

  it('rejects a datetime, which would move a birthday across timezones', () => {
    expect(memberUpdateSchema.safeParse({ dateOfBirth: '1990-01-01T00:00:00Z' }).success).toBe(
      false,
    );
  });

  it('rejects a date that matches the shape but is not a real day', () => {
    // Passes the regex; fails because February has no 30th.
    expect(memberUpdateSchema.safeParse({ dateOfBirth: '2025-02-30' }).success).toBe(false);
  });

  it('rejects an impossible month', () => {
    expect(memberUpdateSchema.safeParse({ dateOfBirth: '2025-13-01' }).success).toBe(false);
  });
});

/* ── Desk registration ────────────────────────────────────────────────────────── */

describe('desk registration', () => {
  const valid = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.org',
    memberTypeId: UUID_A,
    homeBranchId: UUID_B,
  };

  it('defaults to not creating a login account', () => {
    expect(memberCreateSchema.parse(valid).createAccount).toBe(false);
  });

  it('requires a password when an account is requested', () => {
    const result = memberCreateSchema.safeParse({ ...valid, createAccount: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('password'))).toBe(true);
    }
  });

  it('accepts desk registration with no password at all', () => {
    // The service generates an unusable random credential and sets
    // `mustChangePassword`; most members never sign in.
    expect(memberCreateSchema.safeParse(valid).success).toBe(true);
  });

  it('lower-cases the email so duplicates cannot be smuggled past the unique index', () => {
    expect(memberCreateSchema.parse({ ...valid, email: '  Ada@Example.ORG ' }).email).toBe(
      'ada@example.org',
    );
  });

  it('requires a member type and home branch', () => {
    expect(
      memberCreateSchema.safeParse({ firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.co' })
        .success,
    ).toBe(false);
  });

  it('rejects a membership number longer than the column allows', () => {
    expect(
      memberCreateSchema.safeParse({ ...valid, membershipNumber: 'M'.repeat(31) }).success,
    ).toBe(false);
  });
});

/* ── Member types ────────────────────────────────────────────────────────────── */

describe('member types', () => {
  it('normalises the code to upper case', () => {
    // The code is the prefix of every membership number it generates, so one
    // canonical spelling is what keeps those numbers stable.
    const parsed = memberTypeCreateSchema.parse({
      code: ' public ',
      name: 'Public',
      finePerDay: '0.50',
    });

    expect(parsed.code).toBe('PUBLIC');
  });

  it('rejects a code that could not be a number prefix', () => {
    expect(
      memberTypeCreateSchema.safeParse({ code: '-BAD-', name: 'Bad', finePerDay: '0' }).success,
    ).toBe(false);
  });

  it('rejects a single-character code', () => {
    expect(
      memberTypeCreateSchema.safeParse({ code: 'P', name: 'Public', finePerDay: '0' }).success,
    ).toBe(false);
  });

  it('requires the fine as a decimal string, never a float', () => {
    expect(
      memberTypeCreateSchema.safeParse({ code: 'PUB', name: 'Public', finePerDay: 0.5 }).success,
    ).toBe(false);
  });

  it('rejects a fine with more precision than money allows', () => {
    expect(
      memberTypeCreateSchema.safeParse({ code: 'PUB', name: 'Public', finePerDay: '0.005' })
        .success,
    ).toBe(false);
  });

  it('rejects a negative fine', () => {
    expect(
      memberTypeCreateSchema.safeParse({ code: 'PUB', name: 'Public', finePerDay: '-1' }).success,
    ).toBe(false);
  });

  it('rejects a loan duration that would let a book circulate for years', () => {
    expect(
      memberTypeCreateSchema.safeParse({
        code: 'PUB',
        name: 'Public',
        finePerDay: '0',
        loanDurationDays: 366,
      }).success,
    ).toBe(false);
  });

  it('rejects a negative loan cap', () => {
    expect(
      memberTypeCreateSchema.safeParse({
        code: 'PUB',
        name: 'Public',
        finePerDay: '0',
        maxActiveLoans: -1,
      }).success,
    ).toBe(false);
  });

  it('does not allow the code to be edited', () => {
    // It appears in membership numbers and audit rows; changing it would orphan
    // history written against the old value.
    expect(memberTypeUpdateSchema.safeParse({ code: 'PUBLIC2' }).success).toBe(false);
  });
});

/* ── Query parsing ───────────────────────────────────────────────────────────── */

describe('list queries', () => {
  it('defaults includeDeleted to false', () => {
    expect(memberListQuerySchema.parse({}).includeDeleted).toBe(false);
  });

  it('reads includeDeleted from the query string', () => {
    expect(memberListQuerySchema.parse({ includeDeleted: 'true' }).includeDeleted).toBe(true);
  });

  it('rejects a non-numeric page', () => {
    expect(memberListQuerySchema.safeParse({ page: 'first' }).success).toBe(false);
  });

  it('rejects a page size beyond the maximum', () => {
    expect(
      memberListQuerySchema.safeParse({ limit: String(LIMITS.MAX_PAGE_SIZE + 1) }).success,
    ).toBe(false);
  });

  it('rejects an unknown sort direction', () => {
    expect(memberListQuerySchema.safeParse({ direction: 'sideways' }).success).toBe(false);
  });

  it('rejects a blank free-text query that would match everything', () => {
    expect(memberListQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });
});
