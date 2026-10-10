import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { errorMessage } from '../../../components/ui/States';
import { PasswordField, TextField } from '../../../components/ui/Field';
import { Button } from '../../../components/ui/Button';
import { AuthLayout } from '../../../components/layout/AuthLayout';
import { paths } from '../../../routes/paths';
import * as authApi from '../api';

/**
 * Library-admin onboarding.
 *
 * This is the public start of the admin-controlled provisioning model. The form
 * is intentionally framed as creating the library administrator account rather
 * than a student or member account, while still keeping the same verification and
 * password-checking behavior the backend already enforces.
 */
export function RegisterPage(): ReactNode {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    libraryName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(field: keyof typeof form, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      const response = await authApi.register({
        libraryName: form.libraryName,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        // Omitted rather than sent empty: `phone` distinguishes "not given" from
        // "cleared", and sending '' would be normalised to null by the server.
        ...(form.phone ? { phone: form.phone } : {}),
        password: form.password,
      });

      if (response.data.requiresEmailVerification) {
        void navigate(paths.login, { replace: true, state: { registered: true } });
        return;
      }

      void navigate(paths.login, { replace: true });
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

  return (
    <AuthLayout
      title="Register your library"
      subtitle="Create your administrator account and begin managing your library, members, staff and circulation."
      imageStory
      footer={<Link to={paths.login}>Already have a library account? Sign in</Link>}
    >
      <form className="form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <p className="form__hint">
          This creates the library administrator account for your organisation.
        </p>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        {/*
          The tenant, asked first because everything below attributes the new
          administrator to it: the account, its home library and its default
          branch are created together from this one name.
        */}
        <TextField
          label="Library name"
          value={form.libraryName}
          onChange={(value) => update('libraryName', value)}
          autoComplete="organization"
          placeholder="e.g. Hillview Community Library"
          required
          hint="The name of the library this account will administer."
          error={errors.libraryName}
        />

        <div className="form__row">
          <TextField
            label="First name"
            value={form.firstName}
            onChange={(value) => update('firstName', value)}
            autoComplete="given-name"
            required
            error={errors.firstName}
          />
          <TextField
            label="Last name"
            value={form.lastName}
            onChange={(value) => update('lastName', value)}
            autoComplete="family-name"
            required
            error={errors.lastName}
          />
        </div>

        <TextField
          label="Email address"
          type="email"
          value={form.email}
          onChange={(value) => update('email', value)}
          autoComplete="username"
          inputMode="email"
          placeholder="you@library.org"
          required
          error={errors.email}
        />

        <TextField
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(value) => update('phone', value)}
          autoComplete="tel"
          inputMode="tel"
          hint="Optional. Used for due-date reminders."
          error={errors.phone}
        />

        <PasswordField
          label="Password"
          value={form.password}
          onChange={(value) => update('password', value)}
          autoComplete="new-password"
          placeholder="Choose a password"
          required
          hint="At least 12 characters, with upper and lower case letters, a number and a symbol."
          error={errors.password}
        />

        <Button type="submit" variant="primary" busy={busy} busyLabel="Creating account…">
          Create library account
        </Button>
      </form>
    </AuthLayout>
  );
}
