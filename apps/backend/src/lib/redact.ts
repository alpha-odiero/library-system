import { Prisma } from '@prisma/client';
import { NEVER_SERIALISE_FIELDS } from '../config/constants.js';

/**
 * Redaction is centralised so no call site can forget it.
 *
 * Three distinct needs:
 *   1. Log redaction paths (consumed by pino's `redact` option).
 *   2. API projections — the safest place to strip a field is to never select
 *      it, but where a wide object is already in hand we strip it defensively.
 *   3. Audit snapshots — before/after diffs must be safe to store for years.
 */

const BLOCKED_KEYS = new Set<string>(NEVER_SERIALISE_FIELDS.map((f) => f.toLowerCase()));

/** Pino redaction paths, covering nested objects and `data` payloads. */
export const REDACT_PATHS: readonly string[] = [
  'password',
  'passwordHash',
  'password_hash',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'token',
  'refreshToken',
  'accessToken',
  'tokenHash',
  'refreshTokenHash',
  'authorization',
  'cookie',
  'secret',
  'clientSecret',
  'consumerSecret',
  'passkey',
  'pin',
  'otp',
  'mpesaPin',
  'ssn',
  'nationalId',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.secret',
];

export interface RedactOptions {
  /** Extra keys to drop for this call site. */
  extraKeys?: readonly string[];
  /** Maximum depth; deeper objects are replaced with a marker rather than walked. */
  maxDepth?: number;
  /** Maximum array length retained, so a huge result set never lands in a log. */
  maxArrayLength?: number;
}

/**
 * Recursively removes sensitive keys and truncates large structures.
 *
 * Applied to log payloads and audit `before`/`after` snapshots. For API
 * responses prefer a purpose-built mapper (`publicUserDto`) — this is the
 * safety net, not the primary control.
 */
export function redact<T>(input: T, options: RedactOptions = {}): unknown {
  const { extraKeys = [], maxDepth = 6, maxArrayLength = 50 } = options;
  const blocked =
    extraKeys.length > 0
      ? new Set([...BLOCKED_KEYS, ...extraKeys.map((k) => k.toLowerCase())])
      : BLOCKED_KEYS;

  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object') return value;
    if (value instanceof Date) return value.toISOString();
    // Prisma.Decimal and Prisma.JsonNull must be handled before the generic
    // object walk: Decimal's internal fields (`d`, `e`, `s`) would otherwise be
    // logged in place of the amount.
    if (value instanceof Prisma.Decimal) return value.toString();
    if (value === Prisma.JsonNull || value === Prisma.DbNull) return null;
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (value instanceof Error) return { name: value.name, message: value.message };

    if (seen.has(value)) return '[Circular]';
    if (depth >= maxDepth) return '[MaxDepth]';
    seen.add(value);

    if (Array.isArray(value)) {
      const truncated = value.slice(0, maxArrayLength).map((item) => walk(item, depth + 1));
      return value.length > maxArrayLength
        ? [...truncated, `…${value.length - maxArrayLength} more item(s)`]
        : truncated;
    }

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (blocked.has(key.toLowerCase())) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = walk(item, depth + 1);
    }
    return out;
  };

  return walk(input, 0);
}

/** Prisma client results can contain Decimal/BigInt/Date; this normalises them for transport. */
export function toTransport(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  // instanceof (not a constructor-name check): Prisma bundles a minified
  // decimal.js whose constructor is named "i", so duck-typing on the name
  // silently leaks `{d,e,s}` internals instead of the amount.
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value === Prisma.JsonNull || value === Prisma.DbNull) return null;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map(toTransport);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (BLOCKED_KEYS.has(key.toLowerCase())) continue;
    out[key] = toTransport(item);
  }
  return out;
}

/**
 * Produces a before/after pair for the audit log containing only the fields
 * that actually changed, with sensitive keys already removed.
 */
export function diffForAudit(
  before: unknown,
  after: unknown,
  options?: { fields?: readonly string[] },
): { before: Prisma.InputJsonValue | undefined; after: Prisma.InputJsonValue | undefined } {
  const beforeObj = (before ?? {}) as Record<string, unknown>;
  const afterObj = (after ?? {}) as Record<string, unknown>;

  const keys =
    options?.fields ?? Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
  const cleanBefore: Record<string, unknown> = {};
  const cleanAfter: Record<string, unknown> = {};
  let changed = false;

  for (const key of keys) {
    if (BLOCKED_KEYS.has(key.toLowerCase())) continue;
    const b = beforeObj[key];
    const a = afterObj[key];
    if (JSON.stringify(b ?? null) === JSON.stringify(a ?? null)) continue;
    changed = true;
    if (b !== undefined) cleanBefore[key] = redact(b, { maxDepth: 3 });
    if (a !== undefined) cleanAfter[key] = redact(a, { maxDepth: 3 });
  }

  return {
    before: changed ? (cleanBefore as Prisma.InputJsonValue) : undefined,
    after: changed ? (cleanAfter as Prisma.InputJsonValue) : undefined,
  };
}
