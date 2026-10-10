import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card, Stat, StatGrid } from '../../../components/ui/Card';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { DescriptionItem, DescriptionList } from '../../../components/ui/Table';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { formatCalendarDate, formatInstant } from '../../../lib/format';
import { paths } from '../../../routes/paths';
import { COPY_STATUS_LABELS, archiveBook, deleteBook, getBook, type BookDto } from '../api';
import { useCopyList } from '../useCatalogueQueries';

/**
 * A single bibliographic record.
 *
 * Four catalogue pages linked to `/books/:id` — the book list, the copies list, the
 * loan list and the reservations list — and none of them had a page behind the link,
 * so every one of those links was a 404. The backend endpoint and the client's
 * `getBook` both already existed; only the route and this component were missing.
 *
 * Two things this page is careful about:
 *
 *   1. **The copy breakdown is a separate, permission-gated request.** `toBookDto`
 *      returns only `{ total, available, onLoan }`, so the per-status breakdown needs
 *      `COPY_VIEW`. A member holding `BOOK_VIEW` but not `COPY_VIEW` sees the totals
 *      from the book record and no breakdown table, rather than an error where the
 *      table would be.
 *   2. **An archived record says so.** `archivedAt` drives a banner at the top. A
 *      librarian searching the catalogue for a withdrawn title needs to know it is
 *      withdrawn before they try to order another copy.
 */
