import { ApiError, NetworkError } from '../lib/api';

/**
 * What a `GET /auth/me` check actually established.
 *
 * Three outcomes, not two. Collapsing "the server said no" together with "the
 * server did not answer" is what made an API outage indistinguishable from a
 * rejected password — the user was shown a login form for a session that was never
 * tested, and the resulting report read as "admin and librarian cannot log in".
 * It is also why the bug looked role-specific when it was entirely role-agnostic.
 */
export type SessionCheck =
  | { outcome: 'session' }
  | { outcome: 'anonymous' }
  | { outcome: 'unreachable'; reason: string };

/**
 * Classifies a thrown error from the session check.
 *
 * Only a 401 is a statement about the session. Everything else is a failure to
 * obtain one, and must not clear the session the user already holds.
 */
export function classifySessionCheck(error: unknown): SessionCheck {
  if (error instanceof ApiError && error.status === 401) {
    return { outcome: 'anonymous' };
  }

  if (error instanceof NetworkError) {
    return {
      outcome: 'unreachable',
      reason: 'Cannot reach the server. Check that the API is running.',
    };
  }

  if (error instanceof ApiError) {
    return { outcome: 'unreachable', reason: `Could not verify your session: ${error.message}` };
  }

  return { outcome: 'unreachable', reason: 'Could not verify your session: unexpected error' };
}
