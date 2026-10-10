import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { PermissionCode, RoleCode } from '@lms/shared';
import { useAuth } from '../contexts/AuthContext';
import { paths } from './paths';
import { dashboardPathFor } from './roleRoutes';

/**
 * Route guards.
 *
 * Both guards run **before** the protected component mounts, so an unauthorised
 * user never triggers its data fetch. That matters for more than tidiness: a page
 * that fires `GET /reports/financial` before checking permissions generates a 403
 * in the log for every navigation attempt, and a page that fetched-then-hid would
 * put data in the network tab of someone who may not see it.
 *
 * These are UX gates. The backend re-checks every request — see
 * `docs/authorization/authorization.md`. A user who edits this file to bypass a
 * guard reaches a page full of 403s and learns nothing.
 */

/** Splash shown while `/auth/me` is in flight. */
function SessionSplash({ label }: { label: string }): ReactNode {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash__mark" aria-hidden="true" />
      <p className="splash__label">{label}</p>
    </div>
  );
}

/**
 * Shown when the session state is genuinely unknown — the API is down, or the
 * check failed for a reason other than "not signed in".
 *
 * This exists so an outage is never reported as a rejected login. Redirecting to
 * `/login` here would tell the user their credentials were wrong when the truth is
 * that nobody checked, and would send them to retype a password that was fine.
 */
function SessionUnavailable({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div className="splash" role="alert">
      <div className="splash__mark" aria-hidden="true" />
      <p className="splash__label">Cannot check your session</p>
      <p className="splash__label">{reason}</p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/**
 * Requires a signed-in user.
 *
 * Remembers where they were heading. Without that, following a bookmarked
 * `/members/123` while signed out would land on the dashboard after login, and
 * the original intent is lost.
 */
export function RequireAuth(): ReactNode {
  const { session, initialising, sessionExpired, unreachable, retry } = useAuth();
  const location = useLocation();

  if (initialising) return <SessionSplash label="Restoring your session…" />;

  // Unknown session state is not "signed out". Show the reason rather than a
  // login form that would imply the credentials had been checked and rejected.
  if (unreachable) return <SessionUnavailable reason={unreachable} onRetry={() => void retry()} />;

  if (!session) {
    return (
      <Navigate
        to={paths.login}
        replace
        state={{
          from: `${location.pathname}${location.search}`,
          expired: sessionExpired,
        }}
      />
    );
  }

  return <Outlet />;
}

/**
 * Requires specific permissions.
 *
 * `any` semantics on the client would mirror the backend's OR rule; `all` is
 * available for pages that genuinely need several, such as editing a member type
 * (view plus manage).
 */
export function RequirePermission({
  permissions,
  mode = 'any',
}: {
  permissions: readonly PermissionCode[];
  mode?: 'any' | 'all';
}): ReactNode {
  const { can, canAll } = useAuth();

  const granted = mode === 'all' ? canAll(permissions) : permissions.some(can);
  if (!granted) return <Navigate to={paths.forbidden} replace />;

  return <Outlet />;
}

/**
 * Requires one of several roles.
 *
 * The mirror of `RequirePermission` for the handful of screens where "which kind
 * of account is this" is the real question — the role dashboards themselves.
 * Everywhere else the permission gates below are the sharper tool, because a
 * grant can be changed in the database without touching this file.
 *
 * A wrong-role visitor is bounced to their OWN dashboard rather than to
 * `/forbidden`: this is a UX gate, not a control (the API re-checks everything),
 * and a member who follows a stale `/admin/dashboard` bookmark should land
 * somewhere useful rather than on a wall explaining what just happened.
 */
export function RequireRole({ roles }: { roles: readonly RoleCode[] }): ReactNode {
  const { session } = useAuth();

  if (!session || !roles.includes(session.roleCode)) {
    return <Navigate to={session ? dashboardPathFor(session.roleCode) : paths.login} replace />;
  }

  return <Outlet />;
}

/**
 * Keeps a signed-in user off the login and registration screens.
 *
 * Without this, a signed-in librarian who navigates to `/login` sees a login form
 * that silently fails, because the same-origin cookie is already set and the
 * credentials are not checked again.
 */
export function RequireAnonymous(): ReactNode {
  const { session, initialising, unreachable } = useAuth();

  if (initialising) return <SessionSplash label="Restoring your session…" />;

  // Nothing to redirect away from while the session is unknown — and bouncing to
  // /login is exactly the false "you are signed out" message this guard exists to
  // avoid. `RequireAuth` renders the retry affordance for the same condition.
  if (unreachable) return <Outlet />;

  if (session) return <Navigate to={dashboardPathFor(session.roleCode)} replace />;

  return <Outlet />;
}
