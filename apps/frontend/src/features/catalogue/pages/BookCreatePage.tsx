import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import { errorMessage } from '../../../components/ui/States';
import { fieldErrors } from '../../../lib/contracts';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../contexts/ToastContext';
import { paths } from '../../../routes/paths';
import { useAuthorList, useCategoryList, usePublisherList } from '../useCatalogueQueries';
import { createBook, type BookCreateInput } from '../api';
import { BookFormFields, emptyBookForm, type BookFormState } from './BookFormFields';

/**
 * Add a title to the catalogue.
 *
 * The form sends only what was typed, and never an empty string where empty means
 * "not recorded". `bookCreateSchema` is `.strict()`, so a stray field a future
 * version of the form introduces would be rejected loudly rather than ignored —
 * which is exactly what the create path wants.
 */
export function BookCreatePage(): ReactNode {
  const navigate = useNavigate();
  const { notify } = useToast();

  const [form, setForm] = useState<BookFormState>(emptyBookForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const authors = useAuthorList({ limit: 100 });
  const categories = useCategoryList({ limit: 100 });
  const publishers = usePublisherList({ limit: 100 });
  const optionLoading = authors.loading || categories.loading || publishers.loading;

  function update<K extends keyof BookFormState>(field: K, value: BookFormState[K]): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!form.title.trim()) nextErrors.title = 'Enter a title.';
    if (form.authorIds.length === 0) nextErrors.authorIds = 'Select at least one author.';
    if (form.categoryIds.length === 0) nextErrors.categoryIds = 'Select at least one category.';
    if (!/^\d+$/.test(form.copies.trim()) || Number(form.copies) < 1) {
      nextErrors.copies = 'Enter at least one copy to add.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    const optional = (value: string): string | undefined =>
      value.trim() ? value.trim() : undefined;

    const subjectList = form.subjectsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    // Pre-computed before the spread. `exactOptionalPropertyTypes` means an
    // optional property must never carry `undefined`, and TS only narrows a value
    // below `string | undefined` when it watches a single expression — the
    // `optional(x) ? { x: optional(x) }` double call defeats that narrowing.
    const subtitle = optional(form.subtitle);
    const description = optional(form.description);
    const summary = optional(form.summary);
    const edition = optional(form.edition);
    const callNumber = optional(form.callNumber);
    const coverImageUrl = optional(form.coverImageUrl);
    const isbn13 = form.isbn13.trim() ? form.isbn13.trim() : undefined;
    const isbn10 = form.isbn10.trim() ? form.isbn10.trim() : undefined;
    const publicationYear = form.publicationYear.trim() ? Number(form.publicationYear) : undefined;
    const pageCount = form.pageCount.trim() ? Number(form.pageCount) : undefined;
    const copies = form.copies.trim() ? Number(form.copies) : undefined;

    const input: BookCreateInput = {
      title: form.title.trim(),
      language: form.language.trim() || 'en',
      isReferenceOnly: form.isReferenceOnly,
      ...(subtitle ? { subtitle } : {}),
      ...(description ? { description } : {}),
      ...(summary ? { summary } : {}),
      ...(edition ? { edition } : {}),
      ...(callNumber ? { callNumber } : {}),
      ...(coverImageUrl ? { coverImageUrl } : {}),
      ...(isbn13 ? { isbn13 } : {}),
      ...(isbn10 ? { isbn10 } : {}),
      ...(publicationYear !== undefined ? { publicationYear } : {}),
      ...(form.publicationDate ? { publicationDate: form.publicationDate } : {}),
      ...(pageCount !== undefined ? { pageCount } : {}),
      ...(form.publisherId ? { publisherId: form.publisherId } : {}),
      ...(subjectList.length > 0 ? { subjects: subjectList } : {}),
      ...(form.authorIds.length > 0 ? { authorIds: form.authorIds } : {}),
      ...(form.categoryIds.length > 0 ? { categoryIds: form.categoryIds } : {}),
      ...(copies !== undefined ? { copies } : {}),
    };

    try {
      const response = await createBook(input);
      notify(`${response.data.book.title} added to the catalogue`, 'success');
      void navigate(paths.book(response.data.book.id), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">
            <button type="button" className="link" onClick={() => void navigate(paths.books)}>
              Books
            </button>
          </p>
          <h1 className="page-header__title">Add a book</h1>
          <p className="page-header__subtitle">
            Creates the bibliographic record. Copies can be accessioned at the same time, or added
            against it afterwards.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void navigate(paths.books)}>
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
          mode="create"
          form={form}
          update={update}
          errors={errors}
          authors={authors.authors}
          categories={categories.categories}
          publishers={publishers.publishers}
          optionLoading={optionLoading}
        />

        <div className="form__actions">
          <Button variant="ghost" onClick={() => void navigate(paths.books)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel="Adding…">
            Add book
          </Button>
        </div>
      </form>
    </>
  );
}
