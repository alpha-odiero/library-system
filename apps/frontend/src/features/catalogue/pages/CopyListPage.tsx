import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CopyStatusDto } from '@lms/shared';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { SelectField } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { ErrorState } from '../../../components/ui/States';
import { formatCalendarDate } from '../../../lib/format';
import { useBranchOptions } from '../../branches/useBranchOptions';
import { paths } from '../../../routes/paths';
import { COPY_STATUS_FILTERS, COPY_STATUS_LABELS } from '../api';
import { useCopyList } from '../useCatalogueQueries';
import type { CopyDto } from '../api';

/**
 * Physical inventory.
 *
 * A copy is identified by its accession number, not its barcode: the accession number
 * is what is printed on the spine and what a member is asked for at the desk, while
 * the barcode is a scanner's concern and is often absent on older stock. Both are
 * shown because a librarian searching for either should find the row.
 */
export function CopyListPage(): ReactNode {
  const [status, setStatus] = useState<CopyStatusDto | ''>('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);

  const { branches } = useBranchOptions();

  const { copies, meta, loading, error, reload } = useCopyList({
    page,
    limit: 20,
    ...(status ? { status } : {}),
    ...(branchId ? { branchId } : {}),
  });

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    setPage(1);
  }

  const columns: Column<CopyDto>[] = [
    {
      key: 'accession',
      header: 'Accession',
      render: (copy) => (
        <div className="cell-stack">
          <span className="cell-stack__primary">{copy.accessionNumber}</span>
          <span className="cell-stack__secondary">{copy.barcode ?? 'No barcode'}</span>
        </div>
      ),
    },
    {
      key: 'book',
      header: 'Book',
      render: (copy) => (
        <Link to={paths.book(copy.book.id)} className="link">
          {copy.book.title}
        </Link>
      ),
    },
    {
      key: 'branch',
      header: 'Branch',
      secondary: true,
      render: (copy) => copy.branch.name,
    },
    {
      key: 'location',
      header: 'Location',
      secondary: true,
      render: (copy) => [copy.location?.name, copy.shelf?.code].filter(Boolean).join(' · ') || '—',
    },
    { key: 'condition', header: 'Condition', render: (copy) => copy.condition.replace(/_/g, ' ') },
    {
      key: 'status',
      header: 'Status',
      render: (copy) => (
        <Badge tone={toneFor(copy.status)}>{COPY_STATUS_LABELS[copy.status]}</Badge>
      ),
    },
    {
      key: 'acquired',
      header: 'Acquired',
      secondary: true,
      render: (copy) => formatCalendarDate(copy.acquisitionDate),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Book Copies</h1>
          <p className="page-header__subtitle">
            Every physical item in the catalogue, with its condition and current status.
          </p>
        </div>
      </header>

      <Card>
        <form className="filters" onSubmit={handleSearch} role="search">
          {/*
            This form takes no free-text field. The copy search endpoint does not
            accept one, so offering a search box that silently filters nothing would
            be worse than not offering it — the user would type a barcode, see a full
            unchanged list, and conclude their barcode does not exist.
          */}
          <SelectField
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All statuses' },
              ...COPY_STATUS_FILTERS.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
          />

          {branches.length > 1 && (
            <SelectField
              label="Branch"
              value={branchId}
              onChange={(value) => {
                setBranchId(value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All branches in scope' },
                ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
              ]}
            />
          )}

          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>

        {error ? (
          <ErrorState error={error} onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption="Book copies"
              columns={columns}
              rows={copies}
              rowKey={(copy) => copy.id}
              loading={loading}
              emptyTitle="No copies match those filters"
              emptyDescription="Try a different status or branch."
            />

            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}

/**
 * Status to tone, in one place so this table and the dashboard's donut agree that
 * an unavailable copy is a warning and a lost copy is a problem.
 */
function toneFor(status: CopyStatusDto): BadgeTone {
  switch (status) {
    case 'AVAILABLE':
      return 'ok';
    case 'BORROWED':
    case 'RESERVED':
      return 'info';
    case 'MAINTENANCE':
      return 'warn';
    case 'LOST':
    case 'DAMAGED':
      return 'bad';
    default:
      return 'neutral';
  }
}
