import type { ErrorEnvelope, PaginationMeta, SuccessEnvelope } from '@lms/shared';

/**
 * A paginated list response.
 *
 * `meta` is promoted from optional to required here. Every list route the app
 * calls returns it (`sendPaginated` always attaches it), and a list view needs the
 * total to render pagination at all. Keeping it optional would push an
 * `if (!meta)` branch into every consumer to handle a case the server cannot
 * produce.
 */
export type Paginated<T> = SuccessEnvelope<T[]> & { meta: PaginationMeta };

/**
 * Typed API client.
 *
 * Security posture, and why it is written this way:
 *
 *   • `credentials: 'include'` on every call. Access credentials live in
 *     HttpOnly cookies, so nothing sensitive is ever stored in
 *     localStorage/sessionStorage — those are readable by any script that
 *     achieves XSS, and an XSS there would be a full account takeover.
 *
 *   • CSRF token sent as a header on every unsafe method. The cookie alone does
 *     not stop a cross-site form post; the header cannot be set cross-origin
 *     without a successful preflight.
 *
 *   • `Accept: application/json` on every request. Without it the backend may
 *     negotiate HTML, and an error page rendered into the DOM is a script
 *     execution surface.
 *
 * This client provides transport only. Authorization is decided server-side on
 * every request — hiding a button here is a UX affordance, never a control.
 */

export const API_BASE_URL = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

// Must match the backend's CSRF_COOKIE_NAME / CSRF_HEADER_NAME defaults
// (apps/backend/src/config/env.ts). Overridable because the names are
// configurable server-side; the VITE_ prefix is how Vite exposes them.
const CSRF_COOKIE = import.meta.env['VITE_CSRF_COOKIE_NAME'] ?? 'lms_csrf';
const CSRF_HEADER = import.meta.env['VITE_CSRF_HEADER_NAME'] ?? 'x-csrf-token';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Refresh-and-retry.
 *
 * Access tokens live in an HttpOnly cookie with a 15-minute TTL while the
 * refresh token lasts 30 days. Without this, a librarian who leaves a screen open
 * through the afternoon is silently signed out mid-task and loses a half-typed
 * form — the failure looks like the application being unreliable.
 *
 * Two rules make it safe:
 *
 *   1. **Single-flight.** Concurrent 401s share one refresh. Without this, six
 *      parallel dashboard requests each start a refresh, and the server's reuse
 *      detection correctly treats the second one as a stolen token and revokes
 *      the whole family — logging the user out for being busy.
 *   2. **Never replay an auth endpoint.** `POST /auth/login` and friends return
 *      401 for a wrong password. Retrying those would turn one failed attempt into
 *      two, trip the lockout counter, and hide the real error behind a refresh
 *      failure.
 */
let refreshInFlight: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

/** Registered by the auth provider so a dead session can clear client state. */
export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = apiFetch<unknown>('/auth/refresh', {
      method: 'POST',
      // The refresh token is sent as a cookie. The body must be non-empty for the
      // server's JSON parser, and an empty object is the honest "no arguments".
      body: {},
      skipRefresh: true,
    })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

/** An error the server described, with the machine-readable code preserved. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: unknown;
  /** True when the caller should send the user back to the login screen. */
  readonly isUnauthenticated: boolean;

  constructor(body: ErrorEnvelope, status: number, requestId?: string) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
    this.requestId = requestId;
    this.isUnauthenticated = status === 401;
  }
}

/** The request did not complete, so no API error body exists to report. */
export class NetworkError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Reads the CSRF token from its cookie.
 *
 * The CSRF cookie is intentionally NOT HttpOnly — the client has to be able to
 * read it to echo it in a header. That is safe: the token is worthless without
 * the session cookie, which is HttpOnly, and a forged header requires a preflight.
 */
