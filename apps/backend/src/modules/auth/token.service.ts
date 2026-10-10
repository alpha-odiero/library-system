import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../../config/env.js';
import { parseDurationToSeconds, addSeconds } from '../../lib/dates.js';
import { AppError, unauthenticated } from '../../lib/errors.js';
import type { ApiErrorCode } from '@lms/shared';

/**
 * Credentials.
 *
 * TWO credentials, deliberately different in kind:
 *
 *   • ACCESS  — a short-lived (15 min) signed JWT delivered in an HttpOnly,
 *              SameSite=Lax cookie. Carries the session id so the server can
 *              still revoke it. Signed with `JWT_SECRET`.
 *
 *   • REFRESH — an opaque 256-bit random string. Only its SHA-256 is stored, in
 *              `sessions.refresh_token_hash`, so a database disclosure yields
 *              nothing usable. Rotates on every use.
 *
 * Why the access token is a JWT AND the session is still checked on every
 * request: a JWT alone cannot be revoked. The signature makes the token cheap to
 * reject without a lookup, but the authoritative revocation record is the
 * `sessions` row, and `authenticate()` reads it. That is why the access TTL is
 * capped at 60 minutes by the environment schema — it bounds how long a stale
 * permission grant could survive if the row check were ever removed.
 *
 * Why the refresh token is NOT a JWT: it must be revocable server-side and its
 * claims are not needed. Signing it would add a key to the blast radius and buy
 * nothing, because the server already looks the row up on every use.
 */

/** The secret as a KeyObject for `jose`. `BufferSource` is what jose v6 wants. */
const accessSecret = new TextEncoder().encode(env.JWT_SECRET);

const ISSUER = 'lms-api';
const AUDIENCE = 'lms-web';

/** Access-token lifetime in seconds, parsed from the same value env validates. */
export const ACCESS_TOKEN_TTL_SECONDS = parseDurationToSeconds(env.ACCESS_TOKEN_TTL);

export const REFRESH_TOKEN_TTL_DAYS = env.REFRESH_TOKEN_TTL_DAYS;
export const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_DAYS * 86_400;

/** Claims carried by the access token. Deliberately minimal. */
export interface AccessTokenClaims {
  /** `users.id` */
  sub: string;
  /** `sessions.id` — the revocation anchor. */
  sid: string;
  /** Role code, for logging and fast branch-scope hints. Not an authorization input. */
  role: string;
  /** Unique token id, so two tokens issued in the same second differ. */
  jti: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
  expiresInSeconds: number;
}

/**
 * Issues the signed access token.
 *
 * No permission list is embedded. Permissions change (a role grant is revoked,
 * a user is suspended) and a token carrying a stale copy would keep working until
 * it expired; reading them from the database per request costs one indexed join
 * and cannot drift.
 */
export async function signAccessToken(input: {
  userId: string;
  sessionId: string;
  roleCode: string;
}): Promise<IssuedAccessToken> {
  const now = new Date();
  const expiresAt = addSeconds(now, ACCESS_TOKEN_TTL_SECONDS);
  const jti = randomBytes(12).toString('hex');

  const token = await new SignJWT({ sid: input.sessionId, role: input.roleCode })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(jti)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(accessSecret);

  return { token, expiresAt, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Verifies the signature, algorithm, issuer, audience and expiry.
 *
 * `algorithms: ['HS256']` is set EXPLICITLY. `jose` would otherwise consider the
 * algorithm from the token's own header, and accepting whatever is named is the
 * `alg: none` / algorithm-confusion class of bug: an attacker could present a
 * token signed with a public key or with no signature at all.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      // The library applies `exp`/`nbf` itself; `clockTolerance` absorbs the
      // few hundred milliseconds of skew between hosts rather than rejecting a
      // token that is genuinely still valid.
      clockTolerance: 5,
    });

    const sub = payload.sub;
    const sid = payload['sid'];
    const role = payload['role'];

    if (typeof sub !== 'string' || typeof sid !== 'string' || typeof role !== 'string') {
      throw unauthenticated('Malformed session token', 'TOKEN_INVALID');
    }

    return { sub, sid, role, jti: typeof payload.jti === 'string' ? payload.jti : '' };
  } catch (error) {
    // `unauthenticated` is a factory, not a class, so the class must be checked
    // here — `instanceof unauthenticated` is not even a valid runtime expression.
    if (error instanceof AppError) throw error;
    if (error instanceof joseErrors.JWTExpired) {
      throw unauthenticated('Session token has expired', 'TOKEN_EXPIRED');
    }
    // Signature failure, wrong issuer, wrong audience, malformed — all the same
    // answer. Distinguishing them tells an attacker exactly which part of a
    // forged token to change.
    throw unauthenticated('Session token is not valid', 'TOKEN_INVALID');
  }
}

/* ── Refresh tokens ────────────────────────────────────────────────────────── */

/**
 * Generates a refresh token.
 *
 * 32 bytes from the CSPRNG, URL-safe base64. Not a JWT and not derived from
 * anything else: derivation from a user id or a timestamp would let a value be
 * recomputed from data an attacker can already see.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hashes a refresh token for storage.
 *
 * SHA-256, not Argon2. This is not a password: it is a 256-bit random value with
 * no guessable structure, so there is nothing to brute-force and no need to spend
 * 19 MiB per verification on a hot path. Argon2 here would add latency without
 * adding security.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison for opaque tokens.
 *
 * The default `===` on a hash leaks its length-prefix mismatch position through
 * timing. `timingSafeEqual` requires equal lengths, so the length check happens
 * first and the contents are compared in constant time.
 */
export function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/* ── One-time tokens (password reset, email verification) ──────────────────── */

/**
 * Issues a single-use token.
 *
 * 32 bytes, URL-safe, so a value can travel in a query string or a URL path
 * without escaping. Only the SHA-256 is stored, on `password_reset_tokens` /
 * `email_verification_tokens`.
 */
export function generateOneTimeToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: createHash('sha256').update(token).digest('hex') };
}

/**
 * Hashes an EXISTING one-time token for lookup.
 *
 * `generateOneTimeToken` mints a new value and returns its hash; this is the
 * inverse direction, needed when redeeming a token the client sent back. Same
 * SHA-256, same reasoning: the token is 256 bits of CSPRNG output, so there is
 * nothing to brute-force.
 */
export function hashOneTimeToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Burns cycles on an unknown one-time token.
 *
 * The reset endpoint is unauthenticated, so "no such token" must cost the same
 * as "expired" or "already used" — otherwise it is a token oracle.
 */
export async function burnOneTimeTokenCycles(): Promise<void> {
  const { burnVerificationCycles } = await import('./password.service.js');
  await burnVerificationCycles();
}

/** Maps a JWT verification failure to the code the client branches on. */
export function tokenErrorCode(error: unknown): ApiErrorCode {
  if (error instanceof joseErrors.JWTExpired) return 'TOKEN_EXPIRED';
  return 'TOKEN_INVALID';
}
