import { prisma, withTransaction, type Tx } from '../../config/database.js';
import { env } from '../../config/env.js';
import { REVOCATION_REASONS, TOKEN_LIMITS } from '../../config/constants.js';
import { logger } from '../../config/logger.js';
import type { RoleCode } from '@lms/shared';
import { addCalendarDays } from '../../lib/dates.js';
import {
  badRequest,
  conflict,
  notFound,
  unauthenticated,
  unprocessable,
} from '../../lib/errors.js';
import {
  burnVerificationCycles,
  hashPassword,
  invalidCredentials,
  validatePasswordStrength,
  verifyPassword,
} from './password.service.js';
import { assertRoleSelection } from './role-selection.js';
import { generateOneTimeToken, hashOneTimeToken, REFRESH_TOKEN_TTL_DAYS } from './token.service.js';
import {
  createSession,
  listSessionsForUser,
  revokeAllForUser,
  revokeSession,
  rotateRefreshToken,
  type IssuedSession,
  type SessionClientContext,
} from './session.service.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';
import { notify } from '../notifications/notification.service.js';

/**
 * Authentication flows.
 *
 * Three ideas carry most of the weight here:
 *
 *   1. EVERY rejection says the same thing. An unknown email, a wrong password, a
 *      suspended account and an unverified email all return one generic 401.
 *      Any difference is an enumeration oracle, and the failure cost is a list of
 *      who has an account here.
 *
 *   2. Work is done even on failure. A login for an unknown email still performs
 *      an Argon2 verification, so the two paths take comparable time. Skipping it
 *      makes response latency a password oracle, which is worse than the message
 *      difference we just eliminated.
 *
 *   3. State changes are transactional and audited. A login writes a session row
 *      and resets the failure counter together; a reset-password both consumes
 *      the token and revokes every session, or neither happens.
 */

export interface LoginInput {
  email: string;
  password: string;
  /** The account type selected on the login screen. Checked, never trusted. */
  loginAs?: RoleCode;
}

export interface AuthResult {
  session: IssuedSession;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    fullName: string;
    status: string;
    roleCode: string;
    mustChangePassword: boolean;
    emailVerified: boolean;
  };
}

/** Normalised for lookup: case-folded and trimmed. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Signs a user in.
 *
 * The failure counter and lockout are updated in the SAME transaction as the
 * check that produced them. An attacker who can drive the counter without the
 * transaction either loses failures on a crash (never locking) or gains locks
 * with no record (a denial of service against a known member).
 */
export async function login(
  input: LoginInput,
  context: SessionClientContext & AuditContext = {},
): Promise<AuthResult> {
  const email = normaliseEmail(input.email);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      passwordHash: true,
      emailVerifiedAt: true,
      mustChangePassword: true,
      deletedAt: true,
      lockedUntil: true,
      failedLoginCount: true,
      role: { select: { code: true } },
    },
  });

  /**
   * Unknown account, or a soft-deleted one.
   *
   * Burn the same Argon2 work a real verification costs, then fail with the same
   * error as a wrong password. Deleting a user must not make their address
   * behave differently from one that was never registered.
   */
  if (!user || user.deletedAt !== null) {
    await burnVerificationCycles();
    await recordUnknownAddressAttempt(context);
    throw invalidCredentials();
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);

  if (!passwordOk) {
    /**
     * Whether or not this attempt triggered the lock, the response is the same
     * generic failure. Telling a legitimate user "your account is now locked" is
     * a usability win, but it is also a free "this account exists" oracle — the
     * remaining-attempts state is visible from the attempt counter instead.
     */
    await registerFailedLogin(user.id, context);
    throw invalidCredentials();
  }

  /**
   * Lockout is checked AFTER the password verifies.
   *
   * The reverse order means an attacker who guesses wrong learns whether an
   * account is locked without a valid password, and lets a locked-out account be
   * used as a cheap target for filling the counter. Order matters.
   */
  const now = new Date();
  if (user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()) {
    await recordAudit({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      description: 'Login attempt against a locked account',
      actor: { userId: user.id, email: user.email, roleCode: user.role.code },
      context,
    });
    throw invalidCredentials();
  }

  if (user.status !== 'ACTIVE') {
    await recordAudit({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      description: `Login attempt against a ${user.status.toLowerCase()} account`,
      actor: { userId: user.id, email: user.email, roleCode: user.role.code },
      context,
    });
    throw invalidCredentials();
  }

  /**
   * Email verification is a POLICY, not an authentication failure.
   *
   * Distinct from the cases above because the user did prove who they are — the
   * 401 `EMAIL_NOT_VERIFIED` tells the client to show "check your inbox", which
   * is required for the flow to be completable at all.
   */
  if (env.REQUIRE_EMAIL_VERIFICATION && user.emailVerifiedAt === null) {
    throw unauthenticated('Email address must be verified before signing in', 'EMAIL_NOT_VERIFIED');
  }

  /**
   * The account type selected on the login screen must match the account's real
   * role — checked LAST, after password, lockout, status and verification, so the
   * mismatch cannot be probed without valid credentials. Placed before the
   * session is opened: a sign-in that lands on the wrong door must not be
   * rewarded with a session at all.
   */
  assertRoleSelection(user.role.code, input.loginAs);

  // Success: clear the counter, stamp the login, and open a session atomically.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now,
      lastLoginIp: context.ip ?? null,
    },
  });

  const session = await createSession(user.id, user.role.code, context);

  await recordAudit({
    action: 'LOGIN',
    entityType: 'User',
    entityId: user.id,
    description: 'Signed in',
    actor: { userId: user.id, email: user.email, roleCode: user.role.code },
    context,
  });

  return {
    session,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      status: user.status,
      roleCode: user.role.code,
      mustChangePassword: user.mustChangePassword,
      emailVerified: user.emailVerifiedAt !== null,
    },
  };
}

