import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { paths } from '../../routes/paths';

/**
 * 403.
 *
 * It names the permission that was missing when it can be known, and it does not
 * leak what the resource contains. "You need MEMBER_DELETE to do that" is a
 * statement about the user's own account; a 403 page that says "you cannot view
 * Amina's loan history" confirms the record exists and turns the page into a
 * probing tool.
 *
 * The attempted path is echoed back only after it is decoded from router state,
 * never from the query string, so a crafted link cannot inject arbitrary text into
 * the page.
 */
export function ForbiddenPage(): ReactNode {
  const { session } = useAuth();
  const location = useLocation();
  const attempted = (location.state as { from?: string } | null)?.from;

  return (
    <div className="state-page">
      <p className="state-page__code">403</p>
      <h1 className="state-page__title">You do not have access to that</h1>
      <p className="state-page__message">
        {session
          ? `Your role (${session.roleCode}) does not include permission for this page.`
          : 'You need to be signed in to see that page.'}
      </p>
      {attempted && (
        <p className="state-page__meta">
          Attempted: <code className="code">{attempted}</code>
        </p>
      )}
      <div className="state-page__actions">
        <Link to={paths.dashboard}>
          <Button variant="primary">Back to dashboard</Button>
        </Link>
        {session && (
          <Link to={paths.profile}>
            <Button variant="ghost">Your permissions</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
