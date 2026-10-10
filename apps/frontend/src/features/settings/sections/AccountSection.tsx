import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { TextField } from '../../../components/ui/Field';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { DescriptionItem, DescriptionList } from '../../../components/ui/Table';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { paths } from '../../../routes/paths';
import * as authApi from '../../auth/api';

const PHONE_PATTERN = /^\+?[0-9][0-9\s().-]{4,24}$/;

/**
 * Profile — name and contact number.
 *
 * Email, role and branch are shown but not editable: the address is the sign-in
 * credential (it has its own verify-new-address flow) and the rest are
 * authorities the product does not let an account grant itself. Saying so on
 * screen beats a disabled field, which invites the question "why won't this
 * work?" rather than answering it.
 */
export function AccountSection(): ReactNode {
  const { session, refresh } = useAuth();
  const { notify } = useToast();

  const [firstName, setFirstName] = useState(session?.firstName ?? '');
  const [lastName, setLastName] = useState(session?.lastName ?? '');
  const [phone, setPhone] = useState(session?.phone ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty =
    firstName !== (session?.firstName ?? '') ||
    lastName !== (session?.lastName ?? '') ||
    phone !== (session?.phone ?? '');

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const issues: Record<string, string> = {};
    if (firstName.trim() === '') issues.firstName = 'Enter your first name';
    if (lastName.trim() === '') issues.lastName = 'Enter your last name';
    if (phone.trim() !== '' && !PHONE_PATTERN.test(phone.trim())) {
      issues.phone = 'Enter a valid phone number, digits only';
    }
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;

    if (!dirty) {
      notify('No changes to save.', 'info');
      return;
    }

    setBusy(true);
    try {
      await authApi.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
      });
      // The header greets by name from the session, so the edit is not visible
      // until `/auth/me` is re-read.
      await refresh();
      notify('Profile updated', 'success');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setErrors(fieldErrors(caught.details));
        setFormError(caught.message);
      } else {
        setFormError('Unable to save settings. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Your details" description="How the library addresses and contacts you.">
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          {formError && (
            <p className="form__error" role="alert">
              {formError}
            </p>
          )}

          <div className="settings-fields">
            <div className="settings-field">
              <TextField
                label="First name"
                value={firstName}
                onChange={setFirstName}
                error={errors.firstName}
                required
                autoComplete="given-name"
              />
            </div>
            <div className="settings-field">
              <TextField
                label="Last name"
                value={lastName}
                onChange={setLastName}
                error={errors.lastName}
                required
                autoComplete="family-name"
              />
            </div>
            <div className="settings-field">
              <TextField
                label="Phone"
                value={phone}
                onChange={setPhone}
                type="tel"
                inputMode="tel"
                hint="Leave empty if the library has no number for you."
                error={errors.phone}
                autoComplete="tel"
              />
            </div>
          </div>

          <div className="settings-actions">
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              busyLabel="Saving…"
              disabled={busy || !dirty}
            >
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="On file"
        description="Fixed by the library or by the way this account was created."
      >
        <DescriptionList>
          <DescriptionItem term="Email">{session?.email}</DescriptionItem>
          <DescriptionItem term="Role">{session?.roleCode}</DescriptionItem>
          <DescriptionItem term="Library">
            {session?.libraryName ?? 'No library assigned'}
          </DescriptionItem>
          <DescriptionItem term="Branch access">
            {session?.branchScope === null
              ? 'All branches'
              : `${session?.branchScope.length ?? 0} branch(es)`}
          </DescriptionItem>
          <DescriptionItem term="Member record">
            {session?.memberId ? (
              <Link className="link" to={paths.member(session.memberId)}>
                View member record
              </Link>
            ) : (
              'None — staff account'
            )}
          </DescriptionItem>
        </DescriptionList>
      </Card>
    </>
  );
}
