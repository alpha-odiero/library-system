import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LoanStatusDto } from '@lms/shared';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { SelectField } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { ErrorState } from '../../../components/ui/States';
import { useAuth } from '../../../contexts/AuthContext';
import {
  daysUntil,
  formatInstant,
  formatRelativeDays,
  fullName,
  initials,
} from '../../../lib/format';
import { paths } from '../../../routes/paths';
import { LOAN_STATUS_LABELS, loanMovement, type LoanDto } from '../api';
import { LOAN_STATUS_FILTERS, useLoanList } from '../useCirculationQueries';

/**
 * The loan register.
 *
 * A member reaching this page sees their own loans, labelled "My Loans", with the
 * member column dropped — their own name on every row is noise. The narrowing is a
 * UI decision; the server enforces it, so nothing here decides who sees what.
 */
export function LoanListPage(): ReactNode {
  const { session, can } = useAuth();
  const [status, setStatus] = useState<LoanStatusDto | ''>('ACTIVE');
  const [page, setPage] = useState(1);

  // A member holds `LOAN_VIEW_OWN` and not `LOAN_VIEW`, so the absence of the staff
  // permission is what identifies this as their own list.
  const ownView = !can('LOAN_VIEW') && can('LOAN_VIEW_OWN');

  const { loans, meta, loading, error, reload } = useLoanList(
    {
      page,
      limit: 20,
      ...(status ? { status } : {}),
      ownMemberId: session?.memberId ?? null,
    },
    ownView,
  );

  const columns: Column<LoanDto>[] = [
    {
      key: 'movement',
      header: 'Type',
      render: (loan) => (
        <Badge tone={loan.returnedAt ? 'neutral' : loan.status === 'OVERDUE' ? 'bad' : 'ok'}>
          {loanMovement(loan)}
        </Badge>
      ),
    },
    {
      key: 'title',
      header: 'Book',
      render: (loan) => (
        <Link className="link" to={paths.book(loan.book.id)}>
          {loan.book.title}
        </Link>
      ),
    },
    ...(ownView
      ? []
      : [
          {
            key: 'member',
            header: 'Student',
            render: (loan: LoanDto) => (
              <div className="person">
                <span className="person__avatar" aria-hidden="true">
                  {initials(loan.member.user)}
                </span>
                <span>
                  <span className="person__name">{fullName(loan.member.user)}</span>
                  <span className="person__meta">{loan.member.membershipNumber}</span>
                </span>
              </div>
            ),
          },
        ]),
    {
      key: 'copy',
      header: 'Copy',
      secondary: true,
      render: (loan) => loan.copy.accessionNumber,
    },
    {
      key: 'branch',
      header: 'Branch',
      secondary: true,
      render: (loan) => loan.branch.name,
    },
    {
      key: 'due',
      header: 'Due',
      render: (loan) => {
        if (loan.returnedAt) return <span className="cell-muted">Returned</span>;

        const days = daysUntil(loan.dueDate);
        return (
          <div className="cell-stack">
            <span className="cell-stack__primary">{formatInstant(loan.dueDate)}</span>
            <span
              className={
                days !== null && days < 0 ? 'cell-stack__secondary--bad' : 'cell-stack__secondary'
              }
            >
              {formatRelativeDays(days)}
            </span>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (loan) => (
        <Badge tone={toneFor(loan.status)}>{LOAN_STATUS_LABELS[loan.status]}</Badge>
      ),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">{ownView ? 'Books Borrowed' : 'Borrowing'}</h1>
          <p className="page-header__subtitle">
            {ownView
              ? 'Every book you have borrowed, with what is due when.'
              : 'Every borrowing record within the branches your role covers. Returned items are excluded unless you ask for them.'}
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
              { value: '', label: 'All open borrowing' },
              ...LOAN_STATUS_FILTERS.map((option) => ({
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
              caption={ownView ? 'Books you have borrowed' : 'Borrowing register'}
              columns={columns}
              rows={loans}
              rowKey={(loan) => loan.id}
              loading={loading}
              emptyTitle={
                ownView ? 'You have nothing borrowed' : 'No borrowing matches those filters'
              }
              emptyDescription={
                ownView
                  ? 'Borrowed books will appear here with their due dates.'
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

function toneFor(status: LoanDto['status']): BadgeTone {
  switch (status) {
    case 'ACTIVE':
      return 'ok';
    case 'OVERDUE':
    case 'LOST':
    case 'DAMAGED':
      return 'bad';
    default:
      return 'neutral';
  }
}
