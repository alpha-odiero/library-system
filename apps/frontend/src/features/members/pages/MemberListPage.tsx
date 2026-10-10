import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { MemberStatusDto } from '@lms/shared';
import { formatCalendarDate } from '../../../lib/format';
import { MemberStatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { SelectField } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { ErrorState } from '../../../components/ui/States';
import { useAuth } from '../../../contexts/AuthContext';
import { paths } from '../../../routes/paths';
import { useBranchOptions } from '../../branches/useBranchOptions';
import { MEMBER_STATUS_FILTERS, useMemberList } from '../useMemberQueries';
import type { MemberDto } from '../api';

/**
 * The member register.
 *
 * A member without `MEMBER_VIEW_OTHERS` gets the ownership-filtered list the
 * server returns — one row, their own — and no "Register member" button. The
 * client filters nothing: the rows shown are exactly the rows the caller was
 * authorised to receive, so the table can never disagree with the API about who
 * may see what.
 */
export function MemberListPage(): ReactNode {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MemberStatusDto | ''>('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);

  // The options come from the caller's own scope, so this list cannot offer a
  // branch the caller would then be refused by the server.
  const { branches, loading: branchesLoading, error: branchesError } = useBranchOptions();

  const { members, meta, loading, error, reload } = useMemberList({
    page,
    limit: 20,
    ...(search ? { q: search } : {}),
    ...(status ? { status } : {}),
    ...(branchId ? { branchId } : {}),
  });

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    // Any filter change returns to page 1. Staying on page 7 of a 2-page result
    // set renders an empty table that reads like a bug.
    setPage(1);
    setSearch(query.trim());
  }

  const columns: Column<MemberDto>[] = [
    {
      key: 'name',
      header: 'Student',
      render: (member) => (
        <div className="cell-stack">
          <Link className="link" to={paths.member(member.id)}>
            {member.account
              ? `${member.account.firstName} ${member.account.lastName}`
              : 'Name not recorded'}
          </Link>
          <span className="cell-stack__secondary">{member.membershipNumber}</span>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      secondary: true,
      render: (member) => member.account?.email ?? '—',
    },
    { key: 'type', header: 'Type', render: (member) => member.memberType.name },
    {
      key: 'branch',
      header: 'Home branch',
      secondary: true,
      render: (member) => member.homeBranch.name,
    },
    { key: 'expires', header: 'Expires', render: (member) => formatCalendarDate(member.expiresAt) },
    {
      key: 'status',
      header: 'Status',
      render: (member) => <MemberStatusBadge status={member.status} />,
    },
  ];

  const canRegister = can('MEMBER_CREATE');

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Students</h1>
          <p className="page-header__subtitle">
            Search by name or membership number. Results are limited to the branches and records
            your role may see.
          </p>
        </div>
        {canRegister && (
          <Button variant="primary" onClick={() => void navigate(paths.memberNew)}>
            Register student
          </Button>
        )}
      </header>

      <Card>
        <form className="filters" onSubmit={handleSearch} role="search">
          <div className="field filters__grow">
            <label className="field__label" htmlFor="member-search">
              Search students
            </label>
            <input
              id="member-search"
              className="input"
              type="search"
              value={query}
              placeholder="Name or student number"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <SelectField
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All statuses' },
              ...MEMBER_STATUS_FILTERS.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
          />

          {/*
            A branch filter that cannot list its options would silently return
            every branch's members, so the failure is shown next to the control
            instead of being swallowed. With a single branch in scope the filter
            is meaningless, so it is dropped entirely.
          */}
          {branches.length > 1 && (
            <div className="filters__grow">
              <SelectField
                label="Home branch"
                value={branchId}
                onChange={(value) => {
                  setBranchId(value);
                  setPage(1);
                }}
                disabled={branchesLoading}
                hint={
                  branchesError
                    ? 'Branch list unavailable; showing all branches in scope.'
                    : undefined
                }
                options={[
                  { value: '', label: 'All branches in scope' },
                  ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
                ]}
              />
            </div>
          )}

          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error ? (
          <ErrorState error={error} onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption="Student register"
              columns={columns}
              rows={members}
              rowKey={(member) => member.id}
              loading={loading}
              emptyTitle="No students match those filters"
              emptyDescription="Try a different name, number or status."
              emptyAction={
                canRegister ? (
                  <Button variant="primary" onClick={() => void navigate(paths.memberNew)}>
                    Register a student
                  </Button>
                ) : undefined
              }
            />

            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
