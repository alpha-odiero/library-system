import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ALL_PERMISSION_CODES,
  isPermissionCode,
  PERMISSIONS,
  PERMISSION_MAP,
  RESOURCES,
  type PermissionDefinition,
} from './permissions.js';
import { permissionsForRole, ROLE_MAP, ROLES } from './roles.js';
import { ALL_ERROR_CODES, DOMAIN_CODES, statusForApiCode } from './errors.js';
import { buildPaginationMeta, MAX_PAGE_SIZE, paginationQuerySchema } from './api.js';

/**
 * Codes are the stable public identifiers persisted in the database and quoted
 * in audit rows, so they are never renamed. That means they are NOT mechanically
 * derived: `USER_DEACTIVATE`, `BRANCH_MANAGE_ALL` and `REPORT_VIEW_FINANCIAL`
 * diverge from RESOURCE_ACTION on purpose, and scoping qualifiers (`_OWN`,
 * `_OTHERS`, `_FINANCIAL`, `_ALL`) narrow a base capability.
 *
 * What IS enforced below is that a code is well-formed, unique, prefixed by its
 * resource (so an auditor can group a code back to a resource), and backed by a
 * known resource/action pair and a real description.
 */

/** Code prefix per resource. Divergences from RESOURCE are listed explicitly. */
const CODE_PREFIX: Record<string, string> = {
  user: 'USER_',
  role: 'ROLE_',
  permission: 'PERMISSION_',
  audit: 'AUDIT_',
  setting: 'SETTINGS_', // plural code for a singular resource
  library: 'LIBRARY_',
  branch: 'BRANCH_',
  location: 'LOCATION_',
  shelf: 'SHELF_',
  member: 'MEMBER_',
  member_type: 'MEMBER_TYPE_',
  borrow_request: 'BORROW_REQUEST_',
  book: 'BOOK_',
  author: 'AUTHOR_',
  category: 'CATEGORY_',
  publisher: 'PUBLISHER_',
  tag: 'TAG_',
  copy: 'COPY_',
  loan: 'LOAN_',
  reservation: 'RESERVATION_',
  fine: 'FINE_',
  payment: 'PAYMENT_',
  notification: 'NOTIFICATION_',
  report: 'REPORT_',
  digital: 'DIGITAL_',
};

/**
 * `PERMISSIONS` is `as const satisfies readonly PermissionDefinition[]`, which
 * preserves each entry's literal shape for `PermissionCode` extraction — but that
 * also means the union only has `sensitive` on the entries that declare it.
 * Tests that read optional fields go through this widened view.
 */
const DEFS: readonly PermissionDefinition[] = PERMISSIONS;

/**
 * Codes that are self-scoped by contract despite lacking the `_OWN` suffix.
 *
 * `BORROW_REQUEST_CREATE` reads "File a borrow request for oneself" in the
 * registry — filing one is always for oneself, so a parallel
 * `BORROW_REQUEST_CREATE_OWN` would be a second code for the same act. The
 * staff counterparts are APPROVE/REJECT/ISSUE, which LIBRARIAN holds and MEMBER
 * does not. Kept here rather than as an inline exception in three tests so the
 * reasoning lives in one place.
 */
const MEMBER_SELF_SERVICE = new Set(['BORROW_REQUEST_CREATE']);

