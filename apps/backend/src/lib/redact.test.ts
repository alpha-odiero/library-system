import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { diffForAudit, redact, toTransport } from './redact.js';

describe('redact', () => {
  it('masks sensitive keys at any depth', () => {
    // redact MASKS rather than deletes: keeping the key name is what makes a
    // log line diagnosable ("the request body had a password field, which was
    // blanked") while the value is unrecoverable. `toTransport` deletes.
    const input = {
      email: 'a@b.test',
      password: 'hunter2',
      profile: {
        firstName: 'Ada',
        passwordHash: 'argon2id$v=19...',
        sessions: [{ refreshToken: 'rt_abc' }],
      },
    };

    const output = redact(input) as Record<string, Record<string, unknown>>;

    expect(output.password).toBe('[REDACTED]');
    expect(output.profile?.passwordHash).toBe('[REDACTED]');
    expect((output.profile?.sessions as Record<string, unknown>[])[0]?.refreshToken).toBe(
      '[REDACTED]',
    );

    const serialised = JSON.stringify(output);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('argon2id');
    expect(serialised).not.toContain('rt_abc');

    // Non-sensitive data survives, so the log stays useful.
    expect(output.email).toBe('a@b.test');
    expect(output.profile?.firstName).toBe('Ada');
  });

  it('matches keys case-insensitively', () => {
    const output = redact({ Password: 'x', PASSWORDHASH: 'y', accessToken: 'z' });
    const serialised = JSON.stringify(output);

    expect(serialised).not.toContain('"x"');
    expect(serialised).not.toContain('"y"');
    expect(serialised).not.toContain('"z"');
    expect(serialised).toContain('[REDACTED]');
  });

  it('honours per-call extra keys', () => {
    const output = redact(
      { pin: '1234', note: 'ok', secret: 's' },
      { extraKeys: ['note'] },
    ) as Record<string, string>;
    expect(output.pin).toBe('[REDACTED]'); // globally blocked
    expect(output.secret).toBe('[REDACTED]'); // globally blocked
    expect(output.note).toBe('[REDACTED]'); // blocked for this call only
    expect(JSON.stringify(output)).not.toContain('1234');
  });

  it('truncates long arrays', () => {
    const output = redact(Array.from({ length: 120 }, (_, i) => i)) as unknown[];
    expect(output.length).toBeLessThanOrEqual(51);
    expect(String(output.at(-1))).toContain('more item');
  });

  it('survives circular references', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(() => redact(node)).not.toThrow();
  });

  it('stops at maxDepth', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'bottom' } } } } } };
    expect(JSON.stringify(redact(deep, { maxDepth: 3 }))).toContain('MaxDepth');
  });

  it('never throws on exotic input', () => {
    for (const value of [undefined, null, 0, '', Number.NaN, Symbol('s'), () => undefined]) {
      expect(() => redact(value)).not.toThrow();
    }
  });

  it('serialises BigInt and Date to transport-safe forms', () => {
    const output = redact({ id: 10n, at: new Date('2026-01-01T00:00:00Z') }) as Record<
      string,
      string
    >;
    expect(output.id).toBe('10');
    expect(output.at).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('toTransport', () => {
  it('drops sensitive keys outright rather than masking them', () => {
    const output = toTransport({ passwordHash: 'x', keep: 1 }) as Record<string, unknown>;
    expect(output).not.toHaveProperty('passwordHash');
    expect(output).toHaveProperty('keep');
  });

  it('renders Prisma.Decimal as a string so JSON loses no precision', () => {
    const output = toTransport({ amount: new Prisma.Decimal('1234.56') }) as Record<string, string>;
    expect(output.amount).toBe('1234.56');
    expect(typeof output.amount).toBe('string');
  });

  it('recurses through arrays and nested objects', () => {
    const output = toTransport({
      items: [{ amount: new Prisma.Decimal('1.01'), passwordHash: 'leak' }],
    }) as { items: { amount: string; passwordHash?: string }[] };

    expect(output.items[0]?.amount).toBe('1.01');
    expect(output.items[0]).not.toHaveProperty('passwordHash');
  });

  it('converts BigInt to string — JSON.stringify would otherwise throw', () => {
    expect(() => JSON.stringify(toTransport({ n: 10n }))).not.toThrow();
    expect((toTransport({ n: 10n }) as { n: string }).n).toBe('10');
  });
});

describe('diffForAudit', () => {
  it('records only changed fields', () => {
    const { before, after } = diffForAudit(
      { title: 'Old', edition: '1st', status: 'ACTIVE' },
      { title: 'New', edition: '1st', status: 'ACTIVE' },
    );

    expect(before).toEqual({ title: 'Old' });
    expect(after).toEqual({ title: 'New' });
  });

  it('reports nothing when nothing changed', () => {
    const { before, after } = diffForAudit({ title: 'Same' }, { title: 'Same' });
    expect(before).toBeUndefined();
    expect(after).toBeUndefined();
  });

  it('never records a sensitive field even if it changed', () => {
    const { before, after } = diffForAudit({ passwordHash: 'old' }, { passwordHash: 'new' });

    expect(JSON.stringify({ before, after })).not.toContain('old');
    expect(JSON.stringify({ before, after })).not.toContain('new');
  });

  it('restricts to an explicit field allowlist when given one', () => {
    const { before, after } = diffForAudit(
      { title: 'A', secretNote: 'x' },
      { title: 'B', secretNote: 'y' },
      { fields: ['title'] },
    );

    expect(after).toEqual({ title: 'B' });
    expect(JSON.stringify({ before, after })).not.toContain('secretNote');
  });

  it('treats null and undefined as equivalent so no-op writes are not logged', () => {
    const { before, after } = diffForAudit({ edition: null }, { edition: undefined });
    expect(before).toBeUndefined();
    expect(after).toBeUndefined();
  });
});