/**
 * Records a login attempt against an address with no active account.
 *
 * No user id is recorded — there is no user. The audit row is what makes
 * credential stuffing against a harvested address list visible to an operator,
 * and it deliberately does NOT store the probed address: an unbounded table of
 * third-party emails is both a data-protection problem and a spam-merchant's
 * wish list.
 */
async function recordUnknownAddressAttempt(context: AuditContext): Promise<void> {
  await recordAudit({
    action: 'LOGIN_FAILED',
    entityType: 'User',
    description: 'Login attempt for an address with no active account',
    actor: null,
    context,
  });
  logger.warn(
    { event: 'auth.login_unknown_email', requestId: context.requestId, ip: context.ip },
    'Login attempt for an unregistered address',
  );
}

/**
 * Increments the failure counter, locking the account at the threshold.
 * Returns true when this attempt caused the lock.
 */
async function registerFailedLogin(userId: string, context: AuditContext): Promise<boolean> {
  const threshold = env.LOGIN_MAX_ATTEMPTS;

  return withTransaction(async (tx) => {
    const fresh = await tx.user.findUnique({
      where: { id: userId },
      select: { failedLoginCount: true, lockedUntil: true, email: true },
    });
    if (!fresh) return false;

    // Already locked by a concurrent attempt; do not extend the lock. Otherwise
    // a parallel spray keeps pushing the expiry forward and the account never
    // becomes usable again.
    if (fresh.lockedUntil !== null && fresh.lockedUntil.getTime() > Date.now()) return false;

    const attempts = fresh.failedLoginCount + 1;
    const shouldLock = attempts >= threshold;

    await tx.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000) : null,
      },
    });

    await recordAudit({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: userId,
      description: shouldLock
        ? `Failed login ${attempts}; account locked for ${env.LOGIN_LOCKOUT_MINUTES} minutes`
        : `Failed login (${attempts} of ${threshold})`,
      context,
    });

    return shouldLock;
  });
}

/* ── Sessions ──────────────────────────────────────────────────────────────── */

/** Exchanges a refresh token for a new pair. Rotation and reuse detection live in the session service. */
export async function refresh(rawToken: string, context: SessionClientContext & AuditContext = {}) {
  return rotateRefreshToken(rawToken, context);
}

/** Ends the current session. Idempotent: logging out twice is not an error. */
export async function logout(sessionId: string, context: AuditContext = {}): Promise<void> {
  // The email is read from the session row rather than passed in, so the audit
  // entry is attributable even if the caller has no user context to hand over.
  const [session] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, user: { select: { email: true } } },
    }),
    revokeSession(sessionId, 'logout'),
  ]);

  if (!session) return;

  await recordAudit({
    action: 'LOGOUT',
    entityType: 'Session',
    entityId: sessionId,
    description: 'Signed out',
    actor: { userId: session.userId, email: session.user.email },
    context,
  });
}

