import { randomUUID } from 'node:crypto';
import { prisma, withTransaction } from '../../config/database.js';
import { REVOCATION_REASONS, type RevocationReason } from '../../config/constants.js';
import { logger } from '../../config/logger.js';
import { isExpired } from '../../lib/dates.js';
import { unauthenticated } from '../../lib/errors.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
  signAccessToken,
  verifyAccessToken,
  type IssuedAccessToken,
} from './token.service.js';
import { burnVerificationCycles } from './password.service.js';
import { recordAudit } from '../audit/audit.service.js';

/**
 * Server-side sessions — the revocation authority.
 *
 * A signed access token cannot be taken back once issued, so it is never the
 * authority. `sessions` is: every authenticated request resolves its session id
 * against this table, and a row with `revoked_at` set (or `expires_at` past) is
 * rejected no matter how valid the signature is. That is what makes "log out
 * everywhere", password reset, and staff deactivation take effect immediately
 * rather than whenever the last access token happens to expire.
 *
 * ROTATION MODEL, and why the schema looks the way it does
 * ------------------------------------------------------
 * `sessions.refresh_token_hash` is UNIQUE — one hash per row. Rotation therefore
 * means CREATE a new row and REVOKE the old one, never overwrite in place, and
 * `family_id` is the lineage link. Reuse of an already-rotated token is
 * detectable only because the old row survives: its hash still matches, its
 * `revoked_at` is set, and that is a replay.
 *
 * Overwriting the hash in place would destroy exactly that evidence.
 *
 * `TOKEN_LIMITS.ROTATION_GRACE_SECONDS` is 0, so a second presentation of an
 * already-used token is treated as theft immediately and the whole family dies.
 * The consequence is deliberate but worth stating: two concurrent refreshes of
 * the same token (a user with the app open in two tabs, both firing at once)
 * will kill the family and log both tabs out. That is the documented,
 * standards-based behaviour (OAuth BCP §4.13.2 prefers a short grace window for
 * this exact race); narrowing it requires either a grace window or a lock on the
 * row during rotation.
 */

export interface SessionClientContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  deviceLabel?: string | null;
}

export interface IssuedSession {
  sessionId: string;
  familyId: string;
  access: IssuedAccessToken;
  refreshToken: string;
  /** When the refresh credential stops being accepted. */
  refreshExpiresAt: Date;
}

function refreshExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}

/**
 * Creates a session and its first credentials.
 *
 * `familyId` is generated here rather than defaulted: the column is a plain
 * `uuid` with no default, because a family's first member has no parent to
 * inherit a lineage from.
 */
export async function createSession(
  userId: string,
  roleCode: string,
  context: SessionClientContext = {},
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  const now = new Date();
  const expiresAt = refreshExpiry(now);

  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      familyId: randomUUID(),
      ip: context.ip ?? null,
      userAgent: context.userAgent?.slice(0, 1000) ?? null,
      deviceLabel: context.deviceLabel?.slice(0, 120) ?? null,
      issuedAt: now,
      lastUsedAt: now,
      expiresAt,
    },
    select: { id: true, familyId: true },
  });

  const access = await signAccessToken({ userId, sessionId: session.id, roleCode });

  return {
    sessionId: session.id,
    familyId: session.familyId,
    access,
    refreshToken,
    refreshExpiresAt: expiresAt,
  };
}

/** The session behind an opaque refresh token, including revoked ones. */
export interface SessionWithUser {
  id: string;
  userId: string;
  familyId: string;
  revokedAt: Date | null;
  revokedReason: string | null;
  expiresAt: Date;
  issuedAt: Date;
  user: {
    id: string;
    email: string;
    status: string;
    deletedAt: Date | null;
    lockedUntil: Date | null;
  };
}

