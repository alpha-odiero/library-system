import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PermissionCode, RoleCode } from '@lms/shared';
import { resetCsrfToken, setSessionLostHandler } from '../lib/api';
import { startRealtime, stopRealtime } from '../lib/realtime';
import { clearReferenceCache } from '../lib/referenceCache';
import type { MeResponse } from '../lib/contracts';
import * as authApi from '../features/auth/api';
import { classifySessionCheck } from './sessionCheck';

/**
 * Session state for the whole app.
 *
 * One `GET /auth/me` on boot decides everything: whether the user is signed in,
 * which navigation to render, and which routes to admit. The permissions in that
 * response are a *convenience cache of what the server already decided* — the
 * backend re-checks every request, so a stale or forged client permission list
 * grants nothing. Hiding a link is UX; the 403 from the API is the control.
 */
export interface AuthState {
  /** Null until the boot check finishes. Renders the splash, not a login form. */
  session: MeResponse | null;
  /** True only during the initial `/auth/me`, so the splash does not flash. */
  initialising: boolean;
  /** True when the session ended and the user must sign in again. */
  sessionExpired: boolean;
  /**
   * Set when `/auth/me` could not be reached — the API is down, or a request
   * failed for a reason other than "not signed in". Distinct from having no
   * session: the user is NOT signed out, they are unable to be told either way,
   * and sending them to a login form would be a lie the server never told.
   */
  unreachable: string | null;
  /**
   * Signs in and returns the confirmed session.
   *
   * Returning it is what lets the login page redirect to the role's own
   * dashboard in the same tick — reading `session` back from state after the
   * await would see the value from the render that started the call.
   */
  signIn: (email: string, password: string, loginAs?: RoleCode) => Promise<MeResponse>;
  signOut: () => Promise<void>;
  /** Re-reads `/auth/me`, e.g. after a permission-affecting change. */
  refresh: () => Promise<void>;
  /** Retries the boot check after an `unreachable` failure. */
  retry: () => Promise<void>;
  /** Does the session hold this permission? `false` while unknown. */
  can: (permission: PermissionCode) => boolean;
  /** Does the session hold every one of these? */
  canAll: (permissions: readonly PermissionCode[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<MeResponse | null>(null);
  const [initialising, setInitialising] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [unreachable, setUnreachable] = useState<string | null>(null);

  /**
   * The outcome of a session check, as a value rather than as state read back out
   * of the closure.
   *
   * Returning the failure reason matters: `setUnreachable` does not update the
   * `unreachable` binding until the next render, so a caller that reads the
   * variable immediately after `load()` sees the previous value and silently
   * believes the check succeeded.
   */
  type LoadResult =
    | { outcome: 'session'; session: MeResponse }
    | { outcome: 'anonymous' }
    | { outcome: 'unreachable'; reason: string };

  const load = useCallback(async (): Promise<LoadResult> => {
    try {
      const response = await authApi.me();
      setSession(response.data);
      setSessionExpired(false);
      setUnreachable(null);
      return { outcome: 'session', session: response.data };
    } catch (error) {
      // The decision itself lives in `sessionCheck.ts` so it can be tested without a
      // renderer. Only a 401 may clear the session; every other failure records a
      // reason and leaves the existing session alone.
      const check = classifySessionCheck(error);

      if (check.outcome === 'unreachable') {
        setUnreachable(check.reason);
        return { outcome: 'unreachable', reason: check.reason };
      }

      setSession(null);
      setSessionExpired(false);
      setUnreachable(null);
      return { outcome: 'anonymous' };
    }
  }, []);

  const boot = useCallback(async (): Promise<void> => {
    setInitialising(true);
    try {
      await load();
    } finally {
      setInitialising(false);
    }
  }, [load]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // The SSE stream only talks to signed-in users. Start it the moment a session
  // exists and tear it down the moment it does not — sign-out, expiry, session
  // loss. Depending on the boolean rather than the session object keeps a refresh
  // (`/auth/me`) from dropping and reopening an identical connection.
  const signedIn = session !== null;
  useEffect(() => {
    if (signedIn) {
      startRealtime();
    } else {
      stopRealtime();
    }
  }, [signedIn]);

  // Cached reference data — above all the branch list — is scoped to the signed-in
  // user. Drop it whenever the identity changes, including on sign-out and session
  // loss, so a picker on a shared browser never offers the previous account's
  // branches to the next one.
  const signedInUserId = session?.userId ?? null;
  useEffect(() => {
    clearReferenceCache();
  }, [signedInUserId]);

  // The API client calls this when a refresh fails, which is the only reliable
  // moment to learn a session is gone: the user may have been idle for hours.
  useEffect(() => {
    setSessionLostHandler(() => {
      setSession(null);
      setSessionExpired(true);
      setUnreachable(null);
      // A refresh failed, which means the session — and with it the CSRF cookie —
      // is gone. Forget the cached token so the next sign-in bootstraps a fresh,
      // matching pair.
      resetCsrfToken();
    });
    return () => setSessionLostHandler(() => undefined);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, loginAs?: RoleCode): Promise<MeResponse> => {
      await authApi.login(email, password, loginAs);
      setSessionExpired(false);

      // The cookie is set, but that is not yet proof of a usable session. If
      // `/auth/me` cannot confirm it, rethrow with the real reason so the form
      // says what went wrong, instead of leaving the user looking at a login page
      // that appears to have ignored their credentials.
      const result = await load();
      if (result.outcome === 'unreachable') {
        throw new Error(result.reason);
      }
      if (result.outcome === 'anonymous') {
        // The server accepted the credentials but the session did not survive to
        // the boot check — a blocked cookie, most often. Throwing states it,
        // where falling through would navigate and be bounced straight back to
        // this form with no message at all.
        throw new Error('Your session could not be established. Please try again.');
      }
      return result.session;
    },
    [load],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The local session is cleared regardless. A user who asked to sign out
      // must end up signed out even if the network call failed.
    }
    setSession(null);
    setUnreachable(null);
    setSessionExpired(false);
  }, []);

  const can = useCallback(
    (permission: PermissionCode) => session?.permissions.includes(permission) ?? false,
    [session],
  );

  const canAll = useCallback(
    (permissions: readonly PermissionCode[]) =>
      permissions.every((permission) => session?.permissions.includes(permission) ?? false),
    [session],
  );

  const value = useMemo<AuthState>(
    () => ({
      session,
      initialising,
      sessionExpired,
      unreachable,
      signIn,
      signOut,
      refresh: () => load().then(() => undefined),
      retry: boot,
      can,
      canAll,
    }),
    [session, initialising, sessionExpired, unreachable, signIn, signOut, load, boot, can, canAll],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** The session, for components that cannot render without one. */
export function useSession(): MeResponse {
  const { session } = useAuth();
  if (!session) throw new Error('useSession was called outside an authenticated route');
  return session;
}
