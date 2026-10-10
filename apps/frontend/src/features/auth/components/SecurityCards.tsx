import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { formatInstant } from '../../../lib/format';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { PasswordField } from '../../../components/ui/Field';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import * as authApi from '../api';

/**
 * Password and active sessions, as two cards that can be dropped into any
 * account screen.
 *
 * Extracted from the profile page because "where am I signed in?" belongs on
 * the settings screen as much as it does on the profile, and two
 * implementations of session revocation would be two places for the
 * sign-out-after-revoking-current-session rule to be forgotten.
 */

export function PasswordCard({ onChanged }: { onChanged?: () => void }): ReactNode {
  const { notify } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (newPassword !== confirmation) {
      setErrors({ confirmation: 'The two passwords do not match.' });
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      await authApi.changePassword(currentPassword, newPassword);
      notify('Password changed. Other sessions have been signed out.', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError('Could not change your password.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Change password">
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <PasswordField
          label="Current password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
          required
          error={errors.currentPassword}
        />

        <PasswordField
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          required
          hint="At least 12 characters, with upper and lower case letters, a number and a symbol."
          error={errors.newPassword}
        />

        <PasswordField
          label="Confirm new password"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          required
          error={errors.confirmation ?? errors.form}
        />

        <Button type="submit" variant="primary" busy={busy} busyLabel="Saving…">
          Change password
        </Button>
      </form>
    </Card>
  );
}

export function SessionsCard(): ReactNode {
  const { session, signOut } = useAuth();
  const { notify } = useToast();

  const [sessions, setSessions] = useState<authApi.SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [signOutAllOpen, setSignOutAllOpen] = useState(false);
  const [signOutAllBusy, setSignOutAllBusy] = useState(false);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authApi.listSessions();
      setSessions(response.data.sessions);
    } catch (caught) {
      if (!signal.aborted) setError(caught);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function handleRevoke(sessionId: string): Promise<void> {
    setRevoking(sessionId);

    try {
      await authApi.revokeSession(sessionId);
      notify('Session revoked', 'success');
      // Revoking the current session ends it, so sign out locally rather than
      // leaving a shell of an app the server has already closed.
      if (sessionId === session?.sessionId) {
        await signOut();
        return;
      }
      void load(new AbortController().signal);
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : 'Could not revoke that session',
        'error',
      );
    } finally {
      setRevoking(null);
    }
  }

  async function handleSignOutAll(): Promise<void> {
    setSignOutAllBusy(true);

    try {
      await authApi.logoutAll();
      setSignOutAllOpen(false);
      await signOut();
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : 'Could not sign out everywhere',
        'error',
      );
    } finally {
      setSignOutAllBusy(false);
    }
  }

  return (
    <Card
      title="Where you are signed in"
      actions={
        <Button variant="secondary" size="sm" onClick={() => setSignOutAllOpen(true)}>
          Sign out everywhere
        </Button>
      }
    >
      {loading ? (
        <LoadingState label="Loading sessions" rows={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void load(new AbortController().signal)} />
      ) : (
        <ul className="session-list">
          {sessions.map((entry) => (
            <li key={entry.id} className="session-list__item">
              <div>
                <p className="session-list__device">
                  {entry.deviceLabel ?? 'Unknown device'}
                  {entry.current && <span className="badge badge--ok">This device</span>}
                </p>
                <p className="session-list__meta">
                  {entry.ip ?? 'unknown address'} · signed in {formatInstant(entry.issuedAt)}
                </p>
              </div>
              {!entry.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  busy={revoking === entry.id}
                  onClick={() => void handleRevoke(entry.id)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={signOutAllOpen}
        title="Sign out of every device?"
        message="Every session, including this one, ends immediately. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        busy={signOutAllBusy}
        onConfirm={() => void handleSignOutAll()}
        onCancel={() => setSignOutAllOpen(false)}
      />
    </Card>
  );
}
