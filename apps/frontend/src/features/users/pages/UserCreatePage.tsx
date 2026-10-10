import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { EmptyState, errorMessage } from '../../../components/ui/States';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { PasswordField, SelectField, TextField } from '../../../components/ui/Field';
import { useToast } from '../../../contexts/ToastContext';
import { paths } from '../../../routes/paths';
import { useBranchOptions } from '../../branches/useBranchOptions';
import { createUser, type UserCreateInput, type UserDto } from '../api';

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  employeeId: '',
  branchId: '',
  temporaryPassword: '',
};

/**
 * Staff provisioning.
 *
 * Three decisions this form is careful about:
 *
 *   1. **No role field, ever.** `POST /users` provisions a LIBRARIAN and the
 *      role row is resolved server-side from a constant, so the form cannot
 *      offer a choice the `.strict()` schema would reject — and a client that
 *      could send one would be a mass-assignment hole shaped like a select box.
 *   2. **The temporary credential is displayed once, in this page, and never
 *      stored.** The server returns the generated password in the creation
 *      response and keeps only an Argon2 hash, so there is no second read and
 *      therefore no "resend password" to offer. The success view says exactly
 *      that, and shows the value in the page rather than in a toast that
 *      vanishes: an administrator who misses it has no recovery beyond resetting
 *      the account. Nothing logs it and it is never placed in the URL.
 *   3. **Blank optional fields are omitted, never sent as `null`.** The server
 *      distinguishes "absent" from "clear", and a form that sent `phone: null`
 *      for a field the administrator skipped would be claiming an intention they
 *      never expressed.
 *
 * Permission gating lives in the router (`USER_CREATE` on `/librarians/new`);
 * this page does not re-check it, because a second copy of the rule is a copy
 * that can drift.
 */
