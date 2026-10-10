import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import {
  daysUntil,
  formatCalendarDate,
  formatInstant,
  formatMoney,
  formatRelativeDays,
} from '../../../lib/format';
import { MemberStatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { DescriptionItem, DescriptionList } from '../../../components/ui/Table';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { paths } from '../../../routes/paths';
import { archiveMember, getMember, type MemberDto } from '../api';

/**
 * A single member record.
 *
 * Everything shown is filtered server-side; this page renders whatever `GET
 * /members/:id` returned and nothing more. Two consequences worth stating:
 *
 *   • A member without `MEMBER_VIEW_OTHERS` who guesses another member's id gets
 *     404, not 403 — the route already collapses "not yours" into "does not exist",
 *     and the page renders the same not-found state for both.
 *   • A member whose account has outstanding loans cannot be archived. That
 *     409 comes back with `MEMBER_HAS_ACTIVE_LOANS`, and it is rendered as an
 *     explanation next to the button rather than a generic failure — the
 *     librarian's next action is to settle the loans, and telling them so is the
 *     difference between a fixable moment and a support ticket.
 */
export function MemberDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can, session } = useAuth();
  const { notify } = useToast();

  const [member, setMember] = useState<MemberDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const response = await getMember(id, signal);
        setMember(response.data.member);
      } catch (caught) {
        if (!signal.aborted) setError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function handleArchive(): Promise<void> {
    if (!member) return;
    setArchiving(true);
    setArchiveError(null);

    try {
      await archiveMember(member.id);
      notify(`${member.membershipNumber} archived`, 'success');
      void navigate(paths.members, { replace: true });
    } catch (caught) {
      // Named explicitly: this one has a documented code and a documented remedy.
      if (caught instanceof ApiError && caught.code === 'MEMBER_HAS_ACTIVE_LOANS') {
        setArchiveError(
          'This student still has borrowed books on account. Settle or return them before archiving.',
        );
        setConfirmOpen(false);
      } else {
        setArchiveError(
          caught instanceof ApiError ? caught.message : 'Could not archive this student.',
        );
      }
    } finally {
      setArchiving(false);
    }
  }

  if (loading) return <LoadingState label="Loading student" rows={6} />;
  if (error)
    return <ErrorState error={error} onRetry={() => void load(new AbortController().signal)} />;
  if (!member) return null;

  const name = member.account
    ? `${member.account.firstName} ${member.account.lastName}`
    : 'Name not recorded';
  const daysToExpiry = daysUntil(member.expiresAt);
  const isOwnRecord = session?.memberId === member.id;
  const canUpdate = can('MEMBER_UPDATE') && !isOwnRecord;
  const canDelete = can('MEMBER_DELETE') && !isOwnRecord;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">
            <Link className="link" to={paths.members}>
              Students
            </Link>
          </p>
          <h1 className="page-header__title">{name}</h1>
          <p className="page-header__subtitle">
            {member.membershipNumber} · {member.homeBranch.name}
          </p>
        </div>

        <div className="page-header__actions">
          {canUpdate && (
            <Button variant="primary" onClick={() => void navigate(paths.memberEdit(member.id))}>
              Edit
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Archive
            </Button>
          )}
        </div>
      </header>

      {isOwnRecord && (
        <Card>
          <p className="form__note">
            This is your own record. Contact the desk to have it changed — it keeps the audit trail
            honest and stops a student editing their own status.
          </p>
        </Card>
      )}

      <div className="grid grid--two">
        <Card title="Status">
          <DescriptionList>
            <DescriptionItem term="Membership status">
              <MemberStatusBadge status={member.status} />
            </DescriptionItem>
            <DescriptionItem term="Student type">{member.memberType.name}</DescriptionItem>
            <DescriptionItem term="Joined">{formatInstant(member.joinedAt)}</DescriptionItem>
            <DescriptionItem term="Expires">
              {formatCalendarDate(member.expiresAt)}
              {daysToExpiry !== null && (
                <span className="details__aside">{formatRelativeDays(daysToExpiry)}</span>
              )}
            </DescriptionItem>
            <DescriptionItem term="Borrowing allowance">
              {member.memberType.maxActiveLoans} at a time · {member.memberType.loanDurationDays}{' '}
              days
            </DescriptionItem>
            <DescriptionItem term="Fine rate">
              {/* Formatted, not printed raw: the stored value is a decimal string
                  and "0.5" reads as a data error where "KES 0.50" reads as a rate. */}
              {formatMoney(member.memberType.finePerDay)} per day
            </DescriptionItem>
          </DescriptionList>
        </Card>

        <Card title="Contact">
          <DescriptionList>
            <DescriptionItem term="Email">
              {member.account?.email ?? 'No account on file'}
            </DescriptionItem>
            {/* Phone lives on `User`, and `MEMBER_SELECT` does not project it. It is
                omitted here rather than shown as an empty field, so nobody reads a
                blank cell as "collected and empty" when it is really "not fetched". */}
            <DescriptionItem term="Address">{member.address ?? '—'}</DescriptionItem>
            <DescriptionItem term="City">{member.city ?? '—'}</DescriptionItem>
            <DescriptionItem term="Occupation">{member.occupation ?? '—'}</DescriptionItem>
            <DescriptionItem term="Date of birth">
              {formatCalendarDate(member.dateOfBirth)}
            </DescriptionItem>
          </DescriptionList>
        </Card>
      </div>

      {member.notes && (
        <Card title="Notes">
          <p className="prose">{member.notes}</p>
        </Card>
      )}

      <Card title="Record">
        <DescriptionList>
          <DescriptionItem term="Created">{formatInstant(member.createdAt)}</DescriptionItem>
          <DescriptionItem term="Last updated">{formatInstant(member.updatedAt)}</DescriptionItem>
          <DescriptionItem term="Email verified">
            {member.account ? (member.account.emailVerified ? 'Yes' : 'Not yet') : 'No account'}
          </DescriptionItem>
        </DescriptionList>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Archive this student?"
        message={
          <>
            <strong>{member.membershipNumber}</strong> will no longer appear in the register.
            Borrowing history, fines and audit history are kept — this is not a deletion.
          </>
        }
        confirmLabel="Archive student"
        busy={archiving}
        onConfirm={() => void handleArchive()}
        onCancel={() => setConfirmOpen(false)}
      />

      {archiveError && (
        <p className="form__error" role="alert">
          {archiveError}
        </p>
      )}
    </>
  );
}
