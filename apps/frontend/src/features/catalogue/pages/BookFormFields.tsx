import { useId, type ReactNode } from 'react';
import { Card } from '../../../components/ui/Card';
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../../components/ui/Field';
import type { AuthorDto, BookDto, CategoryDto, PublisherDto } from '../api';

/**
 * The bibliographic form, shared by the create and edit book pages.
 *
 * The two pages differ only in what happens on submit (create always sends what
 * was typed; edit sends only what changed). The fields and the layout are the same
 * record, so duplicating them would fork the two copies the moment one gets a new
 * field.
 *
 * `mode` matters to one field only: the book DTO exposes the publisher as a *name*,
 * never as an id, so an edited record cannot be pointed back at a publisher select
 * without guessing. The field is therefore offered on create, where the id is the
 * whole point, and omitted on edit rather than left blank.
 */

export interface BookFormState {
  title: string;
  subtitle: string;
  description: string;
  summary: string;
  edition: string;
  language: string;
  isbn13: string;
  isbn10: string;
  publicationYear: string;
  publicationDate: string;
  pageCount: string;
  callNumber: string;
  coverImageUrl: string;
  publisherId: string;
  subjectsText: string;
  isReferenceOnly: boolean;
  authorIds: string[];
  categoryIds: string[];
  /** How many copies to accession in the active branch. The record cannot exist without one. */
  copies: string;
}

export function emptyBookForm(): BookFormState {
  return {
    title: '',
    subtitle: '',
    description: '',
    summary: '',
    edition: '',
    // The server defaults a missing language to `en`, so the form does too — a
    // librarian who skips the field should not be surprised by what an English
    // catalogue did with their blank.
    language: 'en',
    isbn13: '',
    isbn10: '',
    publicationYear: '',
    publicationDate: '',
    pageCount: '',
    callNumber: '',
    coverImageUrl: '',
    publisherId: '',
    subjectsText: '',
    isReferenceOnly: false,
    authorIds: [],
    categoryIds: [],
    copies: '',
  };
}

export function bookFormFromDto(book: BookDto): BookFormState {
  return {
    title: book.title,
    subtitle: book.subtitle ?? '',
    description: book.description ?? '',
    summary: book.summary ?? '',
    edition: book.edition ?? '',
    language: book.language ?? 'en',
    isbn13: book.isbn13 ?? '',
    isbn10: book.isbn10 ?? '',
    publicationYear: book.publicationYear !== null ? String(book.publicationYear) : '',
    publicationDate: book.publicationDate ? book.publicationDate.slice(0, 10) : '',
    pageCount: book.pageCount !== null ? String(book.pageCount) : '',
    callNumber: book.callNumber ?? '',
    coverImageUrl: book.coverImageUrl ?? '',
    publisherId: '',
    subjectsText: book.subjects.join('\n'),
    isReferenceOnly: book.isReferenceOnly,
    authorIds: book.authors.map((author) => author.id),
    categoryIds: book.categories.map((category) => category.id),
    copies: '',
  };
}

