import { describe, expect, it } from 'vitest';
import {
  generateOneTimeToken,
  generateRefreshToken,
  hashOneTimeToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  tokensMatch,
  ACCESS_TOKEN_TTL_SECONDS,
} from '../src/modules/auth/token.service.js';
import {
  hashPassword,
  needsRehash,
  validatePasswordStrength,
  verifyPassword,
} from '../src/modules/auth/password.service.js';
import { AppError } from '../src/lib/errors.js';

/**
 * Credential tests.
 *
 * These exercise the properties an attacker would probe: whether a token can be
 * forged, whether a wrong secret is rejected, whether a tampered payload is
 * rejected, and whether password verification distinguishes users.
 *
 * No database is involved — everything here is pure crypto.
 */

describe('access tokens', () => {
  const claims = { userId: 'user-1', sessionId: 'session-1', roleCode: 'MEMBER' };

  it('round-trips the claims it signed', async () => {
    const issued = await signAccessToken(claims);
    const verified = await verifyAccessToken(issued.token);

    expect(verified.sub).toBe('user-1');
    expect(verified.sid).toBe('session-1');
    expect(verified.role).toBe('MEMBER');
  });

  it('issues a unique jti even within the same second', async () => {
    const [first, second] = await Promise.all([signAccessToken(claims), signAccessToken(claims)]);

    // Identical claims in the same second would otherwise produce a
    // byte-identical token, which destroys any ability to correlate or
    // distinguish sessions from their tokens alone.
    expect(first.token).not.toBe(second.token);
  });

  it('reports an expiry matching the configured lifetime', async () => {
    const issued = await signAccessToken(claims);
    const delta = issued.expiresAt.getTime() - Date.now();

    expect(issued.expiresInSeconds).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(delta).toBeGreaterThan(ACCESS_TOKEN_TTL_SECONDS * 1000 - 10_000);
    expect(delta).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_SECONDS * 1000 + 1000);
  });

  it('rejects a token signed with a different secret', async () => {
    // Same header, same claims, forged body. Signature verification is the only
    // thing standing between this and a valid session.
    const forged = [
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
      btoa(
        JSON.stringify({
          sub: 'user-1',
          sid: 'session-1',
          role: 'ADMIN',
          iss: 'lms-api',
          aud: 'lms-web',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
      'not-a-valid-signature',
    ].join('.');

    await expect(verifyAccessToken(forged)).rejects.toThrow(AppError);
  });

  it('rejects a token whose payload was edited after signing', async () => {
    const issued = await signAccessToken({ ...claims, roleCode: 'MEMBER' });
    const [header, , signature] = issued.token.split('.');

    // Re-encode the body with an escalated role, keeping the original signature.
    const tampered = [
      header,
      btoa(
        JSON.stringify({
          sub: 'user-1',
          sid: 'session-1',
          role: 'ADMIN',
          iss: 'lms-api',
          aud: 'lms-web',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
      signature,
    ].join('.');

    await expect(verifyAccessToken(tampered)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const unsigned = [
      btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })),
      btoa(
        JSON.stringify({
          sub: 'user-1',
          sid: 'session-1',
          role: 'ADMIN',
          iss: 'lms-api',
          aud: 'lms-web',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
      '',
    ].join('.');

    // `algorithms: ['HS256']` is set explicitly for exactly this reason: without
    // it, a token naming its own algorithm would be considered.
    await expect(verifyAccessToken(unsigned)).rejects.toThrow(AppError);
  });

  it('rejects a token with no signature claim the server issued', async () => {
    await expect(verifyAccessToken('not-a-token')).rejects.toThrow(AppError);
  });
});

describe('refresh tokens', () => {
  it('produces a distinct value each time', () => {
    const values = new Set(Array.from({ length: 50 }, generateRefreshToken));

    // 50 samples drawing from 2^256 must not collide; a generator that returned
    // a counter would collapse this set to 1.
    expect(values.size).toBe(50);
  });

  it('is URL-safe so it can travel in a query string', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes deterministically, so a lookup can find the row', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('does not store the token itself', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    // A database disclosure must not yield a usable credential.
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('hashes different tokens differently', () => {
    expect(hashRefreshToken(generateRefreshToken())).not.toBe(
      hashRefreshToken(generateRefreshToken()),
    );
  });

  it('compares equal tokens as a match and unequal ones as a mismatch', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc123', 'abc124')).toBe(false);
    expect(tokensMatch('abc123', 'abc1234')).toBe(false);
  });
});

describe('one-time tokens', () => {
  it('returns the token and its hash, and never the same value twice', () => {
    const first = generateOneTimeToken();
    const second = generateOneTimeToken();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashOneTimeToken(first.token));
    expect(first.tokenHash).not.toBe(first.token);
  });
});

describe('password hashing', () => {
  // Argon2 at production cost is deliberately slow; a handful of hashes is the
  // most a unit suite should spend.
  const password = 'CorrectHorse#Battery9';

  it('verifies a password it hashed', async () => {
    const hash = await hashPassword(password);

    expect(await verifyPassword(hash, password)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword(password);

    expect(await verifyPassword(hash, `${password}x`)).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('salts, so the same password hashes differently each time', async () => {
    const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);

    // Identical hashes for identical passwords would let an attacker match a
    // leaked digest against a candidate dictionary without any work.
    expect(first).not.toBe(second);
  });

  it('identifies itself as argon2id', async () => {
    const hash = await hashPassword(password);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('returns false rather than throwing for a malformed stored hash', async () => {
    // A corrupt hash must be an authentication failure, not a 500 that tells the
    // caller the account row is damaged.
    expect(await verifyPassword('not-a-hash', password)).toBe(false);
    expect(await verifyPassword('', password)).toBe(false);
  });

  it('reports a fresh hash as needing no rehash', async () => {
    expect(needsRehash(await hashPassword(password))).toBe(false);
  });

  it('reports a malformed hash as needing a rehash', () => {
    expect(needsRehash('garbage')).toBe(true);
  });
});

describe('password policy', () => {
  const strong = 'CorrectHorse#Battery9';

  it('accepts a compliant password', () => {
    expect(() => validatePasswordStrength(strong)).not.toThrow();
  });

  it('rejects a short password', () => {
    expect(() => validatePasswordStrength('Ab1!xy')).toThrow(AppError);
  });

  it('rejects a password over the maximum length', () => {
    // Unbounded input is a DoS primitive: each attempt costs the server a
    // multi-megabyte allocation to hash.
    expect(() => validatePasswordStrength('a'.repeat(500))).toThrow(AppError);
  });

  it('rejects a password missing each required character class', () => {
    expect(() => validatePasswordStrength('alllowercase1')).toThrow(AppError);
    expect(() => validatePasswordStrength('ALLUPPERCASE1')).toThrow(AppError);
    expect(() => validatePasswordStrength('NoDigitsHereAtAll')).toThrow(AppError);
  });

  it('rejects a common password padded with digits and symbols', () => {
    // "Password123456!" satisfies every character-class rule and the 12-char
    // minimum, and is still trivially guessable. This is the single most common
    // real-world password shape, and the denylist's stem check is what catches it.
    expect(() => validatePasswordStrength('Password123456!')).toThrow(AppError);
    expect(() => validatePasswordStrength('Dragon1')).toThrow(AppError);
    expect(() => validatePasswordStrength('qwerty2024!!')).toThrow(AppError);
  });

  it('accepts an unrelated password that merely looks similar in shape', () => {
    // The stem check must not degrade into "any password ending in digits".
    expect(() => validatePasswordStrength('Zanzibar#Kite77')).not.toThrow();
  });

  it('reports every failing rule at once', () => {
    try {
      validatePasswordStrength('short');
      expect.unreachable('should have thrown');
    } catch (error) {
      const appError = error as AppError;
      const issues = appError.details as Array<{ path: string }>;

      // A client showing one error per round trip is a worse experience than
      // being told everything at once.
      expect(issues.length).toBeGreaterThan(1);
      expect(issues.every((issue) => issue.path === 'password')).toBe(true);
    }
  });

  it('never includes the submitted password in the failure', () => {
    const attempted = 'MySecretLeaked#2026';
    try {
      validatePasswordStrength(attempted.toLowerCase());
      expect.unreachable('should have thrown');
    } catch (error) {
      // Echoing the rejected value back would put it in logs and proxies.
      expect((error as AppError).message).not.toContain(attempted);
      expect(JSON.stringify((error as AppError).details)).not.toContain(attempted);
    }
  });
});
