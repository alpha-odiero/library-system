import { Router } from 'express';
import { z } from 'zod';
import { env, isProduction } from '../../config/env.js';
import { prisma } from '../../config/database.js';
import { COOKIE_NAMES } from '../../config/constants.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { readCookie } from '../../lib/cookies.js';
import { unauthenticated } from '../../lib/errors.js';
import { sendCreated, sendNoContent, sendOk } from '../../lib/response.js';
import { validate, validated } from '../../middleware/validate.js';
import {
  clearAuthCookies,
  currentPrincipal,
  requireAuth,
  setAuthCookies,
} from '../../middleware/authenticate.js';
import { issueCsrfToken, setCsrfCookie, verifyCsrf } from '../../middleware/csrf.js';
import { authRateLimit } from '../../middleware/rate-limit.js';
import { buildPrincipal } from './principal.service.js';
import * as authService from './auth.service.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from './auth.schemas.js';

/**
 * Authentication routes.
 *
 * `/api/v1/auth` — the only router whose guards are declared per-route rather
 * than inherited, because it is the one place a request is legitimately
 * anonymous. Every other module gets `requireAuth()` from the manifest.
 *
 * Each public route carries, in order:
 *   • `authRateLimit`  — credential endpoints are the brute-force surface
 *   • `verifyCsrf`     — a login CSRF is a real attack (forced login)
 *   • `issueCsrfToken` — mints the cookie the client will echo
 *   • `validate`       — replaces the body with parsed, stripped input
 *
 * CSRF on login is worth naming: without it, an attacker's page can silently sign
 * a victim into the ATTACKER's account, then observe what the victim does. It is
 * the one CSRF variant people leave out because "nobody is authenticated yet".
 *
 * `issueCsrfToken` runs after `verifyCsrf`, which means the very first request a
 * client ever makes has no token to present and is rejected. `GET /api/v1/auth/csrf`
 * is the bootstrap that resolves this; it is not a substitute for it.
 *
 * Where a session is required, `requireAuth()` precedes `verifyCsrf`. An anonymous
 * caller should be told it is unauthenticated (401) rather than that its CSRF token
 * is missing (403) — the second answer confirms the endpoint exists and describes
 * its guard for no benefit, and it makes refusals ambiguous for the client.
 */

/** Audit/trace fields pulled from the request. Never from the body. */
function requestContext(req: Parameters<typeof currentPrincipal>[0]) {
  return {
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

export const authRouter = Router();

/* ── POST /auth/login ──────────────────────────────────────────────────────── */

authRouter.post(
  '/login',
  authRateLimit,
  verifyCsrf(),
  issueCsrfToken(),
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, loginSchema);
    const result = await authService.login(body, requestContext(req));

    setAuthCookies(res, result.session);

    // The tokens are in HttpOnly cookies; the body carries only the identity the
    // client needs to render. Returning the access token here as well would
    // defeat the point of HttpOnly and give an XSS payload something to steal.
    sendOk(
      res,
      {
        user: result.user,
        expiresInSeconds: result.session.access.expiresInSeconds,
        refreshExpiresAt: result.session.refreshExpiresAt.toISOString(),
        permissions: [...(await permissionsFor(result.user.id, result.session.sessionId))],
      },
      { message: 'Signed in' },
    );
  }),
);

async function permissionsFor(userId: string, sessionId: string): Promise<ReadonlySet<string>> {
  const principal = await buildPrincipal(userId, sessionId);
  return principal?.permissions ?? new Set<string>();
}

/* ── GET /auth/csrf ─────────────────────────────────────────────────────────── */

/**
 * CSRF bootstrap — the end of the chicken-and-egg.
 *
 * `issueCsrfToken` runs *after* `verifyCsrf` on every public entry point, which
 * is correct ordering (you cannot verify a token you have not been issued) but
 * means a first-time client holds nothing to present. This endpoint is what it
 * calls first.
 *
 * A safe method, so `verifyCsrf` exempts it — right, since issuing a token is
 * not a state change that can be forged. `no-store` keeps the value out of any
 * shared cache. The token is returned in the body as well as the cookie, so a
 * client that cannot read the cookie can still send a matching header.
 */
authRouter.get('/csrf', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendOk(res, { csrfToken: setCsrfCookie(res) });
});

