import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PaginationMeta, UserStatusDto } from '@lms/shared';
import { formatInstant, initials } from '../../../lib/format';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { SelectField } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { ErrorState } from '../../../components/ui/States';
import { paths } from '../../../routes/paths';
import { listUsers, type UserDto, type UserFilters } from '../api';

const PAGE_SIZE = 20;

/**
 * The three statuses an administrator writes by hand. `LOCKED` is absent: it is
 * set by the login lockout, `userUpdateSchema` refuses it, and offering it as a
 * filter would advertise a control that cannot exist. Locked rows still appear
 * in an unfiltered list — only the filter choices are limited.
 */
const USER_STATUS_FILTERS: readonly { value: UserStatusDto; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

/** One place, so the filter options and the pills cannot drift apart. */
const USER_STATUS_TONES: Record<UserStatusDto, BadgeTone> = {
  ACTIVE: 'ok',
  INACTIVE: 'neutral',
  SUSPENDED: 'bad',
  LOCKED: 'warn',
};

const USER_STATUS_LABELS: Record<UserStatusDto, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
  LOCKED: 'Locked',
};

/**
 * The staff directory.
 *
 * An administrator reads who holds an account here and provisions new ones from
 * the button in the header. The rows shown are exactly the rows the caller was
 * authorised to receive: the route is gated by `USER_VIEW` and the create page by
 * `USER_CREATE`, so this page does not re-check permissions — a `can()` call here
 * would be a second, divergent copy of a rule the server enforces anyway.
 *
 * Fetching is inlined rather than shared with the members list because the
 * abort/reload rules are the same three that `useMemberList` documents: thread
 * the signal so out-of-order search responses cannot land, reset rows on a filter
 * change, and never report an abort as an error.
 */
export function UserListPage(): ReactNode {
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatusDto | ''>('');
  const [page, setPage] = useState(1);

  const [users, setUsers] = useState<UserDto[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const filters: UserFilters = {
    page,
    limit: PAGE_SIZE,
    ...(search ? { q: search } : {}),
    ...(status ? { status } : {}),
  };
  // Serialised so the effect re-runs on value change, not object identity.
  const key = JSON.stringify(filters);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listUsers(JSON.parse(key) as UserFilters, signal);
        setUsers(response.data);
        setMeta(response.meta);
      } catch (caught) {
        // An abort is a cancellation we asked for, not a failure to report.
        if (!signal.aborted) setError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [key],
  );

  useEffect(() => {
    const controller = new AbortController();
    setUsers([]);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function reload(): void {
    void load(new AbortController().signal);
  }

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    // Any filter change returns to page 1. Staying on page 7 of a 2-page result
    // set renders an empty table that reads like a bug.
    setPage(1);
    setSearch(query.trim());
  }

  const columns: Column<UserDto>[] = [
    {
      key: 'person',
      header: 'Staff member',
      render: (user) => (
        <div className="person">
          <span className="person__avatar" aria-hidden="true">
            {initials(user)}
          </span>
          <span>
            <span className="person__name">{user.fullName}</span>
            <span className="person__meta">{user.email}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (user) => <Badge tone="info">{user.roleName}</Badge>,
    },
    {
      key: 'branch',
      header: 'Branch',
      secondary: true,
      render: (user) =>
        user.primaryBranch ? user.primaryBranch.name : <span className="cell-muted">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (user) => (
        <Badge tone={USER_STATUS_TONES[user.status]}>{USER_STATUS_LABELS[user.status]}</Badge>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      render: (user) =>
        user.lastLoginAt ? (
          formatInstant(user.lastLoginAt)
        ) : (
          <span className="cell-muted">Never</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      secondary: true,
      render: (user) => formatInstant(user.createdAt),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Staff directory</h1>
          <p className="page-header__subtitle">
            Librarian accounts provisioned by an administrator. Search by name, email or staff
            number.
            {!loading &&
              ` ${meta.total} ${meta.total === 1 ? 'account' : 'accounts'} in this view.`}
          </p>
        </div>
        <Button variant="primary" onClick={() => void navigate(paths.librarianNew)}>
          Add librarian
        </Button>
      </header>

      <Card>
        <form className="filters" onSubmit={handleSearch} role="search">
          <div className="field filters__grow">
            <label className="field__label" htmlFor="user-search">
              Search staff
            </label>
            <input
              id="user-search"
              className="input"
              type="search"
              value={query}
              placeholder="Name, email or staff number"
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
              ...USER_STATUS_FILTERS.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
          />

          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (
          <>
            <DataTable
              caption="Staff directory"
              columns={columns}
              rows={users}
              rowKey={(user) => user.id}
              loading={loading}
              emptyTitle="No staff accounts match those filters"
              emptyDescription="Try a different name, email or status."
              emptyAction={
                <Button variant="primary" onClick={() => void navigate(paths.librarianNew)}>
                  Add a librarian
                </Button>
              }
            />

            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
