import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Express, Request } from 'express';
import { createApp } from '../../src/app.js';
import { v1Router, PUBLIC_ROUTES } from '../../src/routes/v1/index.js';
import { AppError } from '../../src/lib/errors.js';
import { bodyOf, type ErrorBody } from '../helpers.js';

/**
 * Route-manifest security test.
 *
 * `routes/v1/index.ts` promises that no `/api/v1` route is mounted without a
 * guard, and points here as the enforcement. A promise in a docblock is not a
 * control; enumerating the real Express stack is.
 *
 * The check is behavioural rather than structural: a route is considered
 * protected when an anonymous request to it is REFUSED. That survives someone
 * reordering middleware or introducing a new guard, where matching on middleware
 * *names* would quietly stop testing anything.
 */

const app = createApp();

interface RouteEntry {
  path: string;
  methods: Set<string>;
}

/**
 * Walks the mounted Express stack.
 *
 * Express keeps `router.stack` with `layer.route` for a matched route and
 * `layer.handle.stack` for a mounted sub-router, so the walk has to recurse.
 * `layer.route.methods` holds the verbs Express actually registers — DELETE is
 * stored as `delete`, which is why the comparison lowercases both sides.
 */
/**
 * Recovers a mount prefix from the layer's regexp.
 *
 * Express 4 keeps a mounted path only as a compiled regexp — `layer.path` is
 * `undefined` — so the prefix is read back out of the pattern:
 *
 *   `^\/?$`                    → ''
 *   `^\/auth\/?(?=\/|$)`       → '/auth'
 *   `^\/api\/v1\/?(?=\/|$)`    → '/api/v1'
 *
 * Only the literal leading segment is decoded. A parameterised mount
 * (`use('/:id')`) compiles to a capture group and yields '/', which is fine here
 * because every mount in this API is static.
 */
function mountPrefix(layer: Record<string, unknown>): string {
  const source = (layer['regexp'] as RegExp | undefined)?.source ?? '';
  let prefix = '';

  for (let i = source.startsWith('^') ? 1 : 0; i < source.length; i += 1) {
    const char = source[i] as string;

    if (char === '\\') {
      const escaped = source[i + 1];
      prefix += escaped === '/' ? '/' : (escaped ?? '');
      i += 1;
      continue;
    }

    if (char === '/' || /[A-Za-z0-9_.:~-]/.test(char)) {
      prefix += char;
      continue;
    }

    break;
  }

  if (prefix.length > 1 && prefix.endsWith('/')) prefix = prefix.slice(0, -1);
  return prefix === '/' ? '' : prefix;
}

function collectRoutes(router: Express['_router'], prefix = ''): RouteEntry[] {
  const entries: RouteEntry[] = [];
  // `_router` is Express-internal and absent in the type definitions.
  const stack = (router as unknown as { stack: unknown[] })?.stack ?? [];

  for (const layer of stack as Array<Record<string, unknown>>) {
    const route = layer['route'] as
      | { path: string; methods: Record<string, boolean>; stack: unknown[] }
      | undefined;

    if (route) {
      entries.push({
        path: `${prefix}${route.path}`,
        methods: new Set(
          Object.entries(route.methods)
            .filter(([, enabled]) => enabled)
            .map(([method]) => method.toUpperCase()),
        ),
      });
      continue;
    }

    if (layer['name'] !== 'router') continue;

    // A mounted layer's `handle` is the sub-router function; its stack hangs off
    // that function, which Express's types do not describe.
    interface RouterLike {
      stack?: unknown[];
    }

    const subRouter = layer['handle'] as RouterLike;
    if (!subRouter.stack) continue;

    entries.push(
      ...collectRoutes(
        subRouter as unknown as Express['_router'],
        `${prefix}${mountPrefix(layer)}`,
      ),
    );
  }

  return entries;
}

function apiRoutes(): RouteEntry[] {
  return collectRoutes(v1Router as unknown as Express['_router'], '/api/v1');
}

/**
 * A verb+path pair, normalised for comparison.
 *
 * Both sides go through the same function. Comparing an upper-cased allowlist
 * entry against a mixed-case collected path would report a difference where
 * there is none, and a test that cries wolf gets ignored.
 */
function pair(method: string, path: string): string {
  return `${method.trim().toUpperCase()} ${path.trim()}`.replace(/\/+$/, '/');
}