export async function findSessionByRefreshToken(rawToken: string): Promise<SessionWithUser | null> {
  return prisma.session.findUnique({
    where: { refreshTokenHash: hashRefreshToken(rawToken) },
    select: {
      id: true,
      userId: true,
      familyId: true,
      revokedAt: true,
      revokedReason: true,
      expiresAt: true,
      issuedAt: true,
      user: {
        select: { id: true, email: true, status: true, deletedAt: true, lockedUntil: true },
      },
    },
  });
}

/**
 * Exchanges a refresh token for a new pair, rotating both.
 *
 * Three distinct failure modes, and the reuse case is the important one: a
 * rotated token presented again means either a replay or a stolen token, and the
 * only safe assumption is that the family is compromised, so every session in
 * it is revoked. The legitimate user is logged out; the attacker is evicted.
 */
export async function rotateRefreshToken(
  rawToken: string,
  context: SessionClientContext = {},
): Promise<IssuedSession> {
  const hash = hashRefreshToken(rawToken);
  const existing = await prisma.session.findUnique({
    where: { refreshTokenHash: hash },
    select: {
      id: true,
      userId: true,
      familyId: true,
      revokedAt: true,
      expiresAt: true,
      // Needed to re-sign the successor access token; a session may outlive a
      // role change, and the new token must carry the CURRENT role.
      user: { select: { role: { select: { code: true } } } },
    },
  });

  if (!existing) {
    // Spend comparable time to a real rotation so a probe cannot enumerate valid
    // tokens by measuring the response.
    await burnVerificationCycles();
    throw unauthenticated('Refresh token is not valid', 'TOKEN_INVALID');
  }

  if (existing.revokedAt !== null) {
    await revokeFamily(existing.familyId, REVOCATION_REASONS.REUSE_DETECTED);
    logger.warn(
      {
        event: 'auth.refresh_reuse_detected',
        familyId: existing.familyId,
        sessionId: existing.id,
        userId: existing.userId,
        ip: context.ip,
      },
      'Rotated refresh token replayed; entire session family revoked',
    );
    await recordAudit({
      // No dedicated enum value for a replay. `LOGOUT_ALL` is the accurate
      // description of the effect — every session in the family is now logged
      // out — and the incident detail lives in the description and the warn log
      // above. Adding a value would mean a schema migration, which is not worth
      // a status label; revisit when the audit taxonomy is next revised.
      action: 'LOGOUT_ALL',
      entityType: 'Session',
      entityId: existing.id,
      description: 'Reuse of a rotated refresh token revoked the whole session family',
      context,
    });
    throw unauthenticated('Refresh token has already been used', 'SESSION_REVOKED');
  }

  if (isExpired(existing.expiresAt)) {
    await revokeSession(existing.id, REVOCATION_REASONS.EXPIRED);
    throw unauthenticated('Session has expired', 'TOKEN_EXPIRED');
  }

  const nextToken = generateRefreshToken();
  const nextHash = hashRefreshToken(nextToken);
  const now = new Date();

  /**
   * Conditional on `revokedAt: null` rather than trusting the read above.
   *
   * Two simultaneous refreshes both read a live row; without this predicate both
   * would mint a successor and the family would fork into two valid lineages.
   * The second update matches zero rows, is rolled back, and its caller is
   * treated as a reuse — which is what it is.
   */
  const claimed = await withTransaction(async (tx) => {
    const revoked = await tx.session.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: REVOCATION_REASONS.ROTATED, lastUsedAt: now },
    });
    if (revoked.count !== 1) return null;

    const created = await tx.session.create({
      data: {
        userId: existing.userId,
        refreshTokenHash: nextHash,
        familyId: existing.familyId,
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 1000) ?? null,
        deviceLabel: context.deviceLabel?.slice(0, 120) ?? null,
        issuedAt: now,
        lastUsedAt: now,
        expiresAt: refreshExpiry(now),
      },
      select: { id: true, familyId: true },
    });
    return created;
  });

  if (!claimed) {
    await burnVerificationCycles();
    throw unauthenticated('Refresh token has already been used', 'SESSION_REVOKED');
  }

  const access = await signAccessToken({
    userId: existing.userId,
    sessionId: claimed.id,
    roleCode: existing.user.role.code,
  });

  return {
    sessionId: claimed.id,
    familyId: claimed.familyId,
    access,
    refreshToken: nextToken,
    refreshExpiresAt: refreshExpiry(now),
  };
}