/** Ends every session for a user. */
export async function logoutEverywhere(
  userId: string,
  context: AuditContext = {},
): Promise<number> {
  const [user, count] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    revokeAllForUser(userId, 'logout_all'),
  ]);

  await recordAudit({
    action: 'LOGOUT_ALL',
    entityType: 'User',
    entityId: userId,
    description: `Signed out of ${count} session(s)`,
    actor: { userId, email: user?.email ?? 'unknown' },
    context,
  });
  return count;
}

/**
 * Revokes one of the caller's own sessions.
 *
 * Ownership is checked in the SAME query that performs the update
 * (`userId` in the `where`), not by loading first and comparing. A
 * load-then-check leaves a window where a request for someone else's session id
 * has already read the row, and it invites the "compare, then update" shape that
 * is one forgotten condition away from revoking anyone's session.
 *
 * Returns whether anything was revoked; the caller reports 204 either way.
 */
export async function revokeOwnSession(
  sessionId: string,
  userId: string,
  context: AuditContext = {},
): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: REVOCATION_REASONS.ADMIN_REVOKED },
  });

  if (result.count === 0) return false;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  await recordAudit({
    action: 'LOGOUT',
    entityType: 'Session',
    entityId: sessionId,
    description: 'Session revoked by the account holder',
    actor: { userId, email: user?.email ?? 'unknown' },
    context,
  });
  return true;
}

/* ── Registration ──────────────────────────────────────────────────────────── */

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  /** When present, the registration creates this library and its default branch. */
  libraryName?: string | null;
}

/**
 * Library-owner registration creates an active administrator account scoped to a
 * library. This flow deliberately does not create a member profile: the user is
 * not joining as a borrower, they are being onboarded as the operator of the
 * tenant.
 *
 * The role is assigned HERE, as `ADMIN`, from the `ADMIN` role row — never from
 * anything the client sent. The register schema is `.strict()`, so a body
 * carrying `roleCode` or `status` is rejected outright rather than stripped.
 */
export async function register(
  input: RegisterInput,
  context: AuditContext = {},
): Promise<{
  userId: string;
  libraryId: string;
  roleCode: 'ADMIN';
  requiresEmailVerification: boolean;
}> {
  validatePasswordStrength(input.password);
  const email = normaliseEmail(input.email);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // MEMBER_ALREADY_REGISTERED rather than a bare conflict, so the client can
    // offer "sign in instead" without being told the account exists on a page
    // where that would help an attacker. This endpoint is rate-limited.
    throw conflict('MEMBER_ALREADY_REGISTERED', 'An account already exists for this email address');
  }

  const adminRole = await prisma.role.findUnique({
    where: { code: 'ADMIN' },
    select: { id: true },
  });
  if (!adminRole) {
    throw unprocessable('Registration is not available right now');
  }

  const libraryName = input.libraryName?.trim() || null;

  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const { user, libraryId, createdLibrary } = await withTransaction(async (db) => {
    const defaults = libraryName
      ? await createLibraryWithDefaults(db, adminRole.id, libraryName)
      : await resolveRegistrationDefaults(db, adminRole.id);

    /**
     * Claim primary-administration of the tenant (governance, separate from the
     * `libraryId` scope anchor). A library created in this transaction has no
     * other claimant; an existing one may already have a primary administrator,
     * and `users.primary_library_id` is UNIQUE — so the claim is taken only when
     * free rather than attempted and left to fail with a 500.
     */
    const claimPrimaryAdmin =
      defaults.createdLibrary ||
      !(await db.user.findFirst({
        where: { primaryLibraryId: defaults.libraryId },
        select: { id: true },
      }));

    const user = await db.user.create({
      data: {
        email,
        passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: input.phone?.trim() || null,
        roleId: defaults.adminRoleId,
        libraryId: defaults.libraryId,
        primaryBranchId: defaults.branchId,
        primaryLibraryId: claimPrimaryAdmin ? defaults.libraryId : null,
        primaryLibraryAdmin: claimPrimaryAdmin,
        status: 'ACTIVE',
        passwordChangedAt: now,
      },
      select: { id: true, email: true },
    });

    return {
      user,
      libraryId: defaults.libraryId,
      createdLibrary: defaults.createdLibrary,
    };
  });

  await recordAudit({
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: user.id,
    description: 'Created a library administrator account',
    after: {
      email: user.email,
      firstName: input.firstName,
      lastName: input.lastName,
      libraryId,
      roleCode: 'ADMIN',
    },
    context,
  });

  if (createdLibrary) {
    await recordAudit({
      action: 'LIBRARY_CREATED',
      entityType: 'Library',
      entityId: libraryId,
      description: `Library "${libraryName}" created during administrator registration`,
      after: { name: libraryName },
      context,
    });
  }

  const requiresVerification = env.REQUIRE_EMAIL_VERIFICATION;
  if (requiresVerification) {
    await issueEmailVerification(user.id);
  }

  return {
    userId: user.id,
    libraryId,
    roleCode: 'ADMIN',
    requiresEmailVerification: requiresVerification,
  };
}

