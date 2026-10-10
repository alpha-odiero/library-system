import type { CookieOptions, Request } from 'express';
import { env } from '../config/env.js';

/**
 * The `Secure` / `SameSite` pair shared by every authentication cookie.
 *
 * Kept in one place so the cookie written at sign-in, the CSRF cookie, and the
 * matching `clearCookie` calls cannot drift — a clear whose attributes differ
 * from the original is how a "logout does not actually log out" bug is born.
 *
 * `SameSite=None` is required when the SPA is served from a different site than
 * the API (a Vercel/Netlify deploy pointing at this backend); `Lax` is stricter
 * and correct for a same-site deploy, including the Vite dev proxy. The env
 * schema refuses `none` unless `Secure` is on, because browsers drop such a
 * cookie outright.
 */
export function authCookieOptions(): Pick<CookieOptions, 'secure' | 'sameSite'> {
  return {
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
  };
}

/**
 * Cookie reading.
 *
 * One implementation, because two call sites (the access token and the CSRF
 * token) each needed the same fallback and duplicating it invites the two to
 * drift.
 *
 * The fallback exists for a specific reason: `cookie-parser` is mounted in
 * `app.ts`, but if the middleware chain is ever reordered or a route is mounted
 * before it, `req.cookies` is `undefined`. Without the fallback every
 * authenticated request fails as "logged out" — a confusing symptom whose cause
 * is three lines of middleware away. Parsing the raw header is cheap and makes
 * the failure mode impossible.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const parsed = req.cookies as Record<string, unknown> | undefined;
  const fromParser = parsed?.[name];
  if (typeof fromParser === 'string' && fromParser.length > 0) return fromParser;

  const header = req.headers.cookie;
  if (typeof header !== 'string' || header.length === 0) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    if (value.length === 0) return undefined;

    try {
      return decodeURIComponent(value);
    } catch {
      // A malformed percent-escape is a client error, not a reason to throw from
      // a read helper; treat it as absent and let the caller's own validation
      // produce the 401.
      return undefined;
    }
  }
  return undefined;
}
