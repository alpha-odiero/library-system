import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { Button } from '../../../components/ui/Button';
import { fieldErrors } from '../../../lib/contracts';
import { useToast } from '../../../contexts/ToastContext';
import { paths } from '../../../routes/paths';
import { useAuthorList, useCategoryList } from '../useCatalogueQueries';
import { getBook, updateBook, type BookDto, type BookUpdateInput } from '../api';
import {
  BookFormFields,
  bookFormFromDto,
  emptyBookForm,
  type BookFormState,
} from './BookFormFields';

/**
 * Edit a bibliographic record.
 *
 * The form sends only what changed, mirroring `MemberEditPage`:
 *
 *   • `bookUpdateSchema` is `.strict()` and rejects an empty PATCH, so a
 *     submit-with-no-edits must be caught before it costs a round trip.
 *   • The schema distinguishes `null` (clear) from absent (leave alone). A
 *     cleared text field is sent as `null`; an untouched one is omitted.
 *   • An ISBN is never "cleared" — the schema has no nullable ISBN, so the field
 *     is simply omitted when blank rather than offered as an action the server
 *     would refuse.
 *   • The publisher is not editable: `toBookDto` returns the publisher name, not
 *     the id, so the form cannot point an existing record back at a select
 *     without guessing which publisher the name belongs to.
 */
export function BookEditPage(): ReactNode {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [book, setBook] = useState<BookDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);

  const [form, setForm] = useState<BookFormState>(emptyBookForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const authors = useAuthorList({ limit: 100 });
  const categories = useCategoryList({ limit: 100 });
  const optionLoading = authors.loading || categories.loading;

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setLoadError(null);

      try {
        const response = await getBook(id, signal);
        setBook(response.data.book);
        setForm(bookFormFromDto(response.data.book));
      } catch (caught) {
        if (!signal.aborted) setLoadError(caught);
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

  function update<K extends keyof BookFormState>(field: K, value: BookFormState[K]): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changedFields(): BookUpdateInput {
    if (!book) return {};
    const patch: BookUpdateInput = {};

    // A cleared text field becomes `null` (erase); an unchanged one is omitted.
    // The ISBN fields are the exception — the schema cannot null them.
    const clearable = (field: keyof BookUpdateInput, current: string, initial: string): void => {
      const trimmed = current.trim();
      if (trimmed === initial) return;
      (patch as Record<string, unknown>)[field] = trimmed === '' ? null : trimmed;
    };

    if (form.title.trim() !== book.title) patch.title = form.title.trim();

    // The two ISBNs are never sent blank: the update schema rejects `null`, so a
    // cleared input would come back as a 400. Blank here simply means "leave it".
    const isbn = (field: 'isbn10' | 'isbn13', current: string, initial: string): void => {
      const trimmed = current.trim();
      if (trimmed === '' || trimmed === initial) return;
      patch[field] = trimmed;
    };

    isbn('isbn13', form.isbn13, book.isbn13 ?? '');
    isbn('isbn10', form.isbn10, book.isbn10 ?? '');
    clearable('subtitle', form.subtitle, book.subtitle ?? '');
    clearable('description', form.description, book.description ?? '');
    clearable('summary', form.summary, book.summary ?? '');
    clearable('edition', form.edition, book.edition ?? '');
    clearable('callNumber', form.callNumber, book.callNumber ?? '');
    clearable('coverImageUrl', form.coverImageUrl, book.coverImageUrl ?? '');

    if (form.language.trim() !== (book.language ?? 'en')) {
      patch.language = form.language.trim() || 'en';
    }

    const initialYear = book.publicationYear !== null ? String(book.publicationYear) : '';
    if (form.publicationYear !== initialYear) {
      patch.publicationYear =
        form.publicationYear.trim() === '' ? null : Number(form.publicationYear);
    }

    const initialDate = book.publicationDate ? book.publicationDate.slice(0, 10) : '';
    if (form.publicationDate !== initialDate) {
      patch.publicationDate = form.publicationDate || null;
    }

    const initialPages = book.pageCount !== null ? String(book.pageCount) : '';
    if (form.pageCount !== initialPages) {
      patch.pageCount = form.pageCount.trim() === '' ? null : Number(form.pageCount);
    }

    const subjects = form.subjectsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!sameList(subjects, book.subjects)) patch.subjects = subjects;

    if (
      !sameList(
        form.authorIds,
        book.authors.map((author) => author.id),
      )
    ) {
      patch.authorIds = form.authorIds;
    }
    if (
      !sameList(
        form.categoryIds,
        book.categories.map((category) => category.id),
      )
    ) {
      patch.categoryIds = form.categoryIds;
    }

    if (form.isReferenceOnly !== book.isReferenceOnly) patch.isReferenceOnly = form.isReferenceOnly;

    return patch;
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!form.title.trim()) {
      setErrors({ title: 'Enter a title.' });
      return;
    }

    const patch = changedFields();
    if (Object.keys(patch).length === 0) {
      notify('Nothing to save — no field was changed.', 'info');
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      await updateBook(id, patch);
      notify('Book updated', 'success');
      void navigate(paths.book(id), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError('Could not save those changes.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading title" rows={6} />;
  if (loadError)
    return <ErrorState error={loadError} onRetry={() => void load(new AbortController().signal)} />;
  if (!book) return null;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">
            <button type="button" className="link" onClick={() => void navigate(paths.book(id))}>
              {book.title}
            </button>
          </p>
          <h1 className="page-header__title">Edit book</h1>
          <p className="page-header__subtitle">Only the fields you change are sent.</p>
        </div>
        <Button variant="ghost" onClick={() => void navigate(paths.book(id))}>
          Cancel
        </Button>
      </header>

      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <BookFormFields
          mode="edit"
          form={form}
          update={update}
          errors={errors}
          authors={authors.authors}
          categories={categories.categories}
          publishers={[]}
          optionLoading={optionLoading}
        />

        <div className="form__actions">
          <Button variant="ghost" onClick={() => void navigate(paths.book(id))} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel="Saving…">
            Save changes
          </Button>
        </div>
      </form>
    </>
  );
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}
