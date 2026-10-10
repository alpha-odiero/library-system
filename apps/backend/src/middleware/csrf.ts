import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { env, corsAllowedOrigins } from '../config/env.js';
import { COOKIE_PATHS, HEADER_CSRF, SAFE_METHODS } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { authCookieOptions, readCookie } from '../lib/cookies.js';
import { AppError } from '../lib/errors.js';

/**
 * CSRF protection — double-submit cookie.
 *
 * A cookie-authenticated API is vulnerable to CSRF in a way a
 * `Authorization`-header API is not: the browser ATTACHES the credential to a
 * cross-site request automatically, and the attacker's page cannot read the
 * response but does not need to.
 *
 * Three layers, in order of how much they actually contribute:
 *
 *   1. `SameSite` on the session cookie (default `Lax`). A cross-site POST
 *      carries no cookie at all, which stops the classic attack outright. This is
 *      the primary control — EXCEPT that a SPA served from a different site needs
 *      `COOKIE_SAME_SITE=none` to receive the cookie at all, removing this layer
 *      and leaving the two below as the controls.
 *   2. The double-submit check below. The token never leaves the client as
 *      anything the browser attaches automatically: it is read from the cookie or
 *      the issued body and echoed in a header, and a cross-origin attacker can
 *      neither read it nor set the header without a successful preflight.
 *   3. The CORS allowlist. A cross-origin request that cannot be read cannot
 *      preflight a custom header successfully.
 *
 * The token is a random value in a cookie the attacker cannot read (it is
 * same-origin scoped). The client echoes it in a header; a cross-origin
 * attacker cannot set that header without a successful preflight, and cannot
 * read the cookie to copy the value.
 */

export class CsrfError extends AppError {
  constructor(message: string, logContext?: Record<string, unknown>) {
    super('FORBIDDEN', message, { logContext });
  }
}

/** Reads the CSRF cookie via the shared reader. */
function readCsrfCookie(req: Request): string | undefined {
  return readCookie(req, env.CSRF_COOKIE_NAME);
}

/** Constant-time string comparison. */
function matches(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Verifies the CSRF token on state-changing requests.
 *
 * Safe methods are exempt: by definition they must not mutate state, and
 * exempting them is what allows a bookmarked GET, a prefetch, or a crawler to work
 * without a token.
 *
 * `Origin` is checked too. It is trivially hard to forge from a browser, and a
 * request arriving with a foreign `Origin` on a state-changing call is a
 * legitimate rejection even if a token happened to match.
 */
export function verifyCsrf(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.headers.origin;

    // A same-origin browser request may omit Origin on same-origin POST in some
    // clients. A cross-origin one cannot: the browser always sets it for a
    // cross-origin POST, so its absence is not evidence of anything.
    if (typeof origin === 'string' && origin.length > 0 && !corsAllowedOrigins.includes(origin)) {
      logger.warn(
        { event: 'auth.csrf_origin_rejected', origin, path: req.path, method: req.method },
        'Rejected state-changing request from a disallowed origin',
      );
      next(new CsrfError('Request origin is not permitted', { origin }));
      return;
    }

    const cookieToken = readCsrfCookie(req);
    const presented = req.get(HEADER_CSRF);

    if (!cookieToken || typeof presented !== 'string' || presented.length === 0) {
      next(
        new CsrfError('CSRF token missing', {
          hasCookie: Boolean(cookieToken),
          hasHeader: typeof presented === 'string',
        }),
      );
      return;
    }

    if (!matches(cookieToken, presented)) {
      logger.warn(
        {
          event: 'auth.csrf_token_mismatch',
          path: req.path,
          method: req.method,
          requestId: req.requestId,
        },
        'CSRF token did not match',
      );
      next(new CsrfError('CSRF token is not valid'));
      return;
    }

    next();
  };
}

/**
 * Sets the CSRF cookie and returns the value that was written.
 *
 * Returning the value is what lets a caller put it in the response body, so the
 * cookie and the JSON cannot drift apart — a client that echoes the body value
 * always matches the cookie it was sent.
 *
 * Deliberately `httpOnly: false`. The browser must be able to read this one:
 * the client echoes it in a header, which is what makes the double-submit check
 * work. The session cookie is the credential, and that one stays HttpOnly.
 */
export function setCsrfCookie(res: Response): string {
  const token = randomUUID();
  res.cookie(env.CSRF_COOKIE_NAME, token, {
    ...authCookieOptions(),
    httpOnly: false,
    path: COOKIE_PATHS.CSRF,
  });
  return token;
}

/**
 * Ensures an anonymous client holds a CSRF cookie.
 *
 * Applied to the auth entry points so a client can reach them without first
 * making a request that mints the cookie. It never overwrites an existing
 * token: rotating it mid-session would invalidate a header the client has
 * already been given.
 */
export function issueCsrfToken(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!readCsrfCookie(req)) {
      setCsrfCookie(res);
    }
    next();
  };
}