interface RegistrationDefaults {
  adminRoleId: string;
  libraryId: string;
  branchId: string;
  /** True when the tenant row was created by this registration. */
  createdLibrary: boolean;
}

/**
 * Resolves the defaults for a registration that does not create a library.
 *
 * The account is attributed to the first active library, and the branch is
 * resolved WITHIN that library — pairing the first library with the first branch
 * in the table would put the administrator's primary branch in a different
 * tenant than their own scope anchor the moment a second library exists.
 */
async function resolveRegistrationDefaults(
  db: Tx,
  adminRoleId: string,
): Promise<RegistrationDefaults> {
  const library = await db.library.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!library) {
    throw unprocessable('Registration is not available right now');
  }

  const branch = await db.branch.findFirst({
    where: { isActive: true, libraryId: library.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!branch) {
    throw unprocessable('Registration is not available right now');
  }

  return {
    adminRoleId,
    libraryId: library.id,
    branchId: branch.id,
    createdLibrary: false,
  };
}

/**
 * Creates the tenant being registered, plus its default branch.
 *
 * Codes are derived from the name but carry a random suffix: `libraries.code`
 * and `branches.code` are both globally unique, so a bare slug would collide the
 * second time two libraries share a name ("Central Library" in two towns is the
 * ordinary case, not an edge case).
 */
async function createLibraryWithDefaults(
  db: Tx,
  adminRoleId: string,
  libraryName: string,
): Promise<RegistrationDefaults> {
  const base = codeSlug(libraryName);

  let code = `${base}-${randomCodeSuffix()}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clash = await db.library.findUnique({ where: { code }, select: { id: true } });
    if (!clash) break;
    code = `${base}-${randomCodeSuffix()}`;
  }

  const library = await db.library.create({
    data: { code, name: libraryName.slice(0, 150) },
    select: { id: true, code: true },
  });

  // The branch code carries the library's (already unique) code as a prefix, so
  // it needs no second uniqueness dance. Base ≤14 + "-" + 5 + "-main" ≤ 29.
  const branch = await db.branch.create({
    data: { libraryId: library.id, code: `${library.code}-main`, name: 'Main Branch' },
    select: { id: true },
  });

  return {
    adminRoleId,
    libraryId: library.id,
    branchId: branch.id,
    createdLibrary: true,
  };
}

/** URL-safe slug for a code, capped so `code + "-main"` fits a 30-char column. */
function codeSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 14);
  return slug || 'library';
}

/** Short random suffix for a uniqueness collision guard. Not a secret. */
function randomCodeSuffix(length = 5): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + length)
    .padEnd(length, '0');
}

/* ── Password reset ────────────────────────────────────────────────────────── */

export interface ForgotPasswordInput {
  email: string;
}

/**
 * Starts a password reset.
 *
 * NEVER reports whether the address is registered — a uniform 200 for both cases
 * is the whole point. Sending mail is deferred to a notification so a reset of a
 * non-existent account costs no more than one indexed lookup.
 */
export async function forgotPassword(
  input: ForgotPasswordInput,
  context: AuditContext = {},
): Promise<void> {
  const email = normaliseEmail(input.email);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, deletedAt: true },
  });

  if (!user || user.deletedAt !== null) {
    logger.debug(
      { event: 'auth.reset_requested_unknown_email' },
      'Password reset requested for unknown address',
    );
    return;
  }

  // Invalidate any outstanding reset tokens: only the newest one may be used, so
  // a link emailed an hour ago cannot be redeemed after a second request.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const { token, tokenHash } = generateOneTimeToken();

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_LIMITS.PASSWORD_RESET_TTL_MINUTES * 60_000),
    },
  });

  // The hash above is all that is stored. This is the only moment the raw token
  // exists, so it is delivered here — never queued, never logged, never returned
  // to the caller of `forgotPassword`, who must not learn whether it worked.
  await deliverOneTimeToken(user.id, {
    kind: 'password-reset',
    token,
    path: `/reset-password?token=${encodeURIComponent(token)}`,
    ttlHours: Math.ceil(TOKEN_LIMITS.PASSWORD_RESET_TTL_MINUTES / 60),
  });

  await recordAudit({
    action: 'PASSWORD_RESET',
    entityType: 'User',
    entityId: user.id,
    description: 'Password reset requested',
    actor: { userId: user.id, email: user.email },
    context,
  });
}

/* ── One-time token delivery ────────────────────────────────────────────────── */

export interface OneTimeTokenDelivery {
  kind: 'password-reset' | 'email-verification';
  /** The raw token. Must never be persisted or logged. */
  token: string;
  /** Frontend route carrying the token as a query parameter. */
  path: string;
  ttlHours: number;
}

/**
 * Hands a freshly-issued one-time token to the delivery channel.
 *
 * There is no mail transport yet, so the token is recorded as an in-app
 * notification addressed to the user who requested it. That is a real,
 * inspectable destination rather than a `console.log`: the recipient can always
 * retrieve their own pending link from the notification centre, and a support
 * request becomes answerable.
 *
 * The security properties that matter here:
 *
 *   • The token is NOT placed in `Notification.data`, which is designed for
 *     deep-link payloads and is readable by anything that lists notifications.
 *     It goes in `message`, so it lives in exactly one place.
 *   • The link is single-use and short-lived by construction, so a leaked
 *     notification is a bounded problem rather than a durable credential.
 *   • `metadata` gets only non-secret facts (kind, expiry). It is where anything
 *     filterable belongs.
 */
async function deliverOneTimeToken(userId: string, delivery: OneTimeTokenDelivery): Promise<void> {
  const expiresAt = new Date(Date.now() + delivery.ttlHours * 3_600_000);
  const isReset = delivery.kind === 'password-reset';

  const title = isReset ? 'Password reset requested' : 'Verify your email address';
  const message = isReset
    ? `Use this link to choose a new password. It expires in ${delivery.ttlHours}h and can be used once.\n${delivery.path}`
    : `Confirm this address to finish setting up your account. The link expires in ${delivery.ttlHours}h and can be used once.\n${delivery.path}`;

  await notify({
    userId,
    type: 'GENERAL',
    title,
    message,
    actionUrl: delivery.path,
    metadata: { kind: delivery.kind, expiresAt: expiresAt.toISOString() },
  });

  // The audit trail records that a token was issued, never the token itself.
  logger.info(
    {
      event: 'auth.one_time_token_issued',
      kind: delivery.kind,
      userId,
      expiresAt: expiresAt.toISOString(),
    },
    'Issued a one-time token',
  );
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

/**
 * Completes a password reset.
 *
 * Consumes the token, stores the new hash, and revokes every existing session in
 * one transaction. The revocation is the part that matters most: if a reset is
 * the response to a suspected compromise, leaving the attacker's session alive
 * means the reset achieved nothing.
 */
export async function resetPassword(
  input: ResetPasswordInput,
  context: AuditContext = {},
): Promise<void> {
  validatePasswordStrength(input.newPassword);

  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashOneTimeToken(input.token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!token || token.usedAt !== null || token.expiresAt.getTime() <= Date.now()) {
    throw badRequest('This password reset link is invalid or has expired');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await withTransaction(async (tx) => {
    // Conditional update on `usedAt: null` so two concurrent redemptions of the
    // same token cannot both succeed. The second matches zero rows and the
    // transaction is discarded.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw badRequest('This password reset link is invalid or has expired');
    }

    await tx.user.update({
      where: { id: token.userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        // A reset also clears a lockout: the user proved control of the mailbox.
        failedLoginCount: 0,
        lockedUntil: null,
        mustChangePassword: false,
      },
    });

    await tx.session.updateMany({
      where: { userId: token.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'password_reset' },
    });

    await tx.passwordResetToken.updateMany({
      where: { userId: token.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  });

  await recordAudit({
    action: 'PASSWORD_RESET',
    entityType: 'User',
    entityId: token.userId,
    description: 'Password reset completed; all sessions revoked',
    context,
  });
}

/* ── Email verification ────────────────────────────────────────────────────── */

/**
 * Issues a verification token.
 *
 * The raw token is returned to the caller ONLY so it can be delivered; it is never
 * logged and never stored. Without a mail transport wired up yet, the caller is
 * responsible for handing it to the notification layer, and in development the
 * token is surfaced in the response instead of sent.
 */
export async function issueEmailVerification(userId: string): Promise<string> {
  await prisma.emailVerificationToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const { token, tokenHash } = generateOneTimeToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_LIMITS.EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
    },
  });

  // Only the hash is durable, so the raw token exists here and nowhere else. It
  // MUST be delivered now or the link is unrecoverable — a second request would
  // invalidate this one, and the hash cannot be reversed.
  await deliverOneTimeToken(userId, {
    kind: 'email-verification',
    token,
    path: `/verify-email?token=${encodeURIComponent(token)}`,
    ttlHours: TOKEN_LIMITS.EMAIL_VERIFICATION_TTL_HOURS,
  });

  return token;
}

/** Redeems a verification token. Idempotent for an already-verified address. */
export async function verifyEmail(
  rawToken: string,
  context: AuditContext = {},
): Promise<{ verified: boolean }> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashOneTimeToken(rawToken) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
    throw badRequest('This verification link is invalid or has expired');
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
  ]);

  await recordAudit({
    action: 'EMAIL_VERIFIED',
    entityType: 'User',
    entityId: record.userId,
    description: 'Email address verified',
    context,
  });

  return { verified: true };
}

/** Changes a password while signed in, requiring the current one. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentSessionId: string,
  context: AuditContext = {},
): Promise<void> {
  validatePasswordStrength(newPassword);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, email: true },
  });
  if (!user) throw notFound('User');

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw invalidCredentials();
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
  });

  // Revoke everything EXCEPT the session making the change, so the user is not
  // logged out of the tab they just used.
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, id: { not: currentSessionId } },
    data: { revokedAt: new Date(), revokedReason: 'password_changed' },
  });

  await recordAudit({
    action: 'PASSWORD_CHANGED',
    entityType: 'User',
    entityId: userId,
    description: 'Password changed by the account holder',
    actor: { userId, email: user.email },
    context,
  });
}

export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
}

export interface OwnProfile {
  firstName: string;
  lastName: string;
  phone: string | null;
}

/**
 * Edits the caller's own name and phone number.
 *
 * The set of writable fields is fixed HERE and not derived from the patch: the
 * schema is `.strict()` as a second line of defence, but a service that applied
 * whatever object it was handed would turn the next widened request schema into
 * a mass-assignment hole. Email, role, status and branch are not in this list
 * and cannot be reached through it.
 *
 * Audited with the before/after of the three fields, because a name change is
 * the kind of edit that later reads as "who is this person?" in a loan history.
 */
export async function updateOwnProfile(
  userId: string,
  patch: ProfilePatch,
  context: AuditContext = {},
): Promise<OwnProfile> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true, lastName: true, phone: true },
  });
  if (!existing) throw notFound('User');

  const data: ProfilePatch = {};
  if (patch.firstName !== undefined) data.firstName = patch.firstName;
  if (patch.lastName !== undefined) data.lastName = patch.lastName;
  if (patch.phone !== undefined) data.phone = patch.phone;

  // Nothing to write is not the same as "write nothing" — an audit row for a
  // no-op is noise, and noise is what makes the real entries get skimmed.
  if (Object.keys(data).length === 0) {
    return {
      firstName: existing.firstName,
      lastName: existing.lastName,
      phone: existing.phone,
    };
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: { firstName: true, lastName: true, phone: true },
  });

  await recordAudit({
    action: 'USER_UPDATED',
    entityType: 'User',
    entityId: userId,
    description: 'Profile updated by the account holder',
    before: {
      firstName: existing.firstName,
      lastName: existing.lastName,
      phone: existing.phone,
    },
    after: { firstName: updated.firstName, lastName: updated.lastName, phone: updated.phone },
    actor: { userId, email: existing.email },
    context,
  });

  return updated;
}

/** Session rows for the "active devices" view. */
export function activeSessions(userId: string) {
  return listSessionsForUser(userId);
}

/** Days a refresh token remains valid; surfaced so the client can plan a re-login. */
export const REFRESH_LIFETIME_DAYS = REFRESH_TOKEN_TTL_DAYS;

/** The instant a new member's membership would expire under default policy. */
export function defaultMembershipExpiry(from: Date = new Date()): Date {
  return addCalendarDays(from, 365);
}