function readCsrfToken(): string | undefined {
  const prefix = `${CSRF_COOKIE}=`;
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

/**
 * In-flight bootstrap, shared so a burst of concurrent writes makes one request.
 *
 * `null` means "not currently fetching". It is reset in `finally` rather than on
 * success only, so a failed bootstrap does not poison every later write with a
 * cached rejection — but it is not cached as a failure either, so the next write
 * tries again.
 */
let csrfBootstrap: Promise<void> | null = null;

/**
 * Fetches a CSRF cookie if the client does not have one yet.
 *
 * The backend runs `verifyCsrf` *before* `issueCsrfToken` on every unsafe route,
 * which is correct and creates a chicken-and-egg problem: a brand-new browser has
 * no token to present, so the very first login is rejected with CSRF_INVALID.
 * `GET /auth/csrf` exists to break that loop — it is a safe method, so
 * `verifyCsrf` exempts it, and its response sets the cookie.
 *
 * This is called from the unsafe path rather than once at start-up because the
 * cookie is not guaranteed to survive: an expired session, a cleared cookie, or
 * a cookie rotation all leave the client holding a session but no token.
 */
async function ensureCsrfToken(): Promise<void> {
  if (readCsrfToken()) return;

  csrfBootstrap ??= apiFetch<unknown>('/auth/csrf', {
    // A public endpoint cannot 401, and a refresh attempt here would recurse
    // through the bootstrap itself.
    skipRefresh: true,
  })
    .then(() => undefined)
    .finally(() => {
      csrfBootstrap = null;
    });

  await csrfBootstrap;

  if (!readCsrfToken()) {
    throw new NetworkError(
      'The server did not return a CSRF token. Cookies may be blocked for this site.',
    );
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Parsed as JSON and sent as the request body. */
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Bypass the `/api/v1` prefix — for endpoints like `/health` that sit outside it. */
  absolute?: boolean;
  /**
   * Send without cookies. Only for unauthenticated liveness probes, which must
   * still answer while the session store is unavailable.
   */
  omitCredentials?: boolean;
  /**
   * Suppress the refresh-and-retry behaviour. Set on the refresh call itself, so
   * a failed refresh cannot recurse into another refresh.
   */
  skipRefresh?: boolean;
  /** Set by the retry so an auth endpoint is never replayed against a new token. */
  isRetry?: boolean;
}

function buildUrl(path: string, query: RequestOptions['query'], absolute?: boolean): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  const base = absolute ? '' : API_BASE_URL;
  const url = `${base}${normalised}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  }

  const serialised = params.toString();
  return serialised ? `${url}?${serialised}` : url;
}

/**
 * Combines a caller-supplied signal with a timeout so a hung request cannot
 * leave a spinner up forever.
 */
function withTimeout(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

  const forward = (): void => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) forward();
    else external.addEventListener('abort', forward, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', forward);
    },
  };
}

function isApiErrorBody(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { success?: unknown; error?: { code?: unknown; message?: unknown } };
  return (
    candidate.success === false &&
    typeof candidate.error?.code === 'string' &&
    typeof candidate.error?.message === 'string'
  );
}

/**
 * Paths that must never be replayed after a refresh.
 *
 * A 401 from these means the credential itself was rejected — a wrong password, an
 * expired reset token, a used verification token. Retrying turns one attempt into
 * two, increments the lockout counter, and reports a refresh failure instead of
 * the actual error the user needs to read.
 */
const NON_RETRYABLE_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/auth/change-password',
] as const;

function isAuthPath(path: string): boolean {
  return NON_RETRYABLE_PATHS.some((candidate) => path.startsWith(candidate));
}

/**
 * Checks the success envelope before trusting it.
 *
 * Without this, any 200 response that is not an envelope — a proxy returning
 * `{}`, a captive portal returning `{"success":true}` — would be cast and read
 * as `undefined` deep inside a component, surfacing as a blank screen instead of
 * an error.
 */
function isSuccessEnvelope(value: unknown): value is SuccessEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { success?: unknown; data?: unknown };
  return candidate.success === true && 'data' in candidate;
}

export async function apiFetch<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<SuccessEnvelope<TData>> {
  const {
    method = 'GET',
    body,
    query,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    absolute,
    omitCredentials = false,
    skipRefresh = false,
    isRetry = false,
  } = options;

  const headers = new Headers({ Accept: 'application/json' });

  let payload: string | undefined;
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }

  if (UNSAFE_METHODS.has(method)) {
    // Bootstraps only when the cookie is genuinely absent, so the common case is
    // one `document.cookie` read and no extra request.
    await ensureCsrfToken();
    const token = readCsrfToken();
    // Sending an empty token is worse than sending none: a blank header is
    // rejected, but it hides a genuine misconfiguration behind a 403 that looks
    // like a permission problem.
    if (!token) {
      throw new NetworkError('No CSRF token available. Is the session cookie missing?');
    }
    headers.set(CSRF_HEADER, token);
  }

  const { signal: requestSignal, cleanup } = withTimeout(timeoutMs, signal);

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query, absolute), {
      method,
      headers,
      // Omitted rather than set to undefined: a GET with `body: undefined` is a
      // TypeError under exactOptionalPropertyTypes, and some runtimes reject a
      // body on a method that must not have one.
      ...(payload !== undefined ? { body: payload } : {}),
      // Health checks are unauthenticated and must answer during an outage, so
      // they are sent without cookies. Everything else carries credentials.
      credentials: omitCredentials ? 'omit' : 'include',
      signal: requestSignal,
      // Never let a proxy or the browser cache an authenticated response.
      cache: 'no-store',
    });
  } catch (error) {
    cleanup();
    if (signal?.aborted) throw error;
    throw new NetworkError('Could not reach the server. Check your connection.', error);
  } finally {
    cleanup();
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;

  if (response.status === 204) {
    return { success: true, data: undefined as TData };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // A non-JSON body means something other than the API answered — a proxy
    // error page, or a gateway timeout. Surfacing its text would leak
    // infrastructure detail into the UI.
    throw new NetworkError(`Unexpected non-JSON response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    if (response.status === 401 && !skipRefresh && !isRetry && !isAuthPath(path)) {
      const refreshed = await refreshSession();

      if (refreshed) {
        // One retry only. If the replayed request also 401s, the session is not
        // recoverable and retrying again would loop.
        return apiFetch<TData>(path, { ...options, isRetry: true });
      }

      // The refresh token is spent or revoked. Tell the app so it can clear
      // client state and send the user to sign in again.
      onSessionLost?.();
    }

    if (isApiErrorBody(parsed)) throw new ApiError(parsed, response.status, requestId);
    throw new NetworkError(`Request failed (HTTP ${response.status})`);
  }

  if (!isSuccessEnvelope(parsed)) {
    throw new NetworkError(
      `Malformed response from ${requestId ? `request ${requestId}` : 'the server'}`,
    );
  }

  return parsed as SuccessEnvelope<TData>;
}

export const api = {
  get: <TData>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<TData>(path, { ...options, method: 'GET' }),
  post: <TData>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<TData>(path, { ...options, method: 'POST', body }),
  put: <TData>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<TData>(path, { ...options, method: 'PUT', body }),
  patch: <TData>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<TData>(path, { ...options, method: 'PATCH', body }),
  delete: <TData>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<TData>(path, { ...options, method: 'DELETE' }),
};

/** Narrowing helper for a paginated list response. */
export function isPaginated(
  response: SuccessEnvelope<unknown>,
): response is SuccessEnvelope<unknown[]> & { meta: PaginationMeta } {
  return response.meta !== undefined && Array.isArray(response.data);
}

export interface HealthPayload {
  status: string;
  environment: string;
  uptimeSeconds: number;
  version: string;
}

/**
 * Liveness probe, outside `/api/v1`.
 *
 * Sent without credentials: an orchestrator and this shell both need it, so it
 * must not depend on a session.
 */
export function getHealth(options: { signal?: AbortSignal } = {}) {
  return apiFetch<HealthPayload>('/health', {
    ...options,
    absolute: true,
    omitCredentials: true,
  });
}
