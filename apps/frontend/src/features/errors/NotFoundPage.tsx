import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { paths } from '../../routes/paths';

/**
 * 404.
 *
 * Sits inside the app shell, so the navigation stays available — a user who
 * followed a stale link in a bookmark bar can still get where they were going
 * without pressing Back through the history.
 *
 * The path is not echoed. A 404 that renders whatever was in the URL turns the
 * page into a reflected-XSS vector if the string ever reaches an `innerHTML`, and
 * it buys nothing: the person reading it already knows what they clicked.
 */
export function NotFoundPage(): ReactNode {
  return (
    <div className="state-page">
      <p className="state-page__code">404</p>
      <h1 className="state-page__title">That page does not exist</h1>
      <p className="state-page__message">
        The address may be mistyped, or the page may have been moved when a module was replaced.
      </p>
      <div className="state-page__actions">
        <Link to={paths.dashboard}>
          <Button variant="primary">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
