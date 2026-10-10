import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import { errorMessage } from '../../../components/ui/States';
import { AuthLayout } from '../../../components/layout/AuthLayout';
import { paths } from '../../../routes/paths';
import { verifyEmail } from '../api';

type Outcome = 'verifying' | 'verified' | 'failed';

/**
 * Consumes an email verification link.
 *
 * Fires once per token, guarded by a ref. React 19 mounts effects twice in
 * strict mode, and a second `POST /auth/verify-email` against an already-consumed
 * token returns 400 — the user would see their verification bounce back as a
 * failure after it had actually succeeded.
 */
export function VerifyEmailPage(): ReactNode {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [outcome, setOutcome] = useState<Outcome>(token ? 'verifying' : 'failed');
  const [message, setMessage] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void verifyEmail(token)
      .then(() => setOutcome('verified'))
      .catch((error: unknown) => {
        setOutcome('failed');
        setMessage(error instanceof ApiError ? error.message : errorMessage(error));
      });
  }, [token]);

  return (
    <AuthLayout
      title={
        outcome === 'verified'
          ? 'Email confirmed'
          : outcome === 'verifying'
            ? 'Confirming your email…'
            : 'Could not confirm that link'
      }
      footer={<Link to={paths.login}>Back to sign in</Link>}
    >
      {outcome === 'verifying' && (
        <p className="form__note" role="status" aria-live="polite">
          One moment…
        </p>
      )}

      {outcome === 'verified' && (
        <p className="form__note">
          Your address is confirmed. Sign in to pick up where you left off.
        </p>
      )}

      {outcome === 'failed' && (
        <>
          {message && (
            <p className="form__error" role="alert">
              {message}
            </p>
          )}
          <p className="form__note">
            Verification links expire and can be used once. Ask the desk to reissue one.
          </p>
        </>
      )}
    </AuthLayout>
  );
}
