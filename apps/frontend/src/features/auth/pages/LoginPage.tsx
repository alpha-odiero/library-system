import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { RoleCode } from '@lms/shared';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { errorMessage } from '../../../components/ui/States';
import { CheckboxField, PasswordField, TextField } from '../../../components/ui/Field';
import { Button } from '../../../components/ui/Button';
import { AuthLayout } from '../../../components/layout/AuthLayout';
import { useAuth } from '../../../contexts/AuthContext';
import { paths } from '../../../routes/paths';
import { dashboardPathFor } from '../../../routes/roleRoutes';

/**
 * Sign-in.
 *
 * The form does one thing the server cannot: it never tells the user which part
 * was wrong. The backend returns one generic 401 for an unknown address, a wrong
 * password, a suspended account and an unverified email alike, and this page
 * preserves that. Marking "email not registered" in red would turn the login form
 * into an account-existence oracle, which is the exact leak `auth.service.ts` goes
 * out of its way to avoid.
 *
 * The account-type selector is a second, narrower exception: once the password
 * has VERIFIED, a mismatched selection is reported as a 422 naming the account's
 * real type. That message is only ever shown to someone who already proved they
 * own the credentials, so it reveals nothing an attacker could use — and without
 * it, picking the wrong tab would look like the app ignored a correct password.
 */

/** The selectable account types, in the order they appear on the control. */
const LOGIN_ROLES: readonly { code: RoleCode; label: string }[] = [
  { code: 'ADMIN', label: 'Administrator' },
  { code: 'LIBRARIAN', label: 'Librarian' },
  { code: 'MEMBER', label: 'Member' },
];

export function LoginPage(): ReactNode {
  const { signIn, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /**
   * Which account type the user claims to be signing in as.
   *
   * Defaults to Administrator because public registration — the app's only
   * self-serve entry point — creates one, so the first sign-in after
   * "Register your library" is almost always that account. Every other type
   * switches once; the server's 422 message says which to pick.
   */
  const [loginAs, setLoginAs] = useState<RoleCode>('ADMIN');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * "Keep me signed in".
   *
   * The session cookie is issued by the server, so this control cannot grant a
   * longer-lived session by itself — it only decides whether the browser is asked
   * to persist the cookie across a close. It is therefore honest only if it says so:
   * the hint states that the choice is remembered on this device, which is the part
   * that is actually true, rather than implying a different kind of sign-in.
   */
  const [remember, setRemember] = useState(() => {
    try {
      return localStorage.getItem('soma360.remember') === '1';
    } catch {
      // Private-browsing modes and a blocked storage partition both throw here. A
      // login form must still render, so the default is simply "do not remember".
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('soma360.remember', remember ? '1' : '0');
    } catch {
      // Nothing to do: the preference simply will not survive a reload.
    }
  }, [remember]);

  // Where the guard wanted to go before it redirected here, and whether the user
  // arrived straight from the registration form.
  const from = (location.state as { from?: string } | null)?.from ?? paths.dashboard;
  const justRegistered = (location.state as { registered?: boolean } | null)?.registered === true;

  // The session was lost mid-visit (a refresh failed). Say so, because landing on
  // a login form with no explanation looks like the app forgot the user.
  useEffect(() => {
    if (sessionExpired) setFormError('Your session expired. Please sign in again.');
  }, [sessionExpired]);

  // Registration deliberately does not sign the user in, so landing here with no
  // confirmation would read as though the account creation had failed.
  const [notice, setNotice] = useState<string | null>(
    justRegistered ? 'Account created. Sign in to continue.' : null,
  );

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    // The confirmation has served its purpose; leaving it up while an error
    // renders reads as two competing outcomes.
    setNotice(null);
    setErrors({});

    try {
      const session = await signIn(email, password, loginAs);
      // A deep link wins; otherwise the role's own dashboard, so a librarian
      // lands on the librarian dashboard rather than on whatever `/` happened to
      // resolve to for their role. `replace` so Back does not return here.
      void navigate(from === paths.dashboard ? dashboardPathFor(session.roleCode) : from, {
        replace: true,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        // A 401 here is the generic credential failure, and the server sends it
        // with no field details — deliberately, so the response cannot be used to
        // discover which accounts exist. That means details-driven rendering alone
        // would show a form that silently did nothing, so the message is shown
        // whenever no field-level detail carried it.
        const hasFieldDetail = Object.keys(fieldErrors(error.details)).length > 0;
        setFormError(
          error.status === 401 && hasFieldDetail ? null : (error.message ?? 'Sign-in failed.'),
        );
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use the account issued by your library."
      imageStory
      footer={
        <p>
          Need a library account? <Link to={paths.register}>Register your library</Link>
        </p>
      }
    >
      <form className="form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {notice && (
          <p className="form__notice" role="status">
            {notice}
          </p>
        )}

        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        {/*
          Account type. A fieldset rather than a row of radio inputs: the options
          are buttons with `aria-pressed`, which gives each a large touch target
          and a state a screen reader announces without the visual weight of three
          full radio rows above the email field.
        */}
        <fieldset className="role-select">
          <legend className="role-select__legend">I'm signing in as</legend>
          <div className="role-select__options">
            {LOGIN_ROLES.map((role) => (
              <button
                key={role.code}
                type="button"
                className="role-select__option"
                aria-pressed={loginAs === role.code}
                onClick={() => setLoginAs(role.code)}
              >
                {role.label}
              </button>
            ))}
          </div>
        </fieldset>

        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          inputMode="email"
          placeholder="you@library.org"
          required
          error={errors.email}
        />

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder="Your password"
          required
          error={errors.password}
        />

        {/* A generic message for a generic 401, and it names no field. */}
        {!formError && errors.form && (
          <p className="form__error" role="alert">
            {errors.form}
          </p>
        )}

        {/*
          The password row: a remembered-device checkbox on the left and the recovery
          link on the right. `justify-content: space-between` with the link last is
          what puts them at opposite ends; a row of two centred items reads as a pair
          of related controls, and these are not related.
        */}
        <div className="auth__row">
          <CheckboxField
            label="Keep me signed in"
            checked={remember}
            onChange={setRemember}
            hint="Remembers you on this device."
          />
          <Link className="auth__link" to={paths.forgotPassword}>
            Forgot password?
          </Link>
        </div>

        <Button type="submit" variant="primary" busy={busy} busyLabel="Signing in…">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
