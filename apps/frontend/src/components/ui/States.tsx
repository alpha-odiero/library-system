import type { ReactNode } from 'react';
import { ApiError, NetworkError } from '../../lib/api';
import { Icon, type IconName } from './Icon';

/**
 * The three states every data view must handle.
 *
 * They are separate components rather than one `<Async>` wrapper because they
 * appear in different places: a skeleton belongs to a table, an error to a card,
 * and an empty state to a specific column region. Hiding all three inside a
 * wrapper is how a page ends up replacing an entire form with a spinner.
 */

export function Skeleton({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton__row" key={index} />
      ))}
    </div>
  );
}

/**
 * A loading region that announces itself once.
 *
 * `role="status"` with visually hidden text is what a screen reader hears; the
 * bars themselves are decorative and hidden, so the user is told "loading" rather
 * than being read a list of empty rectangles.
 */
export function LoadingState({
  label = 'Loading…',
  rows = 3,
}: {
  label?: string;
  rows?: number;
}): ReactNode {
  return (
    <div role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <Skeleton rows={rows} />
    </div>
  );
}

/**
 * A readable message for any thrown value.
 *
 * The one thing this never does is show a raw status code or an internal message.
 * A 403 says the page is not available to this account; a 500 says to try again;
 * `NetworkError` says the server could not be reached. Anything more specific is
 * logged with the request id, not rendered.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'You do not have permission to view this.';
    if (error.status === 404) return 'That record no longer exists.';
    if (error.status === 422) return error.message;
    if (error.status >= 500)
      return 'The server could not complete that request. Try again shortly.';
    return error.message;
  }

  if (error instanceof NetworkError) return error.message;
  return 'Something went wrong. Try again.';
}

/** Whether a failure is worth offering a retry button for. */
function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) return error.status >= 500;
  return false;
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): ReactNode {
  const message = errorMessage(error);

  return (
    <div className="state state--error" role="alert">
      <p className="state__message">{message}</p>
      {isRetryable(error) && onRetry && (
        <button type="button" className="btn btn--secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /**
   * A glyph in a light circle above the title.
   *
   * Dashboards stack four or five of these in a narrow column when the library is
   * new, and a bare sentence in a dashed box reads as a row of failures. The
   * circle gives each one a centre so the card looks deliberately empty rather
   * than accidentally blank — and it stays decorative, because the title and
   * description beside it already say everything the icon says.
   */
  icon?: IconName;
}): ReactNode {
  return (
    <div className="state state--empty">
      {icon && (
        <span className="state__art" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
      )}
      <p className="state__title">{title}</p>
      {description && <p className="state__description">{description}</p>}
      {action && <div className="state__action">{action}</div>}
    </div>
  );
}
