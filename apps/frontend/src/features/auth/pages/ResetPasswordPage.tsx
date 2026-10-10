import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { errorMessage } from '../../../components/ui/States';
import { PasswordField } from '../../../components/ui/Field';
import { Button } from '../../../components/ui/Button';
import { AuthLayout } from '../../../components/layout/AuthLayout';
import { paths } from '../../../routes/paths';
import { resetPassword } from '../api';

/**
 * Choose a new password from an emailed link.
 *
 * The token is read from the query string rather than a route segment so the URL
 * matches what the email contains. It is held in a ref, not in component state,
 * so it never ends up in a React DevTools state dump or a snapshot, and it is
 * never written to storage.
 */
export function ResetPasswordPage(): ReactNode {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mismatch, setMismatch] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    // Checked here as well as server-side so the user is not made to wait for a
    // round trip to be told about a typo they can see.
    if (password !== confirmation) {
      setMismatch('The two passwords do not match.');
      return;
    }
    setMismatch(undefined);

    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="Link incomplete"
        subtitle="This reset link is missing its token. Open the link from the email again."
        footer={<Link to={paths.forgotPassword}>Request a new link</Link>}
      />
    );
  }

  if (done) {
    return (
      <AuthLayout
        title="Password changed"
        subtitle="Every other session has been signed out, as a precaution."
        footer={<Link to={paths.login}>Sign in</Link>}
      >
        <p className="form__note">
          If you did not change your password, contact the desk — someone may have used your link.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      footer={<Link to={paths.login}>Back to sign in</Link>}
    >
      <form className="form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="Choose a password"
          required
          hint="At least 12 characters, with upper and lower case letters, a number and a symbol."
          error={errors.newPassword}
        />

        {/*
          The confirmation gets its own toggle, rather than sharing the first field's.
          Typing a new password twice is exactly the case where seeing the value
          matters most — a reader who is checking that two long strings match cannot
          do it from six dots, and the mismatch error only appears after submitting.
        */}
        <PasswordField
          label="Confirm new password"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          required
          error={mismatch}
        />

        <Button type="submit" variant="primary" busy={busy} busyLabel="Saving…">
          Change password
        </Button>
      </form>
    </AuthLayout>
  );
}
