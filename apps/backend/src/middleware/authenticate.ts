import type { Request, RequestHandler, Response } from 'express';
import type { AuthPrincipal } from '@lms/shared';
import { env } from '../config/env.js';
import { COOKIE_NAMES, COOKIE_PATHS } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { authCookieOptions, readCookie } from '../lib/cookies.js';
import { unauthenticated } from '../lib/errors.js';
import {
  resolveLiveSession,
  touchSession,
  type IssuedSession,
} from '../modules/auth/session.service.js';
import { buildPrincipal } from '../modules/auth/principal.service.js';

/**
 * GATE 1 — AUTHENTICATION.
 *
 * Answers one question: whose request is this? Every other gate assumes the
 * answer, so this middleware is where "deny by default" actually begins. A route
 * that forgets `authenticate` is not accidentally open — see `requireAuth`
 * below, which throws at registration time rather than trusting review.
 *
 * Two-step verification, and the second step is the point:
 *
 *   1. The cookie holds a SIGNED token. Verifying the signature is cheap and
 *      rejects a forged token with no database round trip.
 *   2. The `sid` claim is resolved against the `sessions` row. This is what
 *      makes revocation real: logout, "log out everywhere", password reset and
 *      deactivation all flip a row, and the very next request fails here even
 *      though its token is still cryptographically perfect.
 *
 * Step 1 alone would be a bearer-token API with extra steps: fifteen minutes of
 * validity that nothing can interrupt.
 */

/** Reads the access cookie, tolerating an absent cookie-parser. */
function readAccessCookie(req: Request): string | undefined {
  return readCookie(req, COOKIE_NAMES.ACCESS);
}

/**
 * Populates `req.auth` when a valid session is present.
 *
 * Does NOT reject. This is the permissive form used where an endpoint serves
 * both anonymous and authenticated callers differently (a catalogue search that
 * hides unavailable copies, a public settings view that adds staff-only keys).
 * Such routes must still state which identity they received via
 * `optionalAuth`.
 */
export function optionalAuth(): RequestHandler {
  return (req, _res, next) => {
    authenticateRequest(req)
      .then((principal) => {
        req.auth = principal ?? undefined;
        next();
      })
      .catch(next);
  };
}

/**
 * Requires a valid session. The default for anything that touches user data.
 *
 * The failure message is deliberately uniform. Distinguishing "no cookie" from
 * "expired" from "revoked" would tell an attacker which of their guesses was
 * nearly right; every case produces the same code the client handles by
 * redirecting to login.
 */
export function requireAuth(): RequestHandler {
  return (req, _res, next) => {
    authenticateRequest(req)
      .then((principal) => {
        if (!principal) {
          next(unauthenticated());
          return;
        }
        req.auth = principal;
        next();
      })
      .catch(next);
  };
}

/**
 * Gate 1's core. Returns null for "no usable identity" rather than throwing, so
 * the permissive and strict forms share one implementation.
 */
async function authenticateRequest(req: Request): Promise<AuthPrincipal | null> {
  const token = readAccessCookie(req);
  if (!token) return null;

  const live = await resolveLiveSession(token);
  if (!live) return null;

  const principal = await buildPrincipal(live.userId, live.sessionId);
  if (!principal) return null;

  /**
   * `lastUsedAt` is display data, refreshed opportunistically rather than on
   * every request — see `touchSession`.
   */
  void touchSession(live.sessionId).catch(() => undefined);

  return principal;
}

/**
 * The identity of the current caller.
 *
 * Throws if reached without Gate 1. A service reaching for this on an anonymous
 * route has a bug that would otherwise surface as a null dereference deep in a
 * query, so the message names the cause.
 */
export function currentPrincipal(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) {
    throw unauthenticated('Authentication required', 'UNAUTHENTICATED');
  }
  return req.auth;
}

/* ── Cookie issuance ────────────────────────────────────────────────────────── */

/**
 * Sets the authentication cookies.
 *
 * Flags, and why each is what it is:
 *
 *   httpOnly  — JavaScript cannot read either cookie, so an XSS payload cannot
 *               exfiltrate a session. This is the single most valuable flag.
 *   secure    — HTTPS only. Required in production and enforced by the env
 *               schema.
 *   sameSite  — `Lax` sends the cookie on top-level navigations but not on
 *               cross-site subrequests, which blocks CSRF on state-changing
 *               POSTs without breaking ordinary link navigation. A SPA served
 *               from a DIFFERENT site than the API needs `None` instead — see
 *               `authCookieOptions` and `COOKIE_SAME_SITE`.
 *   path      — the refresh cookie is scoped to `/api/v1/auth` so it is not
 *               attached to every API call, shrinking the window in which a
 *               leaked copy of it is useful.
 */
/**
 * Sets the authentication cookies from an issued session.
 *
 * Typed against the session service's `IssuedSession` (a type-only import, so
 * there is no runtime dependency between middleware and the auth module) rather
 * than a bespoke flat shape. A separate "what the cookie writer needs" type
 * would drift from what sessions actually produce, and the failure would be a
 * cookie silently set with an undefined expiry — a session that outlives its
 * credential.
 */
export function setAuthCookies(res: Response, issued: IssuedSession): void {
  const base = authCookieOptions();

  res.cookie(COOKIE_NAMES.ACCESS, issued.access.token, {
    ...base,
    httpOnly: true,
    path: COOKIE_PATHS.CSRF,
    expires: issued.access.expiresAt,
  });

  res.cookie(COOKIE_NAMES.REFRESH, issued.refreshToken, {
    ...base,
    httpOnly: true,
    path: COOKIE_PATHS.REFRESH,
    expires: issued.refreshExpiresAt,
  });

  /**
   * The CSRF cookie is deliberately NOT re-issued here.
   *
   * Every public entry point runs `issueCsrfToken` (which sets one only if
   * absent) before the handler, so a cookie already exists. Rotating it at
   * sign-in would invalidate the token a cross-origin client was handed in the
   * `/auth/csrf` body: such a client cannot read the replacement from
   * `document.cookie`, so its very next write would fail the double-submit
   * check. Ownership of the CSRF cookie belongs to `issueCsrfToken` /
   * `setCsrfCookie`, and this function must not touch it.
   */
}

/**
 * Clears the authentication cookies.
 *
 * The path must MATCH the path the cookie was set with. A cookie set at `/` and
 * cleared at `/api/v1/auth` leaves the original in the browser, and the user
 * appears to "stay logged in" after logout — one of the most commonly
 * misdiagnosed cookie bugs there is.
 */
export function clearAuthCookies(res: Response): void {
  const common = { ...authCookieOptions(), httpOnly: true } as const;

  res.clearCookie(COOKIE_NAMES.ACCESS, { ...common, path: COOKIE_PATHS.CSRF });
  res.clearCookie(COOKIE_NAMES.REFRESH, { ...common, path: COOKIE_PATHS.REFRESH });

  res.clearCookie(env.CSRF_COOKIE_NAME, {
    ...common,
    httpOnly: false,
    path: COOKIE_PATHS.CSRF,
  });

  logger.debug({ event: 'auth.cookies_cleared' }, 'Authentication cookies cleared');
}