describe('route manifest — authentication is deny-by-default', () => {
  it('finds the mounted routes', () => {
    // If this fails, every assertion below is vacuously true, so it is checked
    // first and on its own.
    const routes = apiRoutes();

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.some((route) => route.path.startsWith('/api/v1/auth'))).toBe(true);
  });

  it('lists only paths that exist', () => {
    const known = new Set(
      apiRoutes().flatMap((route) => [...route.methods].map((m) => pair(m, route.path))),
    );

    // A stale entry in PUBLIC_ROUTES is a silent hole: the route was removed, but
    // the allowlist still advertises a public path to anyone reading the code.
    for (const entry of PUBLIC_ROUTES) {
      const [method, ...rest] = entry.trim().split(/\s+/);
      expect(known, `PUBLIC_ROUTES lists a route that is not mounted: ${entry}`).toContain(
        pair(method ?? '', rest.join(' ')),
      );
    }
  });

  it('refuses every route that is not on the public allowlist', async () => {
    const publicSet = new Set(
      PUBLIC_ROUTES.map((entry) => {
        const [method, ...rest] = entry.trim().split(/\s+/);
        return pair(method ?? '', rest.join(' '));
      }),
    );
    const protectedRoutes: Array<{ method: string; path: string }> = [];

    for (const route of apiRoutes()) {
      for (const method of route.methods) {
        if (publicSet.has(pair(method, route.path))) continue;
        protectedRoutes.push({ method, path: route.path });
      }
    }

    expect(protectedRoutes.length).toBeGreaterThan(0);

    for (const { method, path } of protectedRoutes) {
      // The `:param` segment is substituted, not sent literally: the literal
      // string `:sessionId` is rejected by validation before the guard is
      // reached, and a 400 would say nothing about authentication.
      const concretePath = path.replace(
        /:([A-Za-z_][A-Za-z0-9_]*)/g,
        '00000000-0000-4000-8000-000000000000',
      );

      const call = (
        request(app) as unknown as Record<string, (p: string) => request.Test | undefined>
      )[method.toLowerCase()];
      expect(call, `supertest cannot issue ${method}`).toBeDefined();

      const response = await call?.(concretePath);
      expect(response, `${method} ${path} produced no response`).toBeDefined();
      if (!response) continue;

      // 401 or 403 are both refusals. A 200 — or a 404 for a path that is simply
      // not matched — means the route is reachable without a session.
      expect(
        [401, 403],
        `${method} ${path} answered ${response.status} to an anonymous request`,
      ).toContain(response.status);

      const body = bodyOf<ErrorBody>(response);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects an anonymous request to a protected route with a standard envelope', async () => {
    // Guards must produce the shared error shape, not a bare status — the client
    // has exactly one error branch to write.
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    const body = bodyOf<ErrorBody>(response);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(typeof body.requestId).toBe('string');
  });

  it('does not accept a forged or empty session cookie', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', 'lms_session=not-a-jwt');

    expect(response.status).toBe(401);
    const body = bodyOf<ErrorBody>(response);
    // A specific code here would tell an attacker which part of the forgery to
    // fix next.
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('CSRF on state-changing auth routes', () => {
  /** A fresh CSRF cookie, as a client would hold after any GET. */
  const withCsrfCookie = (value = 'test-csrf-token') => ({
    Cookie: [`lms_csrf=${value}`, 'lms_session=forged'].join('; '),
    'x-csrf-token': value,
  });

  it('rejects a state-changing request with no CSRF token', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({
      email: 'nobody@example.com',
      password: 'irrelevant',
    });

    // Rejected before any credential is examined, so the endpoint is useless for
    // a cross-site login attempt even against a known address.
    expect([403, 400]).toContain(response.status);
    const body = bodyOf<ErrorBody>(response);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a request whose token does not match the cookie', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', 'lms_csrf=cookie-value')
      .set('x-csrf-token', 'header-value')
      .send({ email: 'nobody@example.com', password: 'irrelevant' });

    expect(response.status).toBe(403);
  });

  it('completes the guard chain instead of hanging', async () => {
    // Every guard must terminate. A middleware registered where its factory was
    // expected returns a handler instead of calling `next`, so the request hangs
    // until the client times out — which presents as an outage, not a rejection.
    //
    // `POST /logout` is used because `requireAuth()` runs before `verifyCsrf()`
    // there and refuses an anonymous caller without touching the database, so
    // this asserts chain termination and nothing else.
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', 'lms_csrf=cookie-value')
      .set('x-csrf-token', 'cookie-value')
      .set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a state-changing request from a disallowed Origin', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example.com')
      .set(withCsrfCookie())
      .send({ email: 'nobody@example.com', password: 'irrelevant' });

    expect(response.status).toBe(403);
  });

  it('rejects an unknown field in a login body', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set(withCsrfCookie())
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'nobody@example.com', password: 'irrelevant', roleCode: 'ADMIN' });

    // Mass assignment: `roleCode` has no business in a login body. A strict
    // schema rejects it outright rather than stripping it silently.
    expect(response.status).toBe(400);
    const body = bodyOf<ErrorBody>(response);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('error envelope', () => {
  it('never leaks an internal detail through a protected route', async () => {
    const response = await request(app).get('/api/v1/auth/me');
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toMatch(/SELECT |INSERT |UPDATE |at Object\./);
    expect(serialised).not.toContain('passwordHash');
  });
});

describe('CSRF error type', () => {
  it('reports itself as a 403 FORBIDDEN, never as an internal error', () => {
    const error = new AppError('FORBIDDEN', 'CSRF token missing');
    expect(error.status).toBe(403);
    expect(error.expose).toBe(true);
  });
});

/** Keeps the `Request` type import honest for consumers of this file. */
export type { Request };