/* ── POST /auth/register ───────────────────────────────────────────────────── */

authRouter.post(
  '/register',
  authRateLimit,
  verifyCsrf(),
  issueCsrfToken(),
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, registerSchema);
    const result = await authService.register(body, requestContext(req));

    if (result.requiresEmailVerification) {
      // No session is issued: the account cannot be used until the address is
      // proven, so handing out credentials here would bypass the very gate.
      sendCreated(
        res,
        { requiresEmailVerification: true, roleCode: result.roleCode },
        'Account created. Check your email to verify your address.',
      );
      return;
    }

    sendCreated(
      res,
      {
        requiresEmailVerification: false,
        roleCode: result.roleCode,
      },
      'Account created. Sign in to continue.',
    );
  }),
);

/* ── POST /auth/refresh ────────────────────────────────────────────────────── */

authRouter.post(
  '/refresh',
  authRateLimit,
  verifyCsrf(),
  issueCsrfToken(),
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, refreshSchema);

    // Cookie first: it is the browser path and is scoped to this router, so it
    // is not attached to unrelated API calls. The body field exists for clients
    // without a cookie jar.
    const token = readCookie(req, COOKIE_NAMES.REFRESH) ?? body.refreshToken;
    if (!token) {
      throw unauthenticated('No refresh credential was presented', 'TOKEN_INVALID');
    }

    const rotated = await authService.refresh(token, requestContext(req));
    setAuthCookies(res, rotated);

    sendOk(
      res,
      {
        refreshed: true,
        expiresInSeconds: rotated.access.expiresInSeconds,
        refreshExpiresAt: rotated.refreshExpiresAt.toISOString(),
      },
      { message: 'Session refreshed' },
    );
  }),
);

/* ── POST /auth/logout ─────────────────────────────────────────────────────── */

authRouter.post(
  '/logout',
  requireAuth(),
  verifyCsrf(),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    await authService.logout(principal.sessionId, requestContext(req));
    clearAuthCookies(res);
    sendNoContent(res);
  }),
);

/** Ends every session for the caller, including this one. */
authRouter.post(
  '/logout-all',
  requireAuth(),
  verifyCsrf(),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const count = await authService.logoutEverywhere(principal.userId, requestContext(req));
    clearAuthCookies(res);
    sendOk(res, { revokedSessions: count }, { message: 'Signed out of all sessions' });
  }),
);

/* ── GET /auth/me ──────────────────────────────────────────────────────────── */

/**
 * The identity endpoint the client calls on boot.
 *
 * Reads the principal the middleware already built rather than re-querying, so it
 * cannot disagree with the authorization the same request was allowed under.
 *
 * Synchronous, and therefore NOT wrapped in `asyncHandler`: there is no rejected
 * promise to catch, and Express 4 propagates a synchronous throw to the error
 * handler on its own.
 */
authRouter.get('/me', requireAuth(), (req, res) => {
  const principal = currentPrincipal(req);
  sendOk(res, {
    userId: principal.userId,
    email: principal.email,
    firstName: principal.firstName,
    lastName: principal.lastName,
    phone: principal.phone,
    roleCode: principal.roleCode,
    memberId: principal.memberId,
    permissions: [...principal.permissions],
    // `null` is meaningful to the client: it is what enables branch pickers to
    // show every branch. Collapsing it to `[]` would silently turn an
    // all-branch admin into a no-branch user.
    branchScope: principal.branchScope,
    primaryBranchName: principal.primaryBranchName,
    /**
     * Sent so the client can tell "scoped to a library" from "no library scope".
     * The client NEVER uses this to filter data — it decides whether to show a
     * tenant label and whether to disable tenant-scoped screens. Isolation is
     * enforced by the API; a client that treats this as a display convenience is
     * the only correct client.
     */
    libraryScope: principal.libraryScope,
    libraryName: principal.libraryName,
    sessionId: principal.sessionId,
  });
});

/* ── PATCH /auth/me — the account holder's own name and phone ──────────────── */

/**
 * Self-service profile edit.
 *
 * Guards in the same order as the rest of this router: 401 before 403, so an
 * anonymous caller is told it is not signed in rather than that its CSRF token
 * is missing — a refusal that would confirm this endpoint exists.
 *
 * What may be edited is fixed in the service, not here: a route that applied
 * `req.body` directly would make the request schema the only thing standing
 * between a member and a role change.
 */
