import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { ErrorState } from '../../../components/ui/States';
import { Badge } from '../../../components/ui/Badge';
import { ConfirmDialog, Dialog } from '../../../components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { useAuthorList, useCategoryList, usePublisherList } from '../useCatalogueQueries';
import {
  createAuthor,
  updateAuthor,
  deleteAuthor,
  createCategory,
  updateCategory,
  deleteCategory,
  type AuthorDto,
  type AuthorUpdateInput,
  type CategoryDto,
  type CategoryUpdateInput,
  type PublisherDto,
} from '../api';

/**
 * The three reference lists that books hang off.
 *
 * Authors and categories are editable behind `AUTHOR_MANAGE` / `CATEGORY_MANAGE`,
 * with the same create/edit-in-a-dialog and confirm-before-delete pattern as the
 * member types page. Publishers stay read-only — the request was for authors,
 * categories and books, and a greyed "Add publisher" is the kind of promise this
 * page does not keep.
 */
export function AuthorListPage(): ReactNode {
  const { can } = useAuth();
  const { notify } = useToast();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AuthorDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AuthorDto | null>(null);
  const [busy, setBusy] = useState(false);

  const canManage = can('AUTHOR_MANAGE');

  const { authors, meta, loading, error, reload } = useAuthorList({
    page,
    limit: 25,
    ...(search ? { q: search } : {}),
  });

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  }

  async function handleDelete(): Promise<void> {
    if (!pendingDelete) return;
    setBusy(true);

    try {
      await deleteAuthor(pendingDelete.id);
      notify(`${pendingDelete.name} deleted`, 'success');
      setPendingDelete(null);
      await reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Could not delete that author', 'error');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<AuthorDto>[] = [
    {
      key: 'name',
      header: 'Author',
      render: (author) => (
        <div className="cell-stack">
          <span className="cell-stack__primary">{author.name}</span>
          {author.sortName && author.sortName !== author.name && (
            <span className="cell-stack__secondary">Surname order: {author.sortName}</span>
          )}
        </div>
      ),
    },
    {
      key: 'nationality',
      header: 'Nationality',
      secondary: true,
      render: (a) => a.nationality ?? '—',
    },
    {
      key: 'life',
      header: 'Dates',
      render: (author) => {
        if (author.birthYear === null && author.deathYear === null) return '—';
        return `${author.birthYear ?? '?'}–${author.deathYear ?? ''}`;
      },
    },
    {
      key: 'biography',
      header: 'Biography',
      secondary: true,
      // Truncated to a length that fits a table cell: the full text belongs on a
      // detail page, and an unbroken paragraph here is what makes a list unusable.
      render: (author) => (author.biography ? `${author.biography.slice(0, 120)}…` : '—'),
    },
    {
      key: 'actions',
      header: 'Manage',
      align: 'right',
      secondary: true,
      render: (author) =>
        canManage ? (
          <div className="row-actions">
            <Button variant="ghost" size="sm" onClick={() => setEditing(author)}>
              Edit
            </Button>
            <Button variant="danger" size="sm" onClick={() => setPendingDelete(author)}>
              Delete
            </Button>
          </div>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Authors</h1>
          <p className="page-header__subtitle">Name authorities used across the catalogue.</p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add author
          </Button>
        )}
      </header>

      <Card>
        <form className="filters" onSubmit={handleSearch} role="search">
          <div className="field filters__grow">
            <label className="field__label" htmlFor="author-search">
              Search authors
            </label>
            <input
              id="author-search"
              className="input"
              type="search"
              value={query}
              placeholder="Name or surname"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error ? (
          <ErrorState error={error} onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption="Authors"
              columns={columns}
              rows={authors}
              rowKey={(author) => author.id}
              loading={loading}
              emptyTitle="No authors match that search"
            />
            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>

      {creating && (
        <AuthorFormDialog
          mode="create"
          onClose={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}

      {editing && (
        <AuthorFormDialog
          mode="edit"
          author={editing}
          onClose={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this author?"
        message={
          <>
            <strong>{pendingDelete?.name}</strong> will be removed as a name authority. Books
            already catalogued are not deleted, but they lose this author link.
          </>
        }
        confirmLabel="Delete author"
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

export function PublisherListPage(): ReactNode {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { publishers, meta, loading, error, reload } = usePublisherList({
    page,
    limit: 25,
    ...(search ? { q: search } : {}),
  });

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  }

  const columns: Column<PublisherDto>[] = [
    {
      key: 'name',
      header: 'Publisher',
      render: (publisher) => (
        <div className="cell-stack">
          <span className="cell-stack__primary">{publisher.name}</span>
          {publisher.imprint && (
            <span className="cell-stack__secondary">Imprint: {publisher.imprint}</span>
          )}
        </div>
      ),
    },
    { key: 'country', header: 'Country', render: (publisher) => publisher.country ?? '—' },
    {
      key: 'website',
      header: 'Website',
      secondary: true,
      render: (publisher) => publisher.website ?? '—',
    },
    {
      key: 'email',
      header: 'Email',
      secondary: true,
      render: (publisher) => publisher.email ?? '—',
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Publishers</h1>
          <p className="page-header__subtitle">Publishing bodies recorded in the catalogue.</p>
        </div>
      </header>

      <Card>
        <form className="filters" onSubmit={handleSearch} role="search">
          <div className="field filters__grow">
            <label className="field__label" htmlFor="publisher-search">
              Search publishers
            </label>
            <input
              id="publisher-search"
              className="input"
              type="search"
              value={query}
              placeholder="Name, imprint or country"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error ? (
          <ErrorState error={error} onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption="Publishers"
              columns={columns}
              rows={publishers}
              rowKey={(publisher) => publisher.id}
              loading={loading}
              emptyTitle="No publishers match that search"
            />
            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}

export function CategoryListPage(): ReactNode {
  const { can } = useAuth();
  const { notify } = useToast();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CategoryDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CategoryDto | null>(null);
  const [busy, setBusy] = useState(false);

  const canManage = can('CATEGORY_MANAGE');

  const { categories, meta, loading, error, reload } = useCategoryList({
    page,
    limit: 25,
    ...(search ? { q: search } : {}),
  });

  // A complete (capped) list for the parent picker in the create/edit dialog. The
  // paginated table above can hold a parent on a page the dialog never sees.
  const parentSource = useCategoryList({ limit: 100 });

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  }

  async function handleDelete(): Promise<void> {
    if (!pendingDelete) return;
    setBusy(true);

    try {
      await deleteCategory(pendingDelete.id);
      notify(`${pendingDelete.name} deleted`, 'success');
      setPendingDelete(null);
      await reload();
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : 'Could not delete that category',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<CategoryDto>[] = [
    {
      key: 'name',
      header: 'Category',
      render: (category) => (
        <div className="cell-stack">
          <span className="cell-stack__primary">{category.name}</span>
          {/*
            `.name`, not the object itself. `parent` is a nested
            `{ id, name, slug }` relation — see `CategoryParentDto`. Interpolating the
            object was the crash; the guard above it passed because a non-null object
            is truthy, which is why this only ever failed at render time.
          */}
          {category.parent && (
            <span className="cell-stack__secondary">Under {category.parent.name}</span>
          )}
        </div>
      ),
    },
    { key: 'slug', header: 'Slug', secondary: true, render: (category) => category.slug },
    {
      key: 'position',
      header: 'Order',
      align: 'right',
      render: (category) => category.position,
    },
    {
      key: 'status',
      header: 'Status',
      render: (category) => (
        <Badge tone={category.isActive ? 'ok' : 'neutral'}>
          {category.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Manage',
      align: 'right',
      secondary: true,
      render: (category) =>
        canManage ? (
          <div className="row-actions">
            <Button variant="ghost" size="sm" onClick={() => setEditing(category)}>
              Edit
            </Button>
            <Button variant="danger" size="sm" onClick={() => setPendingDelete(category)}>
              Delete
            </Button>
          </div>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Categories</h1>
          <p className="page-header__subtitle">
            The subject hierarchy used to organise the catalogue.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add category
          </Button>
        )}
      </header>

      <Card>
        <form className="filters" onSubmit={handleSearch} role="search">
          <div className="field filters__grow">
            <label className="field__label" htmlFor="category-search">
              Search categories
            </label>
            <input
              id="category-search"
              className="input"
              type="search"
              value={query}
              placeholder="Name or subject"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error ? (
          <ErrorState error={error} onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption="Categories"
              columns={columns}
              rows={categories}
              rowKey={(category) => category.id}
              loading={loading}
              emptyTitle="No categories match that search"
            />
            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>

      {creating && (
        <CategoryFormDialog
          mode="create"
          parentCategories={parentSource.categories}
          onClose={() => {
            setCreating(false);
            void reload();
            void parentSource.reload();
          }}
        />
      )}

      {editing && (
        <CategoryFormDialog
          mode="edit"
          category={editing}
          parentCategories={parentSource.categories}
          onClose={() => {
            setEditing(null);
            void reload();
            void parentSource.reload();
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this category?"
        message={
          <>
            <strong>{pendingDelete?.name}</strong> will be removed from the subject hierarchy. Books
            keep their other categories.
          </>
        }
        confirmLabel="Delete category"
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

/* ── Author dialog ─────────────────────────────────────────────────────────── */

function AuthorFormDialog({
  mode,
  author,
  onClose,
}: {
  mode: 'create' | 'edit';
  author?: AuthorDto;
  onClose: () => void;
}): ReactNode {
  const { notify } = useToast();
  const editing = mode === 'edit' && author !== undefined;

  const [form, setForm] = useState({
    name: author?.name ?? '',
    sortName: author?.sortName ?? '',
    nationality: author?.nationality ?? '',
    birthYear:
      author?.birthYear !== null && author?.birthYear !== undefined ? String(author.birthYear) : '',
    deathYear:
      author?.deathYear !== null && author?.deathYear !== undefined ? String(author.deathYear) : '',
    biography: author?.biography ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const yearIsValid = (value: string): boolean =>
    value.trim() === '' || /^\d{1,4}$/.test(value.trim());

  function changedFields(): AuthorUpdateInput {
    if (!author) return {};
    const patch: AuthorUpdateInput = {};
    const years = author.birthYear === null ? '' : String(author.birthYear);

    if (form.name.trim() !== author.name) patch.name = form.name.trim();

    const clearable = (
      field: keyof AuthorUpdateInput,
      current: string,
      initial: string | null,
    ): void => {
      const trimmed = current.trim();
      if (trimmed === (initial ?? '')) return;
      (patch as Record<string, unknown>)[field] = trimmed === '' ? null : trimmed;
    };

    clearable('sortName', form.sortName, author.sortName ?? '');
    clearable('biography', form.biography, author.biography ?? '');
    clearable('nationality', form.nationality, author.nationality ?? '');

    if (form.birthYear !== years) {
      patch.birthYear = form.birthYear.trim() === '' ? null : Number(form.birthYear.trim());
    }
    const death = author.deathYear === null ? '' : String(author.deathYear);
    if (form.deathYear !== death) {
      patch.deathYear = form.deathYear.trim() === '' ? null : Number(form.deathYear.trim());
    }

    return patch;
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!form.name.trim()) {
      setErrors({ name: 'Enter a name.' });
      return;
    }
    if (!yearIsValid(form.birthYear) || !yearIsValid(form.deathYear)) {
      setErrors({ birthYear: 'A year is 1–4 digits.' });
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    const optional = (value: string): string | undefined =>
      value.trim() ? value.trim() : undefined;

    // Narrowed before the spread (see the note in BookCreatePage): calling
    // `optional()` again inside the object arms defeats exact-optional narrowing.
    const sortName = optional(form.sortName);
    const biography = optional(form.biography);
    const nationality = optional(form.nationality);
    const birthYear = form.birthYear.trim() ? Number(form.birthYear.trim()) : undefined;
    const deathYear = form.deathYear.trim() ? Number(form.deathYear.trim()) : undefined;

    try {
      if (editing && author) {
        const patch = changedFields();
        if (Object.keys(patch).length === 0) {
          notify('Nothing to save — no field was changed.', 'info');
          setBusy(false);
          return;
        }
        await updateAuthor(author.id, patch);
        notify(`${author.name} updated`, 'success');
      } else {
        const input = {
          name: form.name.trim(),
          ...(sortName ? { sortName } : {}),
          ...(biography ? { biography } : {}),
          ...(nationality ? { nationality } : {}),
          ...(birthYear !== undefined ? { birthYear } : {}),
          ...(deathYear !== undefined ? { deathYear } : {}),
        };
        await createAuthor(input);
        notify(`${input.name} created`, 'success');
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError(`Could not ${editing ? 'update' : 'create'} that author.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={editing ? `Edit ${author?.name}` : 'New author'}
      description="A name authority. Several books can be credited to the same author record."
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="author-form"
            variant="primary"
            busy={busy}
            busyLabel={editing ? 'Saving…' : 'Creating…'}
          >
            {editing ? 'Save changes' : 'Create author'}
          </Button>
        </>
      }
    >
      <form id="author-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <TextField
          label="Name"
          value={form.name}
          onChange={(value) => setForm((current) => ({ ...current, name: value }))}
          required
          error={errors.name}
        />
        <TextField
          label="Sort name"
          value={form.sortName}
          onChange={(value) => setForm((current) => ({ ...current, sortName: value }))}
          hint="The surname-first form used in citations and shelving. Blank keeps the name."
          error={errors.sortName}
        />
        <div className="form__row">
          <TextField
            label="Birth year"
            value={form.birthYear}
            onChange={(value) => setForm((current) => ({ ...current, birthYear: value }))}
            inputMode="numeric"
            min="0"
            max="9999"
            error={errors.birthYear}
          />
          <TextField
            label="Death year"
            value={form.deathYear}
            onChange={(value) => setForm((current) => ({ ...current, deathYear: value }))}
            inputMode="numeric"
            min="0"
            max="9999"
            error={errors.deathYear}
          />
        </div>
        <TextField
          label="Nationality"
          value={form.nationality}
          onChange={(value) => setForm((current) => ({ ...current, nationality: value }))}
          error={errors.nationality}
        />
        <TextAreaField
          label="Biography"
          value={form.biography}
          onChange={(value) => setForm((current) => ({ ...current, biography: value }))}
          rows={4}
          maxLength={4000}
          error={errors.biography}
        />
      </form>
    </Dialog>
  );
}

/* ── Category dialog ───────────────────────────────────────────────────────── */

function CategoryFormDialog({
  mode,
  category,
  parentCategories,
  onClose,
}: {
  mode: 'create' | 'edit';
  category?: CategoryDto;
  parentCategories: readonly CategoryDto[];
  onClose: () => void;
}): ReactNode {
  const { notify } = useToast();
  const editing = mode === 'edit' && category !== undefined;

  const [form, setForm] = useState({
    name: category?.name ?? '',
    description: category?.description ?? '',
    parentId: category?.parent?.id ?? '',
    position: category !== undefined ? String(category.position) : '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The parent picker never offers a category itself as its own parent.
  const parentOptions = parentCategories.filter((other) => other.id !== category?.id);

  const positionIsValid = (value: string): boolean =>
    value.trim() === '' || /^\d{1,5}$/.test(value.trim());

  function changedFields(): CategoryUpdateInput {
    if (!category) return {};
    const patch: CategoryUpdateInput = {};

    if (form.name.trim() !== category.name) patch.name = form.name.trim();

    const description = form.description.trim();
    if (description !== (category.description ?? '')) {
      patch.description = description === '' ? null : description;
    }

    const initialParent = category.parent?.id ?? '';
    if (form.parentId !== initialParent) {
      patch.parentId = form.parentId === '' ? null : form.parentId;
    }

    // Clearing the Order field means "leave it alone", not "reset to zero": the
    // schema requires a number when the field is present, and an explicit
    // `undefined` is illegal under exact optional property types.
    if (form.position.trim() !== '' && form.position !== String(category.position)) {
      patch.position = Number(form.position.trim());
    }

    return patch;
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!form.name.trim()) {
      setErrors({ name: 'Enter a name.' });
      return;
    }
    if (!positionIsValid(form.position)) {
      setErrors({ position: 'Order is a number up to 10000.' });
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    const optional = (value: string): string | undefined =>
      value.trim() ? value.trim() : undefined;

    const description = optional(form.description);
    const parentId = form.parentId.trim() ? form.parentId.trim() : undefined;
    const position = form.position.trim() ? Number(form.position.trim()) : undefined;

    try {
      if (editing && category) {
        const patch = changedFields();
        if (Object.keys(patch).length === 0) {
          notify('Nothing to save — no field was changed.', 'info');
          setBusy(false);
          return;
        }
        await updateCategory(category.id, patch);
        notify(`${category.name} updated`, 'success');
      } else {
        const input = {
          name: form.name.trim(),
          ...(description ? { description } : {}),
          ...(parentId !== undefined ? { parentId } : {}),
          ...(position !== undefined ? { position } : {}),
        };
        await createCategory(input);
        notify(`${input.name} created`, 'success');
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError(`Could not ${editing ? 'update' : 'create'} that category.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={editing ? `Edit ${category?.name}` : 'New category'}
      description="A subject in the catalogue's hierarchy, optionally under a parent."
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="category-form"
            variant="primary"
            busy={busy}
            busyLabel={editing ? 'Saving…' : 'Creating…'}
          >
            {editing ? 'Save changes' : 'Create category'}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <TextField
          label="Name"
          value={form.name}
          onChange={(value) => setForm((current) => ({ ...current, name: value }))}
          required
          error={errors.name}
        />
        <SelectField
          label="Parent category"
          value={form.parentId}
          onChange={(value) => setForm((current) => ({ ...current, parentId: value }))}
          options={[
            { value: '', label: 'None — a top-level category' },
            ...parentOptions.map((other) => ({ value: other.id, label: other.name })),
          ]}
          error={errors.parentId}
        />
        <div className="form__row">
          <TextField
            label="Order"
            value={form.position}
            onChange={(value) => setForm((current) => ({ ...current, position: value }))}
            inputMode="numeric"
            hint="Sorts siblings when shown together."
            error={errors.position}
          />
        </div>
        <TextAreaField
          label="Description"
          value={form.description}
          onChange={(value) => setForm((current) => ({ ...current, description: value }))}
          rows={3}
          maxLength={2000}
          error={errors.description}
        />
      </form>
    </Dialog>
  );
}
