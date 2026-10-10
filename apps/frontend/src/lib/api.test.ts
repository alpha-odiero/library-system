import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  api,
  getHealth,
  isPaginated,
  NetworkError,
  resetCsrfToken,
  setSessionLostHandler,
} from './api';

/**
 * The API client is where untrusted server input enters the app and where
 * credentials are attached, so its behaviour is pinned here.
 *
 * `document` is stubbed because the CSRF cookie is read from `document.cookie`;
 * no DOM implementation is otherwise required.
 */

function stubCookie(value: string): void {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: value },
  });
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-1', ...headers },
  });
}

let calls: FetchCall[];

function mockFetch(responder: (call: FetchCall) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return responder(call);
  });
}

beforeEach(() => {
  calls = [];
  stubCookie('');
  // The body-supplied CSRF token is module state; clear it so one test's
  // bootstrap cannot leak into the next.
  resetCsrfToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('credentials and caching', () => {
  it('always sends cookies and never allows a cached authenticated response', async () => {
    mockFetch(() => jsonResponse({ success: true, data: { ok: true } }));

    await api.get('/catalogue');

    expect(calls[0]?.init.credentials).toBe('include');
    expect(calls[0]?.init.cache).toBe('no-store');
  });

  it('omits cookies for the liveness probe only', async () => {
    mockFetch(() => jsonResponse({ success: true, data: { status: 'ok' } }));

    await getHealth();

    expect(calls[0]?.init.credentials).toBe('omit');
  });

  it('requests JSON so an error page cannot be negotiated into the DOM', async () => {
    mockFetch(() => jsonResponse({ success: true, data: null }));

    await api.get('/catalogue');

    const headers = calls[0]?.init.headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('prefixes the versioned base path', async () => {
    mockFetch(() => jsonResponse({ success: true, data: null }));

    await api.get('/books', { query: { page: 2, limit: 50, q: 'orm', blank: '', nil: null } });

    // Empty and null query values are dropped rather than sent as literal
    // 'undefined'/'null' strings the API would then have to reject.
    expect(calls[0]?.url).toBe('/api/v1/books?page=2&limit=50&q=orm');
  });

  it('places health outside the versioned prefix', async () => {
    mockFetch(() => jsonResponse({ success: true, data: { status: 'ok' } }));

    await getHealth();

    expect(calls[0]?.url).toBe('/health');
  });
});

describe('CSRF protection', () => {
  it('sends no CSRF header on a safe method', async () => {
    stubCookie('lms_csrf=abc123');
    mockFetch(() => jsonResponse({ success: true, data: null }));

    await api.get('/books');

    const headers = calls[0]?.init.headers as Headers;
    expect(headers.get('x-csrf-token')).toBeNull();
  });

  it('echoes the CSRF cookie in a header on every unsafe method', async () => {
    stubCookie('lms_csrf=abc123');
    mockFetch(() => jsonResponse({ success: true, data: null }));

    await api.post('/loans', { copyId: 'x' });

    const headers = calls[0]?.init.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('abc123');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('decodes a URL-encoded token', async () => {
    stubCookie('lms_csrf=a%2Bb%2Fc%3D');
    mockFetch(() => jsonResponse({ success: true, data: null }));

    await api.patch('/loans/1', {});

    const headers = calls[0]?.init.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('a+b/c=');
  });

  it('fails loudly when the bootstrap yields no token instead of sending a blank header', async () => {
    // A blank header produces a 403 indistinguishable from a permission error;
    // refusing here makes the misconfiguration visible. The request is still
    // made, so the failure has a request id to quote.
    stubCookie('session=xyz');
    mockFetch(() => jsonResponse({ success: true, data: {} }));

    await expect(api.delete('/loans/1')).rejects.toThrow(NetworkError);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/auth/csrf');
  });

  it('uses the token from the bootstrap body when the cookie is unreadable (cross-origin)', async () => {
    // A SPA served from a different origin than the API cannot read the CSRF
    // cookie via document.cookie, so the backend returns the token in the body
    // precisely for that case. This is the deployed topology: the SPA on a
    // static host, the API on another origin.
    stubCookie('');
    mockFetch((call) => {
      if (call.url.includes('/auth/csrf')) {
        return jsonResponse({ success: true, data: { csrfToken: 'from-body' } });
      }
      return jsonResponse({ success: true, data: null });
    });

    await api.post('/loans', {});

    const headers = calls[1]?.init.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('from-body');
  });

  it('ignores unrelated cookies when locating the token', async () => {
    stubCookie('theme=dark; lms_csrf=real_token; locale=en-KE');
    mockFetch(() => jsonResponse({ success: true, data: null }));

    await api.post('/loans', {});

    const headers = calls[0]?.init.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('real_token');
  });
});

describe('CSRF bootstrap', () => {
  it('fetches a token before the first unsafe request on a fresh browser', async () => {
    // The real first-visit flow: `verifyCsrf` runs before `issueCsrfToken`, so a
    // client with no cookie is rejected. The bootstrap is what makes login work
    // at all on a clean profile.
    stubCookie('');
    mockFetch((call) => {
      if (call.url.includes('/auth/csrf')) {
        // The server sets the cookie; the stub has to imitate that.
        stubCookie('lms_csrf=fresh');
        return jsonResponse({ success: true, data: { csrfToken: 'fresh' } });
      }
      return jsonResponse({ success: true, data: null });
    });

    await api.post('/auth/login', { email: 'a@b.c', password: 'x' });

    expect(calls.map((c) => c.url)).toEqual([
      expect.stringContaining('/auth/csrf'),
      expect.stringContaining('/auth/login'),
    ]);
    const headers = calls[1]?.init.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('fresh');
  });

  it('does not bootstrap when a token is already present', async () => {
    stubCookie('lms_csrf=existing');
    mockFetch(() => jsonResponse({ success: true, data: null }));

    await api.post('/loans', {});

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).not.toContain('/auth/csrf');
  });

  it('shares one bootstrap across concurrent unsafe requests', async () => {
    stubCookie('');
    mockFetch(async (call) => {
      if (call.url.includes('/auth/csrf')) {
        await Promise.resolve();
        stubCookie('lms_csrf=shared');
        return jsonResponse({ success: true, data: { csrfToken: 'shared' } });
      }
      return jsonResponse({ success: true, data: null });
    });

    // Without single-flighting, three writes on a cold page would race three
    // bootstraps and the last cookie written would not match the first header.
    await Promise.all([
      api.post('/loans', {}),
      api.patch('/loans/1', {}),
      api.post('/members', {}),
    ]);

    const bootstraps = calls.filter((c) => c.url.includes('/auth/csrf'));
    expect(bootstraps).toHaveLength(1);
  });

  it('does not bootstrap for a safe request', async () => {
    stubCookie('');
    mockFetch(() => jsonResponse({ success: true, data: null }));

    await api.get('/auth/me');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).not.toContain('/auth/csrf');
  });

  it('retries the bootstrap on a later request after a failure rather than caching it', async () => {
    stubCookie('');
    let attempt = 0;
    mockFetch((call) => {
      if (call.url.includes('/auth/csrf')) {
        attempt += 1;
        if (attempt === 1)
          return jsonResponse(
            { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' }, requestId: 'r' },
            500,
          );
        stubCookie('lms_csrf=eventually');
        return jsonResponse({ success: true, data: { csrfToken: 'eventually' } });
      }
      return jsonResponse({ success: true, data: null });
    });

    await expect(api.post('/loans', {})).rejects.toThrow();
    stubCookie('');
    await api.post('/loans', {});

    expect(attempt).toBe(2);
  });
});

describe('error handling', () => {
  it('raises ApiError preserving the machine-readable code', async () => {
    stubCookie('lms_csrf=t');
    mockFetch(() =>
      jsonResponse(
        {
          success: false,
          error: { code: 'COPY_ALREADY_ON_LOAN', message: 'Copy is already on loan' },
          requestId: 'req-1',
        },
        409,
      ),
    );

    const error = await api.post('/loans', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe('COPY_ALREADY_ON_LOAN');
    expect(apiError.requestId).toBe('req-1');
    expect(apiError.isUnauthenticated).toBe(false);
  });

  it('flags 401 so the caller can route to login', async () => {
    mockFetch(() =>
      jsonResponse(
        { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } },
        401,
      ),
    );

    const error = (await api.get('/me').catch((e: unknown) => e)) as ApiError;
    expect(error.isUnauthenticated).toBe(true);
  });

  it('preserves field-level validation details', async () => {
    stubCookie('lms_csrf=t');
    mockFetch(() =>
      jsonResponse(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: 'email', message: 'Invalid email' }],
          },
        },
        400,
      ),
    );

    const error = (await api.post('/members', {}).catch((e: unknown) => e)) as ApiError;
    expect(error.details).toEqual([{ path: 'email', message: 'Invalid email' }]);
  });

  it('does not surface a non-JSON error body', async () => {
    // A gateway HTML page would otherwise be rendered into the UI.
    mockFetch(() => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }));

    const error = (await api.get('/books').catch((e: unknown) => e)) as NetworkError;
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).not.toContain('502 Bad Gateway');
  });

  it('rejects a malformed success envelope rather than returning undefined data', async () => {
    mockFetch(() => jsonResponse({ data: 'not-an-envelope' }));

    const error = (await api.get('/books').catch((e: unknown) => e)) as NetworkError;
    expect(error).toBeInstanceOf(NetworkError);
  });

  it('treats 204 as a successful empty result', async () => {
    stubCookie('lms_csrf=t');
    mockFetch(() => new Response(null, { status: 204 }));

    const response = await api.delete('/loans/1');
    expect(response.success).toBe(true);
  });
});