describe('permission registry integrity', () => {
  it('has no duplicate codes', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('codes are SCREAMING_SNAKE_CASE', () => {
    for (const p of PERMISSIONS) {
      expect(p.code, `code "${p.code}" must be SCREAMING_SNAKE_CASE`).toMatch(
        /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/,
      );
    }
  });

  it('codes are prefixed by their resource', () => {
    // Guarantees a code read in isolation (an audit row, a log line) can be
    // attributed to a resource without a database lookup.
    for (const p of PERMISSIONS) {
      expect(p.code, `code "${p.code}" must start with ${CODE_PREFIX[p.resource]}`).toMatch(
        new RegExp(`^${CODE_PREFIX[p.resource]}`),
      );
    }
  });

  it('every permission uses a known resource and action', () => {
    for (const p of PERMISSIONS) {
      expect(RESOURCES).toContain(p.resource);
      expect(ACTIONS).toContain(p.action);
      expect(
        Object.hasOwn(CODE_PREFIX, p.resource),
        `no code prefix registered for ${p.resource}`,
      ).toBe(true);
    }
  });

  it('every permission has a non-empty description', () => {
    for (const p of PERMISSIONS) {
      expect(
        p.description.trim().length,
        `permission ${p.code} needs a description`,
      ).toBeGreaterThan(0);
    }
  });

  it('marks every privileged capability as sensitive', () => {
    // If a capability can change money, access, or scope, the security review
    // checklist must see it.
    for (const p of DEFS) {
      if (['waive', 'void', 'broadcast', 'mark_lost'].includes(p.action)) {
        expect(
          p.sensitive,
          `${p.code} performs a privileged action but is not marked sensitive`,
        ).toBe(true);
      }
    }
  });

  it('index and helpers agree with the source list', () => {
    expect(ALL_PERMISSION_CODES.length).toBe(PERMISSIONS.length);
    for (const code of ALL_PERMISSION_CODES) {
      expect(isPermissionCode(code)).toBe(true);
      expect(PERMISSION_MAP[code]).toBeDefined();
    }
    expect(isPermissionCode('BOOK_VIEW_ALL_AT_ONCE')).toBe(false);
  });
});

describe('role definitions', () => {
  it('every role grants only registered permissions', () => {
    for (const role of ROLES) {
      for (const code of role.permissions) {
        expect(isPermissionCode(code), `${role.code} grants unknown permission ${code}`).toBe(true);
      }
    }
  });

  it('has no duplicate grants within a role', () => {
    for (const role of ROLES) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('ADMIN is granted every registered permission', () => {
    expect(new Set(ROLE_MAP.ADMIN.permissions)).toEqual(new Set(ALL_PERMISSION_CODES));
  });

  it('LIBRARIAN is denied administrative capabilities', () => {
    const denied = [
      'USER_CREATE',
      'USER_UPDATE',
      'USER_DELETE',
      'ROLE_UPDATE',
      'PERMISSION_VIEW',
      'SETTINGS_VIEW',
      'SETTINGS_UPDATE',
      'AUDIT_VIEW',
      'AUDIT_EXPORT',
      'BRANCH_MANAGE_ALL',
      'REPORT_VIEW_FINANCIAL',
    ] as const;

    for (const code of denied) {
      expect(ROLE_MAP.LIBRARIAN.permissions, `LIBRARIAN must not hold ${code}`).not.toContain(code);
    }
  });

  it('MEMBER only ever holds *_OWN variants plus public catalogue reads', () => {
    const publicReads: readonly string[] = [
      'BRANCH_VIEW',
      'MEMBER_TYPE_VIEW',
      'BOOK_VIEW',
      'AUTHOR_VIEW',
      'CATEGORY_VIEW',
      'PUBLISHER_VIEW',
      'TAG_VIEW',
      'COPY_VIEW',
      'DIGITAL_VIEW',
      'DIGITAL_ACCESS',
    ];

    for (const code of ROLE_MAP.MEMBER.permissions) {
      const isOwnScoped = code.endsWith('_OWN') || MEMBER_SELF_SERVICE.has(code);
      expect(
        isOwnScoped || publicReads.includes(code),
        `MEMBER must not hold staff permission ${code}`,
      ).toBe(true);
    }
  });

  it('MEMBER holds no staff write capability', () => {
    const writes = DEFS.filter(
      (p) =>
        p.sensitive === true ||
        ['create', 'update', 'delete', 'manage', 'archive', 'waive', 'void', 'broadcast'].includes(
          p.action,
        ),
    )
      .map((p) => p.code)
      // `_OWN` variants are member-initiated writes on their own rows (placing a
      // reservation, paying a fine). They are deliberately held by MEMBER.
      .filter((code) => !code.endsWith('_OWN') && !MEMBER_SELF_SERVICE.has(code));

    for (const code of writes) {
      expect(ROLE_MAP.MEMBER.permissions, `MEMBER must not hold ${code}`).not.toContain(code);
    }
  });

  it('every permission MEMBER holds is either _OWN-scoped or a public read', () => {
    const publicReads = new Set([
      'BRANCH_VIEW',
      'MEMBER_TYPE_VIEW',
      'BOOK_VIEW',
      'AUTHOR_VIEW',
      'CATEGORY_VIEW',
      'PUBLISHER_VIEW',
      'TAG_VIEW',
      'COPY_VIEW',
      'DIGITAL_VIEW',
      // Consuming an entitlement is not a staff capability: which resources a
      // member may open is decided per-loan/row, not by this permission.
      'DIGITAL_ACCESS',
    ]);

    for (const code of ROLE_MAP.MEMBER.permissions) {
      const allowed =
        code.endsWith('_OWN') || publicReads.has(code) || MEMBER_SELF_SERVICE.has(code);
      expect(allowed, `MEMBER must not hold staff permission ${code}`).toBe(true);
    }
  });

  it('LIBRARIAN never holds global branch scope; ADMIN does', () => {
    expect(ROLE_MAP.ADMIN.globalBranchScope).toBe(true);
    expect(ROLE_MAP.LIBRARIAN.globalBranchScope).toBe(false);
    expect(ROLE_MAP.LIBRARIAN.permissions).not.toContain('BRANCH_MANAGE_ALL');
  });

  it('permissionsForRole returns a set', () => {
    expect(permissionsForRole('MEMBER').has('BOOK_VIEW')).toBe(true);
    expect(permissionsForRole('MEMBER').has('SETTINGS_VIEW')).toBe(false);
  });
});

describe('error code registry', () => {
  it('maps every code to a valid HTTP status', () => {
    for (const code of ALL_ERROR_CODES) {
      const status = statusForApiCode(code);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('uses 401 only for unauthenticated cases and 403 for authorization', () => {
    expect(statusForApiCode('UNAUTHENTICATED')).toBe(401);
    expect(statusForApiCode('INVALID_CREDENTIALS')).toBe(401);
    expect(statusForApiCode('TOKEN_EXPIRED')).toBe(401);
    expect(statusForApiCode('FORBIDDEN')).toBe(403);
    expect(statusForApiCode('INSUFFICIENT_SCOPE')).toBe(403);
  });

  it('maps state conflicts to 409 and validation-shaped domain failures to 422', () => {
    expect(statusForApiCode('COPY_ALREADY_ON_LOAN')).toBe(409);
    expect(statusForApiCode('LOAN_LIMIT_REACHED')).toBe(409);
    expect(statusForApiCode('FINE_OVERPAYMENT')).toBe(422);
    expect(statusForApiCode('FINE_NOT_FOUND')).toBe(404);
  });

  it('domain codes have no duplicates', () => {
    expect(new Set(DOMAIN_CODES).size).toBe(DOMAIN_CODES.length);
  });
});

describe('pagination contract', () => {
  it('defaults and clamps to a maximum page size of 100', () => {
    expect(paginationQuerySchema.parse({})).toMatchObject({ page: 1, limit: 20, order: 'desc' });
    expect(() => paginationQuerySchema.parse({ limit: MAX_PAGE_SIZE })).not.toThrow();
    expect(() => paginationQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it('coerces numeric strings from the query string', () => {
    expect(paginationQuerySchema.parse({ page: '3', limit: '50' })).toMatchObject({
      page: 3,
      limit: 50,
    });
  });

  it('rejects a non-positive page', () => {
    expect(() => paginationQuerySchema.parse({ page: 0 })).toThrow();
  });

  it('computes total pages by ceiling division', () => {
    expect(buildPaginationMeta({ page: 1, limit: 20, total: 500 })).toEqual({
      page: 1,
      limit: 20,
      total: 500,
      totalPages: 25,
    });
    expect(buildPaginationMeta({ page: 1, limit: 20, total: 0 }).totalPages).toBe(0);
    expect(buildPaginationMeta({ page: 1, limit: 20, total: 21 }).totalPages).toBe(2);
  });
});