export function BookFormFields({
  mode,
  form,
  update,
  errors,
  authors,
  categories,
  publishers,
  optionLoading,
}: {
  mode: 'create' | 'edit';
  form: BookFormState;
  update: <K extends keyof BookFormState>(field: K, value: BookFormState[K]) => void;
  errors: Record<string, string>;
  authors: readonly AuthorDto[];
  categories: readonly CategoryDto[];
  publishers: readonly PublisherDto[];
  optionLoading: boolean;
}): ReactNode {
  const yearHint =
    mode === 'edit' ? 'A blank here clears the field on save.' : 'Leave blank if unknown.';

  return (
    <>
      <Card title="Title and identifiers">
        <TextField
          label="Title"
          value={form.title}
          onChange={(value) => update('title', value)}
          required
          error={errors.title}
        />

        <div className="form__row">
          <TextField
            label="ISBN-13"
            value={form.isbn13}
            onChange={(value) => update('isbn13', value)}
            hint="Spaces and dashes are stripped automatically. 10–17 characters."
            error={errors.isbn13}
          />
          <TextField
            label="ISBN-10"
            value={form.isbn10}
            onChange={(value) => update('isbn10', value)}
            hint="10–17 characters."
            error={errors.isbn10}
          />
        </div>

        <div className="form__row">
          <TextField
            label="Subtitle"
            value={form.subtitle}
            onChange={(value) => update('subtitle', value)}
            error={errors.subtitle}
          />
          <TextField
            label="Edition"
            value={form.edition}
            onChange={(value) => update('edition', value)}
            placeholder="e.g. 2nd ed."
            error={errors.edition}
          />
        </div>

        <div className="form__row">
          <TextField
            label="Publication year"
            type="number"
            value={form.publicationYear}
            onChange={(value) => update('publicationYear', value)}
            hint={yearHint}
            min="0"
            max="9999"
            error={errors.publicationYear}
          />
          <TextField
            label="Publication date"
            type="date"
            value={form.publicationDate}
            onChange={(value) => update('publicationDate', value)}
            hint="YYYY-MM-DD. Optional."
            error={errors.publicationDate}
          />
        </div>

        <div className="form__row">
          <TextField
            label="Pages"
            type="number"
            value={form.pageCount}
            onChange={(value) => update('pageCount', value)}
            min="1"
            max="20000"
            error={errors.pageCount}
          />
          <TextField
            label="Language"
            value={form.language}
            onChange={(value) => update('language', value)}
            hint="An ISO code or name, e.g. en, fr, Swahili."
            error={errors.language}
          />
        </div>

        <TextField
          label="Cover image URL"
          value={form.coverImageUrl}
          onChange={(value) => update('coverImageUrl', value)}
          hint="A publicly reachable image. Optional."
          error={errors.coverImageUrl}
        />
      </Card>

      {mode === 'create' && (
        <Card title="Publication">
          <SelectField
            label="Publisher"
            value={form.publisherId}
            onChange={(value) => update('publisherId', value)}
            options={[
              {
                value: '',
                label: optionLoading ? 'Loading publishers…' : 'No publisher recorded',
              },
              ...publishers.map((publisher) => ({ value: publisher.id, label: publisher.name })),
            ]}
            disabled={optionLoading}
            error={errors.publisherId}
          />
          <TextField
            label="Copies to add"
            type="number"
            value={form.copies}
            onChange={(value) => update('copies', value)}
            hint="How many copies to accession in the library's active branch. Required — a new record enters the catalogue with the copies it can be lent from."
            min="1"
            max="100"
            required
            error={errors.copies}
          />
        </Card>
      )}

      <Card title="Description">
        <TextAreaField
          label="Description"
          value={form.description}
          onChange={(value) => update('description', value)}
          rows={4}
          maxLength={4000}
          error={errors.description}
        />
        <TextAreaField
          label="Summary"
          value={form.summary}
          onChange={(value) => update('summary', value)}
          rows={3}
          maxLength={2000}
          hint="A short hook for catalogue search results."
          error={errors.summary}
        />
        <TextAreaField
          label="Subjects"
          value={form.subjectsText}
          onChange={(value) => update('subjectsText', value)}
          rows={3}
          hint="One subject per line. Free text — 'Data structures', 'Postcolonial fiction', and so on."
          error={errors.subjects}
        />
        <TextField
          label="Call number"
          value={form.callNumber}
          onChange={(value) => update('callNumber', value)}
          hint="e.g. QA76.73.J38 2021."
          error={errors.callNumber}
        />
      </Card>

      <Card title="Classification">
        <ChipField
          label="Authors"
          options={authors.map((author) => ({ value: author.id, label: author.name }))}
          selected={form.authorIds}
          onChange={(selected) => update('authorIds', selected)}
          loading={optionLoading}
          emptyText="No authors have been created yet."
          hint="Tap the names this record is credited to."
          required
          error={errors.authorIds}
        />
        <ChipField
          label="Categories"
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
          selected={form.categoryIds}
          onChange={(selected) => update('categoryIds', selected)}
          loading={optionLoading}
          emptyText="No categories have been created yet."
          hint="The first one you pick becomes the primary category."
          required
          error={errors.categoryIds}
        />
        <CheckboxField
          label="Reference only"
          checked={form.isReferenceOnly}
          onChange={(checked) => update('isReferenceOnly', checked)}
          hint="Reference-only titles are read in the library and never borrowed."
        />
      </Card>
    </>
  );
}

/**
 * A multi-select built from toggle chips.
 *
 * `aria-pressed` carries the state to a screen reader, and the selected chip gets
 * the accent treatment so the pressed state is visible as well as spoken. Buttons
 * rather than checkboxes because there is no room in a wall of authors for a
 * checkbox and its label on every line.
 */
function ChipField({
  label,
  options,
  selected,
  onChange,
  loading,
  emptyText,
  hint,
  required,
  error,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  loading: boolean;
  emptyText: string;
  hint: string;
  required?: boolean;
  error?: string | undefined;
}): ReactNode {
  const id = useId();

  function toggle(value: string): void {
    onChange(
      selected.includes(value) ? selected.filter((other) => other !== value) : [...selected, value],
    );
  }

  return (
    <div className="field">
      <span className="field__label" id={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="visually-hidden"> (required)</span>}
      </span>

      {options.length === 0 && !loading ? (
        <p className="field__hint">{emptyText}</p>
      ) : (
        <div className="chip-row field__chips" role="group" aria-labelledby={id}>
          {options.map((option) => {
            const on = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={on ? 'chip chip--on' : 'chip'}
                aria-pressed={on}
                onClick={() => toggle(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}
