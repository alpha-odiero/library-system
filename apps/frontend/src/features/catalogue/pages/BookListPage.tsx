import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { CheckboxField, SelectField } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { ErrorState } from '../../../components/ui/States';
import { formatCalendarDate } from '../../../lib/format';
import { useAuth } from '../../../contexts/AuthContext';
import { usePreference } from '../../../lib/preferences';
import { useBranchOptions } from '../../branches/useBranchOptions';
import { paths } from '../../../routes/paths';
import { useBookList } from '../useCatalogueQueries';
import type { BookDto } from '../api';

/**
 * The catalogue.
 *
 * The availability column is the one a librarian actually reads first, so it shows
 * "3 of 8" rather than a badge — the number available and the number held together
 * are the pair that answers "can this be borrowed right now". `availableOnly` is a
 * filter for the same question, which is why it sits next to the branch filter
 * rather than in a menu.
 */
export function BookListPage(): ReactNode {
  const { can, session } = useAuth();
  const userId = session?.userId ?? 'anonymous';

  /*
   * Two catalogue preferences, kept in Settings → Library Preferences. They are
   * the client's own defaults (stored on this device), not library policy — the
   * page reads them rather than asking the API, which is why a change there
   * takes effect on the next visit here without a server round trip.
   */
  const [availableOnly, setAvailableOnly] = usePreference<boolean>(
    userId,
    'preference.availableOnly',
    false,
  );
  const [storedPageSize] = usePreference<number>(userId, 'preference.pageSize', 20);
  // Read back through a range check rather than trusted: the value comes from
  // localStorage, and a page size of 5000 is a denial of service pointed at
  // your own API.
  const limit =
    Number.isFinite(storedPageSize) && storedPageSize >= 10 && storedPageSize <= 100
      ? storedPageSize
      : 20;

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);

  const { branches } = useBranchOptions();

  const { books, meta, loading, error, reload } = useBookList({
    page,
    limit,
    ...(search ? { q: search } : {}),
    ...(branchId ? { branchId } : {}),
    ...(availableOnly ? { availableOnly: true } : {}),
  });

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    // Any filter change returns to page 1. Staying on page 7 of a two-page result
    // set renders an empty table that reads like a bug.
    setPage(1);
    setSearch(query.trim());
  }

  const columns: Column<BookDto>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (book) => (
        <div className="cell-stack">
          <Link className="link" to={paths.book(book.id)}>
            {book.title}
          </Link>
          <span className="cell-stack__secondary">
            {book.authors.length > 0
              ? book.authors.map((author) => author.name).join(', ')
              : 'No author recorded'}
          </span>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      secondary: true,
      render: (book) => book.categories[0]?.name ?? (book.subjects[0] ? book.subjects[0] : '—'),
    },
    { key: 'year', header: 'Year', secondary: true, render: (book) => book.publicationYear ?? '—' },
    {
      key: 'copies',
      header: 'Copies',
      align: 'right',
      render: (book) => `${book.copies.available} of ${book.copies.total}`,
    },
    {
      key: 'availability',
      header: 'Availability',
      render: (book) =>
        book.copies.total === 0 ? (
          <Badge tone="neutral">No copies</Badge>
        ) : book.copies.available > 0 ? (
          <Badge tone="ok">Available</Badge>
        ) : (
          <Badge tone="warn">On loan</Badge>
        ),
    },
    {
      key: 'reference',
      header: 'Reference',
      secondary: true,
      render: (book) =>
        book.isReferenceOnly ? <Badge tone="info">Reference only</Badge> : (book.callNumber ?? '—'),
    },
    {
      key: 'added',
      header: 'Added',
      secondary: true,
      render: (book) => formatCalendarDate(book.createdAt),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Books</h1>
          <p className="page-header__subtitle">
            Bibliographic records for the catalogue, with live copy availability.
          </p>
        </div>
        {can('BOOK_CREATE') && (
          <Link className="btn btn--primary" to={paths.bookNew}>
            Add book
          </Link>
        )}
      </header>

      <Card>
        <form className="filters" onSubmit={handleSearch} role="search">
          <div className="field filters__grow">
            <label className="field__label" htmlFor="book-search">
              Search books
            </label>
            <input
              id="book-search"
              className="input"
              type="search"
              value={query}
              placeholder="Title, author, ISBN or call number"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

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

          {/*
            A checkbox rather than a select: it is a boolean, and a two-option
            select for "show everything / only available" makes the reader open a
            dropdown to say no.
          */}
          <CheckboxField
            label="Available now"
            checked={availableOnly}
            onChange={(checked) => {
              setAvailableOnly(checked);
              setPage(1);
            }}
          />

          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error ? (
          <ErrorState error={error} onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption="Book catalogue"
              columns={columns}
              rows={books}
              rowKey={(book) => book.id}
              loading={loading}
              emptyTitle="No books match those filters"
              emptyDescription="Try a different title, author or branch."
            />

            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
