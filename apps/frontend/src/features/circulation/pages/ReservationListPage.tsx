import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ReservationStatusDto } from '@lms/shared';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { SelectField } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { ErrorState } from '../../../components/ui/States';
import { useAuth } from '../../../contexts/AuthContext';
import { formatCalendarDate, fullName, initials } from '../../../lib/format';
import { paths } from '../../../routes/paths';
import { RESERVATION_STATUS_LABELS, type ReservationDto } from '../api';
import { RESERVATION_STATUS_FILTERS, useReservationList } from '../useCirculationQueries';

/**
 * The holds queue.
 *
 * Position is the first column, not a detail: the queue order is the only thing a
 * librarian working down a waiting list actually needs, and burying it in a detail
 * page would mean opening each row to learn which one to serve next.
 *
 * An expired hold is shown in grey rather than hidden. "Where did that member go in
 * the queue?" is a question this list exists to answer, and a hold that silently
 * disappeared cannot answer it.
 */
export function ReservationListPage(): ReactNode {
  const { session, can } = useAuth();
  const [status, setStatus] = useState<ReservationStatusDto | ''>('');
  const [page, setPage] = useState(1);

  const ownView = !can('RESERVATION_VIEW') && can('RESERVATION_VIEW_OWN');

  const { reservations, meta, loading, error, reload } = useReservationList(
    {
      page,
      limit: 20,
      ...(status ? { status } : {}),
      ownMemberId: session?.memberId ?? null,
    },
    ownView,
  );

  const columns: Column<ReservationDto>[] = [
    {
      key: 'position',
      header: '#',
      align: 'right',
      // Only meaningful while a hold is still in the queue; a fulfilled or cancelled
      // hold keeps its old number for the audit trail, which is why it is not hidden.
      render: (hold) => (
        <span className={hold.status === 'ACTIVE' || hold.status === 'READY' ? '' : 'cell-muted'}>
          {hold.position}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Book',
      render: (hold) => (
        <Link className="link" to={paths.book(hold.book.id)}>
          {hold.book.title}
        </Link>
      ),
    },
    ...(ownView
      ? []
      : [
          {
            key: 'member',
            header: 'Student',
            render: (hold: ReservationDto) => (
              <div className="person">
                <span className="person__avatar" aria-hidden="true">
                  {initials(hold.member.user)}
                </span>
                <span>
                  <span className="person__name">{fullName(hold.member.user)}</span>
                  <span className="person__meta">{hold.member.membershipNumber}</span>
                </span>
              </div>
            ),
          },
        ]),
    { key: 'branch', header: 'Pickup', secondary: true, render: (hold) => hold.branch.name },
    {
      key: 'reserved',
      header: 'Reserved',
      secondary: true,
      render: (hold) => formatCalendarDate(hold.reservedAt),
    },
    {
      key: 'expires',
      header: 'Hold expires',
      render: (hold) => formatCalendarDate(hold.holdExpiresAt),
    },
    {
      key: 'status',
      header: 'Status',
      render: (hold) => (
        <Badge tone={toneFor(hold.status)}>{RESERVATION_STATUS_LABELS[hold.status]}</Badge>
      ),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">{ownView ? 'My Reservations' : 'Reservations'}</h1>
          <p className="page-header__subtitle">
            {ownView
              ? 'Titles you have asked to be held for you, in queue order.'
              : 'Holds across the branches your role covers, in queue order.'}
          </p>
        </div>
      </header>

      <Card>
        <div className="filters">
          <SelectField
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All holds' },
              ...RESERVATION_STATUS_FILTERS.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
          />
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption={ownView ? 'Your reservations' : 'Reservation queue'}
              columns={columns}
              rows={reservations}
              rowKey={(hold) => hold.id}
              loading={loading}
              emptyTitle={ownView ? 'You have no holds' : 'No reservations match that filter'}
              emptyDescription={
                ownView
                  ? 'Reserve a title from its catalogue page to join a queue.'
                  : 'Try a different status.'
              }
            />
            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}

function toneFor(status: ReservationDto['status']): BadgeTone {
  switch (status) {
    case 'READY':
      return 'ok';
    case 'ACTIVE':
      return 'info';
    case 'EXPIRED':
      return 'warn';
    case 'FULFILLED':
      return 'neutral';
    case 'CANCELLED':
      return 'bad';
    default:
      return 'neutral';
  }
}
