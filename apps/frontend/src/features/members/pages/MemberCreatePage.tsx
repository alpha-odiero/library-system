import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { errorMessage } from '../../../components/ui/States';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import {
  CheckboxField,
  PasswordField,
  SelectField,
  TextAreaField,
  TextField,
} from '../../../components/ui/Field';
import { useToast } from '../../../contexts/ToastContext';
import { paths } from '../../../routes/paths';
import { useMemberTypeList } from '../useMemberQueries';
import { createMember, type MemberCreateInput } from '../api';

/**
 * Desk registration.
 *
 * Two form decisions that are about correctness, not style:
 *
 *   1. **Optional fields are omitted when blank, never sent as `null`.** The
 *      server distinguishes "absent" (leave alone) from `null` (clear). Sending
 *      `city: null` for a field the librarian skipped would erase a city that is
 *      already on the record in the mind of whoever is using this to fix one typo.
 *   2. **`createAccount` is opt-in, and it drags a password with it.** Most
 *      members are registered at the desk and never sign in. The schema refuses
 *      `createAccount: true` without a password, so the form checks it before
 *      submitting and says which of the two inputs is wrong — rather than
 *      letting a filled-in form bounce back a 400 about a field the librarian
 *      was never shown.
 *
 * There is deliberately **no home-branch picker**. This build supports a single
 * branch, so asking the desk to choose the only option — and blocking the submit
 * while that choice could not be loaded — only hinders registration. The server
 * resolves the branch when it is omitted.
 */
export function MemberCreatePage(): ReactNode {
  const navigate = useNavigate();
  const { notify } = useToast();

  const { memberTypes, loading: typesLoading } = useMemberTypeList({ limit: 100 });

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    address: '',
    city: '',
    occupation: '',
    notes: '',
    membershipNumber: '',
    expiresAt: '',
    memberTypeId: '',
    createAccount: false,
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(field: keyof typeof form, value: string | boolean): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    // Checked locally rather than letting the schema reject it. The server
    // refuses an account with no password, and a 400 arriving after the form has
    // been filled in reads as a system fault rather than as a missing field.
    if (form.createAccount && !form.password.trim()) {
      setErrors({ password: 'Enter an initial password, or untick "Create login account".' });
      setFormError(null);
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    // `compact` drops every untouched optional field, so the request body carries
    // only what the librarian actually typed.
    const optional = (value: string): string | undefined =>
      value.trim() ? value.trim() : undefined;

    const input: MemberCreateInput = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      memberTypeId: form.memberTypeId,
      ...(optional(form.phone) ? { phone: optional(form.phone) } : {}),
      ...(optional(form.dateOfBirth) ? { dateOfBirth: optional(form.dateOfBirth) } : {}),
      ...(optional(form.gender) ? { gender: optional(form.gender) } : {}),
      ...(optional(form.address) ? { address: optional(form.address) } : {}),
      ...(optional(form.city) ? { city: optional(form.city) } : {}),
      ...(optional(form.occupation) ? { occupation: optional(form.occupation) } : {}),
      ...(optional(form.notes) ? { notes: optional(form.notes) } : {}),
      ...(optional(form.membershipNumber)
        ? { membershipNumber: optional(form.membershipNumber) }
        : {}),
      ...(optional(form.expiresAt) ? { expiresAt: optional(form.expiresAt) } : {}),
      createAccount: form.createAccount,
      // Present whenever an account is requested, because the schema requires it.
      // Untick the box instead of leaving it blank — the field is not optional in
      // that state, and an empty string would only earn a `.min(1)` rejection.
      ...(form.createAccount ? { password: form.password } : {}),
    };

    try {
      const response = await createMember(input);
      notify(`Student ${response.data.member.membershipNumber} registered`, 'success');
      void navigate(paths.member(response.data.member.id), { replace: true });
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
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Register a student</h1>
          <p className="page-header__subtitle">
            The membership number is allocated by the desk unless you supply one.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void navigate(paths.members)}>
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
              label="Date of birth"
              type="date"
              value={form.dateOfBirth}
              onChange={(value) => update('dateOfBirth', value)}
              hint="YYYY-MM-DD. Optional."
              max={new Date().toISOString().slice(0, 10)}
              error={errors.dateOfBirth}
            />
          </div>
        </Card>

        {/*
          Card headings are display copy, so they follow the Members → Students
          rename. The field labels inside already did; `form.membershipNumber` and the
          `membershipNumber` error key stay, because those are the API's names.
        */}
        <Card title="Student record">
          <SelectField
            label="Student type"
            value={form.memberTypeId}
            onChange={(value) => update('memberTypeId', value)}
            options={[
              { value: '', label: typesLoading ? 'Loading types…' : 'Select a student type' },
              ...memberTypes.map((type) => ({ value: type.id, label: type.name })),
            ]}
            required
            disabled={typesLoading || memberTypes.length === 0}
            hint="Sets borrowing limits, duration and fine rate for this student."
            error={errors.memberTypeId}
          />

          <div className="form__row">
            <TextField
              label="Student number"
              value={form.membershipNumber}
              onChange={(value) => update('membershipNumber', value)}
              hint="Leave blank to allocate the next number."
              error={errors.membershipNumber}
            />
            <TextField
              label="Expires on"
              type="date"
              value={form.expiresAt}
              onChange={(value) => update('expiresAt', value)}
              hint="Blank uses the library's validity policy."
              error={errors.expiresAt}
            />
          </div>
        </Card>

        <Card title="Contact and notes">
          <div className="form__row">
            <TextField
              label="Address"
              value={form.address}
              onChange={(value) => update('address', value)}
              autoComplete="off"
              error={errors.address}
            />
            <TextField
              label="City"
              value={form.city}
              onChange={(value) => update('city', value)}
              autoComplete="off"
              error={errors.city}
            />
          </div>

          <div className="form__row">
            <TextField
              label="Occupation"
              value={form.occupation}
              onChange={(value) => update('occupation', value)}
              autoComplete="off"
              error={errors.occupation}
            />
            <TextField
              label="Gender"
              value={form.gender}
              onChange={(value) => update('gender', value)}
              hint="Optional, recorded as entered."
              error={errors.gender}
            />
          </div>

          <TextAreaField
            label="Notes"
            value={form.notes}
            onChange={(value) => update('notes', value)}
            maxLength={2000}
            error={errors.notes}
          />
        </Card>

        <Card
          title="Sign-in access"
          description="Most students never sign in. Tick this only if the student needs to borrow online."
        >
          <CheckboxField
            label="Create a login account for this student"
            checked={form.createAccount}
            onChange={(value) => update('createAccount', value)}
            hint="The student signs in with this password and is asked to change it. Leave unticked for a student who only borrows at the desk."
          />

          {form.createAccount && (
            <PasswordField
              label="Initial password"
              value={form.password}
              onChange={(value) => update('password', value)}
              autoComplete="new-password"
              required
              hint="Must satisfy the password policy. The student is asked to change it."
              error={errors.password}
            />
          )}
        </Card>

        <div className="form__actions">
          <Button variant="ghost" onClick={() => void navigate(paths.members)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel="Registering…">
            Register member
          </Button>
        </div>
      </form>
    </>
  );
}