/**
 * Revokes one session.
 *
 * A no-op when the session is already revoked: logout is idempotent, and calling
 * `update` on an already-revoked row would overwrite the reason a previous reuse
 * detection recorded — destroying incident history.
 */
export async function revokeSession(sessionId: string, reason: RevocationReason): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count === 1;
}

/** Revokes every live session in a rotation family. */
export async function revokeFamily(familyId: string, reason: RevocationReason): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

/**
 * Ends every session for a user.
 *
 * Called on password change, password reset, and deactivation. Note it revokes
 * ALL sessions rather than the current one: a password change is exactly the
 * moment a stolen credential must lose access, and exempting "this device"
 * would leave the attacker's session alive.
 */
export async function revokeAllForUser(userId: string, reason: RevocationReason): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

/**
 * Resolves an access token to a live session, or null.
 *
 * Returns null rather than throwing: the caller (`authenticate`) turns "no
 * session" into one 401 regardless of the reason, and a valid signature on a
 * revoked session is no more informative than a bad signature.
 *
 * Only the session row is read here. The account's status and deletion are
 * enforced by `buildPrincipal`, which `authenticate` calls with this function's
 * `userId` on every request and which fails closed on a missing, deleted, or
 * non-ACTIVE user. Joining the user here would repeat that query on the hottest
 * path in the system for a check the very next call already performs.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export async function resolveLiveSession(accessToken: string): Promise<{
  sessionId: string;
  userId: string;
} | null> {
  let claims;
  try {
    claims = await verifyAccessToken(accessToken);
  } catch {
    return null;
  }

  if (!isUuidLike(claims?.sid) || !isUuidLike(claims?.sub)) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (isExpired(session.expiresAt)) return null;

  // The token's subject must still match the session's owner. A mismatch means
  // either a signing-key compromise or a token crafted against a valid session
  // id; either way it is not a session this server issued.
  if (claims.sub !== session.userId) return null;

  return { sessionId: session.id, userId: session.userId };
}

/**
 * Records activity against a session.
 *
 * Best-effort and rate-limited by the caller: `lastUsedAt` is for display and
 * session management, not for authorization. Writing it on every single request
 * would turn a read-mostly table into the hottest write in the system to
 * maintain a field nobody reads at second resolution.
 */
export async function touchSession(sessionId: string): Promise<void> {
  try {
    await prisma.session.update({
      where: { id: sessionId },
      data: { lastUsedAt: new Date() },
    });
  } catch (error) {
    logger.warn(
      { err: error, event: 'auth.session_touch_failed', sessionId },
      'Session touch failed',
    );
  }
}

/** Session rows for the "your devices" view. */
export async function listSessionsForUser(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      ip: true,
      userAgent: true,
      deviceLabel: true,
      issuedAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    orderBy: { lastUsedAt: 'desc' },
  });
}

/**
 * Deletes expired and long-revoked rows. Run by the `SESSION_PURGE_CRON` job.
 *
 * Revoked rows are retained for a grace period rather than deleted immediately:
 * they are the evidence that a reuse was detected, and an investigation happens
 * days later, not seconds later.
 */
export async function purgeStaleSessions(revokedRetentionDays = 30): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - revokedRetentionDays * 86_400_000);
  const result = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null, lt: cutoff } }],
    },
  });
  return { deleted: result.count };
}

/** Live session count, for the health endpoint and admin views. */
export async function countActiveSessions(): Promise<number> {
  return prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } });
}