describe('isPaginated', () => {
  it('narrows a list response with meta', () => {
    const response = {
      success: true as const,
      data: [{ id: '1' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    expect(isPaginated(response)).toBe(true);
  });

  it('does not narrow a single-resource response', () => {
    expect(isPaginated({ success: true, data: { id: '1' } })).toBe(false);
  });
});

/*
 * Refresh-and-retry.
 *
 * This is the behaviour with real consequences when it is wrong, so each test
 * states the failure it prevents:
 *
 *   • Not refreshing signs out a user who was idle for fifteen minutes.
 *   • Refreshing in parallel trips refresh-reuse detection, which revokes the
 *     whole token family — the app logs the user out for being busy.
 *   • Retrying a login turns one failed attempt into two, inflating the lockout
 *     counter, and reports the wrong error.
 */
describe('token refresh', () => {
  const unauthenticated = () =>
    jsonResponse(
      { success: false, error: { code: 'UNAUTHENTICATED', message: 'Session expired' } },
      401,
    );

  const refreshed = () => jsonResponse({ success: true, data: { ok: true } });

  it('refreshes once and replays the original request', async () => {
    stubCookie('lms_csrf=t');
    mockFetch((call) =>
      call.url.endsWith('/auth/refresh') ? refreshed() : jsonResponse({ success: true, data: [] }),
    );

    // First attempt 401s, the replay succeeds.
    let firstCall = true;
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/refresh')) return Promise.resolve(refreshed());
      if (firstCall) {
        firstCall = false;
        return Promise.resolve(unauthenticated());
      }
      return Promise.resolve(jsonResponse({ success: true, data: [{ id: 'a' }] }));
    });

    const response = await api.get('/members');

    expect(response.data).toEqual([{ id: 'a' }]);
    expect(calls.filter((call) => call.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/members'))).toHaveLength(2);
  });

  it('collapses concurrent 401s into a single refresh', async () => {
    stubCookie('lms_csrf=t');

    // Every protected call 401s the first time and succeeds after the refresh.
    const seen = new Set<string>();
    let refreshes = 0;

    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });

      if (url.endsWith('/auth/refresh')) {
        refreshes += 1;
        return Promise.resolve(refreshed());
      }

      if (seen.has(url)) return Promise.resolve(jsonResponse({ success: true, data: [] }));
      seen.add(url);
      return Promise.resolve(unauthenticated());
    });

    await Promise.all([api.get('/members'), api.get('/member-types'), api.get('/settings/public')]);

    // Three parallel requests, one refresh. Without single-flight this is 3, and
    // the server's reuse detection revokes the family.
    expect(refreshes).toBe(1);
  });

  it('replays a request at most once', async () => {
    stubCookie('lms_csrf=t');
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/refresh')) return Promise.resolve(refreshed());
      return Promise.resolve(unauthenticated());
    });

    await api.get('/members').catch(() => undefined);

    expect(calls.filter((call) => call.url.endsWith('/members'))).toHaveLength(2);
  });

  it('never retries an auth endpoint, so a wrong password stays one attempt', async () => {
    stubCookie('lms_csrf=t');
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(unauthenticated());
    });

    const error = (await api.post('/auth/login', {}).catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(401);
    // One login, no refresh, no replay: the lockout counter moves exactly once.
    expect(calls.filter((call) => call.url.endsWith('/auth/login'))).toHaveLength(1);
    expect(calls.some((call) => call.url.endsWith('/auth/refresh'))).toBe(false);
  });

  it('does not recurse when the refresh itself is rejected', async () => {
    stubCookie('lms_csrf=t');
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(unauthenticated());
    });

    await api.get('/members').catch(() => undefined);

    expect(calls.filter((call) => call.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('reports the session as lost so the app can clear stale state', async () => {
    stubCookie('lms_csrf=t');
    const onLost = vi.fn();
    setSessionLostHandler(onLost);

    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(unauthenticated());
    });

    await api.get('/members').catch(() => undefined);

    expect(onLost).toHaveBeenCalledTimes(1);
    setSessionLostHandler(() => undefined);
  });

  it('does not sign the user out when the network fails rather than the token', async () => {
    stubCookie('lms_csrf=t');
    const onLost = vi.fn();
    setSessionLostHandler(onLost);

    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    const error = (await api.get('/members').catch((e: unknown) => e)) as NetworkError;

    expect(error).toBeInstanceOf(NetworkError);
    // A transport failure says nothing about the session. Treating it as an
    // expiry would sign a librarian out every time the wifi blinks.
    expect(onLost).not.toHaveBeenCalled();
    setSessionLostHandler(() => undefined);
  });
});