export function UserCreatePage(): ReactNode {
  const navigate = useNavigate();
  const { notify } = useToast();

  const { branches, loading: branchesLoading, error: branchesError } = useBranchOptions();

  // One branch → the primary desk is a fact, not a choice. See the home-branch
  // handling on member registration: the field disappears and the id is sent
  // automatically, so a single-branch library never asks for the only option.
  const singleBranch = branches.length === 1 ? branches[0] : null;

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    user: UserDto;
    temporaryPassword: string | null;
  } | null>(null);

  function update(field: keyof typeof form, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    // Checked locally rather than letting the schema reject them: a 400 about a
    // field the administrator could see was blank arrives after the form has been
    // filled in and reads as a system fault rather than as a missing field.
    const missing: Record<string, string> = {};
    if (!form.firstName.trim()) missing.firstName = 'Enter a first name';
    if (!form.lastName.trim()) missing.lastName = 'Enter a last name';
    if (!form.email.trim()) missing.email = 'Enter an email address';
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      setFormError(null);
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    // `optional` drops every untouched field, so the body carries only what the
    // administrator actually typed. Length limits are the schema's business.
    const optional = (value: string): string | undefined =>
      value.trim() ? value.trim() : undefined;

    // `singleBranch` is authoritative: when it is the only branch, the select is
  // hidden and that branch is the primary desk by definition.
  const selectedBranchId = singleBranch ? singleBranch.id : form.branchId;

  const input: UserCreateInput = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      ...(optional(form.phone) ? { phone: optional(form.phone) } : {}),
      ...(optional(form.employeeId) ? { employeeId: optional(form.employeeId) } : {}),
      ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
      ...(optional(form.temporaryPassword)
        ? { temporaryPassword: optional(form.temporaryPassword) }
        : {}),
    };

    try {
      const response = await createUser(input);
      notify(`${response.data.user.fullName} provisioned`, 'success');
      // The form is replaced rather than navigated away from: the response holds
      // the one-time credential, and routing onwards would throw it away.
      setCreated(response.data);
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

  function handleAddAnother(): void {
    setCreated(null);
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setFormError(null);
  }

  if (created) {
    const temporaryPassword = created.temporaryPassword;

    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-header__title">Staff account created</h1>
            <p className="page-header__subtitle">
              {created.user.fullName} can now sign in as {created.user.email}.
            </p>
          </div>
        </header>

        <Card title="Sign-in credential">
          <EmptyState
            title="Account created"
            description={
              <>
                <strong>{created.user.fullName}</strong> — {created.user.email}
                {created.user.primaryBranch ? ` · ${created.user.primaryBranch.name}` : ''}
              </>
            }
          />

          {temporaryPassword !== null ? (
            <div className="field">
              <span className="field__label">Temporary password</span>
              <p>
                <code className="code">{temporaryPassword}</code>
              </p>
              <span className="field__hint">
                Shown here once and nowhere else: the server keeps only the hash, so this value
                cannot be read back and there is no resend. Copy it before leaving this page.
              </span>
            </div>
          ) : (
            <p className="form__note">
              You chose this account&apos;s password, so nothing is repeated back here — a known
              secret is never sent into a response a second time. Hand it over out of band.
            </p>
          )}

          <p className="form__note">
            Give the credential to {created.user.fullName} out of band. They must change it at first
            sign-in; the account is created with that change enforced.
          </p>

          <div className="form__actions">
            <Button variant="primary" onClick={() => void navigate(paths.librarians)}>
              Back to staff directory
            </Button>
            <Button variant="ghost" onClick={handleAddAnother}>
              Add another
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Provision a librarian</h1>
          <p className="page-header__subtitle">
            Creates a staff account with a librarian role. The password is handed over out of band
            and must be changed at first sign-in.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void navigate(paths.librarians)} disabled={busy}>
          Cancel
        </Button>
      </header>

      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <Card title="Identity">
          <div className="form__row">
            <TextField
              label="First name"
              value={form.firstName}
              onChange={(value) => update('firstName', value)}
              autoComplete="off"
              required
              error={errors.firstName}
            />
            <TextField
              label="Last name"
              value={form.lastName}
              onChange={(value) => update('lastName', value)}
              autoComplete="off"
              required
              error={errors.lastName}
            />
          </div>

          <TextField
            label="Email address"
            type="email"
            value={form.email}
            onChange={(value) => update('email', value)}
            inputMode="email"
            required
            error={errors.email}
          />

          <div className="form__row">
            <TextField
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(value) => update('phone', value)}
              inputMode="tel"
              error={errors.phone}
            />
            <TextField
              label="Staff number"
              value={form.employeeId}
              onChange={(value) => update('employeeId', value)}
              hint="Issued by the library. Optional; must be unique within it."
              error={errors.employeeId}
            />
          </div>
        </Card>

        <Card
          title="Account"
          description="Where this librarian works, and the credential they sign in with once."
        >
          {singleBranch ? (
            <div className="field">
              <span className="field__label">Branch</span>
              <p>{singleBranch.name}</p>
              <span className="field__hint">The only branch in this library — set as this account&apos;s primary desk.</span>
            </div>
          ) : (
            <SelectField
              label="Branch"
              value={form.branchId}
              onChange={(value) => update('branchId', value)}
              options={[
                { value: '', label: branchesLoading ? 'Loading branches…' : 'No branch assigned' },
                ...branches.map((branch) => ({
                  value: branch.id,
                  label: `${branch.name} (${branch.code})`,
                })),
              ]}
              disabled={branchesLoading}
              hint="The primary desk for the account. Optional — it can be set later."
              error={errors.branchId ?? (branchesError ? errorMessage(branchesError) : undefined)}
            />
          )}

          <PasswordField
            label="Temporary password"
            value={form.temporaryPassword}
            onChange={(value) => update('temporaryPassword', value)}
            autoComplete="new-password"
            hint="Leave blank to have a strong one generated — you will be shown it once after the account is created. Either way it must be changed at first sign-in."
            error={errors.temporaryPassword}
          />
        </Card>

        <div className="form__actions">
          <Button variant="ghost" onClick={() => void navigate(paths.librarians)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel="Creating…">
            Create account
          </Button>
        </div>
      </form>
    </>
  );
}