authRouter.patch(
  '/me',
  requireAuth(),
  verifyCsrf(),
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const patch = validated.body(req, updateProfileSchema);

    const profile = await authService.updateOwnProfile(
      principal.userId,
      patch,
      requestContext(req),
    );

    sendOk(res, profile, { message: 'Profile updated' });
  }),
);

/** Live sessions for the account, so a user can spot a device they do not recognise. */
authRouter.get(
  '/sessions',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const sessions = await authService.activeSessions(principal.userId);
    sendOk(res, {
      sessions: sessions.map((session) => ({
        id: session.id,
        current: session.id === principal.sessionId,
        ip: session.ip,
        userAgent: session.userAgent,
        deviceLabel: session.deviceLabel,
        issuedAt: session.issuedAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      })),
    });
  }),
);

/** Revokes one session by id. A user may only revoke their own. */
authRouter.delete(
  '/sessions/:sessionId',
  requireAuth(),
  validate({ params: z.object({ sessionId: z.string().uuid() }).strict() }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { sessionId } = validated.params(req) as { sessionId: string };

    await authService.revokeOwnSession(sessionId, principal.userId, requestContext(req));

    // Revoking the session making this very request ends it too.
    if (sessionId === principal.sessionId) clearAuthCookies(res);

    // 204 whether or not the session existed: a caller probing ids learns
    // nothing, and "you are signed out" is the message either way.
    sendNoContent(res);
  }),
);

/* ── POST /auth/change-password ────────────────────────────────────────────── */

authRouter.post(
  '/change-password',
  requireAuth(),
  verifyCsrf(),
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, changePasswordSchema);

    await authService.changePassword(
      principal.userId,
      body.currentPassword,
      body.newPassword,
      principal.sessionId,
      requestContext(req),
    );

    sendOk(res, { changed: true }, { message: 'Password changed' });
  }),
);

/* ── Password reset ────────────────────────────────────────────────────────── */

/**
 * Always answers 200 with the same body.
 *
 * A different response for a registered address is an account-existence oracle,
 * and this endpoint has no rate limit strong enough to make probing expensive.
 */
authRouter.post(
  '/forgot-password',
  authRateLimit,
  verifyCsrf(),
  issueCsrfToken(),
  validate({ body: forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, forgotPasswordSchema);
    await authService.forgotPassword(body, requestContext(req));
    sendOk(
      res,
      { accepted: true },
      { message: 'If that address has an account, a reset link is on its way.' },
    );
  }),
);

authRouter.post(
  '/reset-password',
  authRateLimit,
  verifyCsrf(),
  issueCsrfToken(),
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, resetPasswordSchema);
    await authService.resetPassword(body, requestContext(req));
    clearAuthCookies(res);
    sendOk(res, { reset: true }, { message: 'Password updated. Sign in with your new password.' });
  }),
);

authRouter.post(
  '/verify-email',
  authRateLimit,
  verifyCsrf(),
  issueCsrfToken(),
  validate({ body: verifyEmailSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, verifyEmailSchema);
    await authService.verifyEmail(body.token, requestContext(req));
    sendOk(res, { verified: true }, { message: 'Email address verified' });
  }),
);

/* ── Development-only: surface a verification token ───────────────────────── */

/**
 * Returns the raw email-verification token so a developer can complete the flow
 * without a mail server.
 *
 * Registered ONLY when `REQUIRE_EMAIL_VERIFICATION` is on and NODE_ENV is not
 * production. This is a token-minting endpoint: leaving it mounted in production
 * would let anyone verify an arbitrary address. The `!isProduction` guard is the
 * reason it is safe to have at all.
 */
if (!isProduction && env.REQUIRE_EMAIL_VERIFICATION) {
  authRouter.post(
    '/dev/verification-token',
    authRateLimit,
    verifyCsrf(),
    validate({ body: z.object({ email: z.string().email() }).strict() }),
    asyncHandler(async (req, res) => {
      const { email } = validated.body(req) as { email: string };
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: { id: true },
      });
      if (!user) {
        sendOk(res, { issued: false });
        return;
      }
      const token = await authService.issueEmailVerification(user.id);
      sendOk(res, { issued: true, token });
    }),
  );
}
