import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import { errorMessage } from '../../../components/ui/States';
import { TextField } from '../../../components/ui/Field';
import { Button } from '../../../components/ui/Button';
import { AuthLayout } from '../../../components/layout/AuthLayout';
import { paths } from '../../../routes/paths';
import { forgotPassword } from '../api';

/**
 * Request a password reset.
 *
 * The confirmation is shown regardless of whether the address exists. The
 * backend answers 202 for an unknown address on purpose; mirroring that with a
 * "we emailed you" message for a real account and silence for a fake one would
 * turn this form into a membership oracle, which is the single most common
 * finding in a penetration test of a library system.
 */
export function ForgotPasswordPage(): ReactNode {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFormError(null);

    try {
      await forgotPassword(email);
      setSent(true);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            If <strong>{email}</strong> has an account, a reset link is on its way. The link
            expires, so use it soon.
          </>
        }
        footer={<Link to={paths.login}>Back to sign in</Link>}
      >
        <p className="form__note">
          Nothing arrived? Check the spam folder, or ask the desk to confirm the address on file.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We will email you a link to choose a new one."
      footer={<Link to={paths.login}>Back to sign in</Link>}
    >
      <form className="form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          inputMode="email"
          required
        />

        <Button type="submit" variant="primary" busy={busy} busyLabel="Sending link…">
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
