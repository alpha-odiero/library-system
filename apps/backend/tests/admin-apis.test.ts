import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/config/constants.js';
import {
  settingsListQuerySchema,
  settingsUpdateSchema,
} from '../src/modules/settings/settings.schemas.js';
import { auditLogQuerySchema } from '../src/modules/audit/audit.schemas.js';
import { auditLogToCsv, type AuditLogEntryDto } from '../src/modules/audit/audit-log.service.js';

/**
 * Administrative API tests (settings, audit, reports gates).
 *
 * DB-free by design, matching `branches.test.ts` and friends: the questions worth
 * pinning without a database are the schema boundaries (what shape a hostile or
 * careless caller may send) and the pure functions behind the CSV export. The
 * route-level anonymous refusal for every new path is already asserted by the
 * route-manifest security test, which walks the real Express stack.
 */

function entry(overrides: Partial<AuditLogEntryDto> = {}): AuditLogEntryDto {
  return {
    id: '1',
    actorId: 'user-1',
    actorEmail: 'admin@example.com',
    actorRole: 'ADMIN',
    action: 'SETTINGS_UPDATED',
    entityType: 'setting',
    entityId: 'org.name',
    description: 'Turned the fine rate down',
    ip: '127.0.0.1',
    userAgent: null,
    requestId: 'req-1',
    before: { value: '50.00' },
    after: { value: '25.00' },
    createdAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

describe('settingsListQuerySchema', () => {
  it('accepts a category and trims it', () => {
    expect(settingsListQuerySchema.parse({ category: '  circulation  ' }).category).toBe(
      'circulation',
    );
  });

  it('accepts an empty query', () => {
    expect(settingsListQuerySchema.parse({})).toEqual({});
  });

  it('rejects an empty or over-long category', () => {
    expect(settingsListQuerySchema.safeParse({ category: '' }).success).toBe(false);
    expect(settingsListQuerySchema.safeParse({ category: 'x'.repeat(51) }).success).toBe(false);
  });

  it('rejects an unknown parameter rather than ignoring it', () => {
    expect(settingsListQuerySchema.safeParse({ includeSecrets: 'true' }).success).toBe(false);
  });
});

describe('settingsUpdateSchema', () => {
  it('accepts one or more setting updates', () => {
    const body = settingsUpdateSchema.parse({
      updates: { 'org.max_loans': 6, 'org.name': 'Central Library' },
    });
    expect(body.updates['org.max_loans']).toBe(6);
  });

  it('rejects an empty update set', () => {
    expect(settingsUpdateSchema.safeParse({ updates: {} }).success).toBe(false);
  });

  it('rejects a key over 100 characters', () => {
    expect(settingsUpdateSchema.safeParse({ updates: { ['k'.repeat(101)]: 'v' } }).success).toBe(
      false,
    );
  });

  it('is strict: no unrelated body fields', () => {
    // A stray `adminBypass` field would otherwise be silently dropped while still
    // applying the real updates — the classic half-application.
    expect(
      settingsUpdateSchema.safeParse({ updates: { 'org.name': 'X' }, adminBypass: true }).success,
    ).toBe(false);
  });
});

describe('auditLogQuerySchema', () => {
  it('parses no filters as an unfiltered query', () => {
    expect(auditLogQuerySchema.parse({})).toEqual({});
  });

  it('accepts every declared filter', () => {
    const parsed = auditLogQuerySchema.parse({
      page: 2,
      limit: 50,
      action: 'SETTINGS_UPDATED',
      entityType: 'setting',
      actorEmail: 'admin@example.com',
      from: '2026-01-01',
      to: '2026-01-31T23:59:59Z',
      q: 'fine rate',
    });

    expect(parsed.page).toBe(2);
    expect(parsed.action).toBe('SETTINGS_UPDATED');
    expect(parsed.from).toBeInstanceOf(Date);
    expect(parsed.to).toBeInstanceOf(Date);
  });

  it('rejects an action that is not a real audit verb', () => {
    // A fabricated action must fail here, not reach Prisma and surface as a 500.
    expect(auditLogQuerySchema.safeParse({ action: 'DESK_WIPED' }).success).toBe(false);
  });

  it('rejects a page or limit outside the allowed bounds', () => {
    expect(auditLogQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ page: -1 }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ limit: LIMITS.MAX_PAGE_SIZE + 1 }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ limit: LIMITS.MAX_PAGE_SIZE }).success).toBe(true);
  });

  it('rejects an unknown query parameter and a malformed date', () => {
    expect(auditLogQuerySchema.safeParse({ sort: 'createdAt' }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ from: 'not-a-date' }).success).toBe(false);
  });
});

describe('auditLogToCsv', () => {
  it('writes a header and one row per entry, CRLF-terminated', () => {
    const csv = auditLogToCsv([entry()]);
    const lines = csv.split('\r\n');
    const header = lines[0] as string;
    const row = lines[1] as string;

    expect(header).toContain('id,createdAt,actorEmail,actorRole,action,entityType');
    expect(row).toContain('admin@example.com');
    expect(row).toContain('SETTINGS_UPDATED');
    // One cell per value: the diff's inner commas are not field separators.
    expect(row.split(',').length).toBe(12);
  });

  it('quotes a cell that contains a comma, quote or newline', () => {
    const row = entry({ description: 'wrote "hello", then\nnext line' });
    const csv = auditLogToCsv([row]);

    expect(csv).toContain('"wrote ""hello"", then\nnext line"');
  });

  it('serialises the before/after diff as JSON inside the cell', () => {
    const csv = auditLogToCsv([entry()]);

    expect(csv).toContain('"{""value"":""50.00""}"');
    expect(csv).toContain('"{""value"":""25.00""}"');
  });

  it('renders null fields as empty cells', () => {
    const row = entry({ entityId: null, userAgent: null });
    const csv = auditLogToCsv([row]);

    expect(csv).toContain('setting,,Turned the fine rate down');
  });

  it('emits an empty body (just the header) for no rows', () => {
    expect(auditLogToCsv([]).split('\r\n').length).toBe(1);
  });
});