export function BookDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [book, setBook] = useState<BookDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const response = await getBook(id, signal);
        setBook(response.data.book);
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

  const canSeeCopies = can('COPY_VIEW');

  // Hooked unconditionally so the copy request is not torn down and re-issued when
  // the permission is absent; `enabled` gates the fetch instead.
  const copies = useCopyList({
    bookId: id,
    limit: 50,
    ...(canSeeCopies ? {} : { enabled: false }),
  });

  async function handleWithdraw(): Promise<void> {
    setWithdrawing(true);
    try {
      await archiveBook(id);
      notify(`${book?.title ?? 'Book'} withdrawn from the catalogue`, 'success');
      void navigate(paths.books);
    } catch {
      notify('Could not withdraw that book. Try again.', 'error');
      setConfirmingWithdraw(false);
    } finally {
      setWithdrawing(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    try {
      await deleteBook(id);
      notify(`${book?.title ?? 'Book'} deleted`, 'success');
      void navigate(paths.books);
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : 'Could not delete that book. Withdraw it instead to keep its history.',
        'error',
      );
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <LoadingState label="Loading title" rows={6} />;
  if (error)
    return <ErrorState error={error} onRetry={() => void load(new AbortController().signal)} />;
  if (!book) return null;

  const unavailable = Math.max(0, book.copies.total - book.copies.available);
  const authorLine =
    book.authors.length > 0
      ? book.authors.map((author) => author.name).join(', ')
      : 'No author recorded';

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">
            <Link className="link" to={paths.books}>
              Catalogue
            </Link>
          </p>
          <h1 className="page-header__title">{book.title}</h1>
          <p className="page-header__subtitle">
            {authorLine}
            {book.publicationYear ? ` · ${book.publicationYear}` : ''}
          </p>
        </div>

        <div className="page-header__actions">
          {book.isReferenceOnly && <Badge tone="info">Reference only</Badge>}
          {book.archivedAt && <Badge tone="bad">Withdrawn</Badge>}
          {!book.archivedAt && can('BOOK_UPDATE') && (
            <Link className="btn btn--secondary" to={paths.bookEdit(book.id)}>
              Edit
            </Link>
          )}
          {!book.archivedAt && can('BOOK_ARCHIVE') && (
            <Button variant="danger" onClick={() => setConfirmingWithdraw(true)}>
              Withdraw
            </Button>
          )}
          {!book.archivedAt && can('BOOK_DELETE') && (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </header>

      {book.archivedAt && (
        <Card>
          <p className="form__note">
            This title was withdrawn on {formatCalendarDate(book.archivedAt)}. It remains searchable
            for audit but should not be ordered or issued.
          </p>
        </Card>
      )}

      <StatGrid>
        <Stat
          label="Copies"
          value={String(book.copies.total)}
          hint={`${book.copies.onLoan} on loan`}
        />
        <Stat
          label="Available"
          value={String(book.copies.available)}
          tone={book.copies.available > 0 ? 'ok' : 'warn'}
          hint={book.copies.total > 0 ? `${unavailable} not on shelf` : 'No copies held'}
        />
        {book.callNumber && <Stat label="Call number" value={book.callNumber} />}
        {book.isbn13 && <Stat label="ISBN-13" value={book.isbn13} />}
      </StatGrid>

      <div className="grid grid--two">
        <Card title="Description">
          {book.description ? (
            <p className="prose">{book.description}</p>
          ) : book.summary ? (
            <p className="prose">{book.summary}</p>
          ) : (
            /*
             * An em dash, not an invented blurb. A catalogue record with no
             * description is a real and common state — especially for locally
             * catalogued material — and filling the gap with a generated sentence
             * would be the page quietly lying about a book it knows nothing about.
             */
            <p className="prose prose--muted">No description recorded.</p>
          )}
        </Card>

        <Card title="Publication">
          <DescriptionList>
            <DescriptionItem term="Edition">{book.edition ?? '—'}</DescriptionItem>
            <DescriptionItem term="Publisher">{book.publisher ?? '—'}</DescriptionItem>
            <DescriptionItem term="Language">{book.language ?? '—'}</DescriptionItem>
            <DescriptionItem term="Pages">{book.pageCount ?? '—'}</DescriptionItem>
            <DescriptionItem term="ISBN-10">{book.isbn10 ?? '—'}</DescriptionItem>
            <DescriptionItem term="Published">
              {book.publicationDate
                ? formatCalendarDate(book.publicationDate)
                : book.publicationYear
                  ? String(book.publicationYear)
                  : '—'}
            </DescriptionItem>
          </DescriptionList>
        </Card>
      </div>

      {(book.categories.length > 0 || book.tags.length > 0 || book.subjects.length > 0) && (
        <Card title="Classification">
          <div className="tag-row">
            {book.categories.map((category) => (
              <Badge key={category.id} tone={category.isPrimary ? 'ok' : 'neutral'}>
                {category.name}
              </Badge>
            ))}
            {book.tags.map((tag) => (
              <Badge key={tag.id} tone="neutral">
                {tag.label ?? tag.name}
              </Badge>
            ))}
            {book.subjects.map((subject) => (
              <Badge key={subject} tone="neutral">
                {subject}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {canSeeCopies ? (
        <Card title="Copies">
          {/*
            The summary above already gave the totals for every caller entitled to
            this card. The table adds the per-copy detail a librarian needs to shelve
            or pull something, and says so when there is nothing to shelve.
          */}
          {book.copies.total === 0 ? (
            <p className="prose prose--muted">
              No copies of this title are held. Use Add Copy to accession one.
            </p>
          ) : (
            <>
              <p className="form__note">
                Showing up to {copies.meta.total} {copies.meta.total === 1 ? 'copy' : 'copies'}.
              </p>
              <ul className="tag-row">
                {copies.copies.map((copy) => (
                  <li key={copy.id}>
                    <Badge tone={copy.status === 'AVAILABLE' ? 'ok' : 'neutral'}>
                      {copy.accessionNumber} · {COPY_STATUS_LABELS[copy.status]}
                      {copy.location ? ` · ${copy.location.name}` : ''}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      ) : (
        book.copies.total > 0 && (
          <Card title="Copies">
            <p className="form__note">
              {book.copies.total} held, {book.copies.available} available. Per-copy detail needs
              copy records access.
            </p>
          </Card>
        )
      )}

      <Card title="Record">
        <DescriptionList>
          <DescriptionItem term="Added">{formatInstant(book.createdAt)}</DescriptionItem>
          <DescriptionItem term="Last updated">{formatInstant(book.updatedAt)}</DescriptionItem>
          <DescriptionItem term="Call number">{book.callNumber ?? '—'}</DescriptionItem>
        </DescriptionList>
      </Card>

      <ConfirmDialog
        open={confirmingWithdraw}
        title="Withdraw this book?"
        message={
          <>
            <strong>{book.title}</strong> will be withdrawn from circulation. Its record
            {book.copies.total > 1 ? `, ${book.copies.total} copies` : ''} and loan history are kept
            for audit, and it remains searchable so a loan can still be traced.
          </>
        }
        confirmLabel="Withdraw"
        busy={withdrawing}
        onConfirm={() => void handleWithdraw()}
        onCancel={() => setConfirmingWithdraw(false)}
      />

      <ConfirmDialog
        open={confirmingDelete}
        title="Permanently delete this book?"
        message={
          <>
            <strong>{book.title}</strong> will be destroyed, along with its
            {book.copies.total > 0 ? ` ${book.copies.total} copies` : ' copies'} (if any). The
            server refuses while a copy, loan, reservation, borrow request or digital resource still
            references this record — withdraw it instead, which keeps that history for audit.
          </>
        }
        confirmLabel="Delete permanently"
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
