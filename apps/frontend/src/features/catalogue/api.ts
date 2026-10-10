import type { CopyStatusDto } from '@lms/shared';
import type { Paginated } from '../../lib/api';
import { api } from '../../lib/api';

/**
 * The catalogue: books, copies, and the three reference lists they hang off.
 *
 * Declared here rather than imported from `@lms/shared`, matching
 * `features/members/api.ts`: the backend builds each DTO inline in
 * `catalogue.service.ts` and exposes no shared schema for it. These types are the
 * contract — when the backend grows Zod schemas, this file is what gets deleted.
 *
 * `type` rather than `interface` on every filter: TypeScript gives a type alias an
 * implicit index signature and an interface none, so an interface is not assignable
 * to the API client's query parameter type. An interface here fails to compile at
 * the call site, which is a confusing error for what is really a shape rule.
 */

export interface BookAuthorDto {
  id: string;
  name: string;
  sortName: string | null;
  role: string | null;
  position: number;
}

export interface BookCategoryDto {
  id: string;
  name: string;
  slug: string;
  isPrimary: boolean;
}

export interface BookTagDto {
  id: string;
  name: string;
  label: string | null;
}

/**
 * The copy roll-up the list endpoint returns per book.
 *
 * Counts rather than the copy rows themselves: a book with 40 copies must not make
 * the catalogue list response 40× larger, and the availability ratio is the only
 * thing a list view needs. The Copies tab fetches the rows.
 */
export interface BookCopySummary {
  total: number;
  available: number;
  onLoan: number;
}

export interface BookDto {
  id: string;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  edition: string | null;
  language: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
  pageCount: number | null;
  publisher: string | null;
  coverImageUrl: string | null;
  callNumber: string | null;
  subjects: string[];
  summary: string | null;
  isReferenceOnly: boolean;
  archivedAt: string | null;
  authors: BookAuthorDto[];
  categories: BookCategoryDto[];
  tags: BookTagDto[];
  copies: BookCopySummary;
  createdAt: string;
  updatedAt: string;
}

export interface CopyDto {
  id: string;
  accessionNumber: string;
  barcode: string | null;
  qrToken: string | null;
  bookId: string;
  book: { id: string; title: string; isbn13: string | null; isbn10: string | null };
  branchId: string;
  branch: { id: string; code: string; name: string };
  locationId: string | null;
  location: { id: string; name: string } | null;
  shelfId: string | null;
  shelf: { id: string; code: string } | null;
  condition: string;
  status: CopyStatusDto;
  acquisitionDate: string | null;
  acquisitionSource: string | null;
  purchasePrice: string | null;
  replacementCost: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorDto {
  id: string;
  name: string;
  sortName: string | null;
  biography: string | null;
  nationality: string | null;
  birthYear: number | null;
  deathYear: number | null;
}

export interface PublisherDto {
  id: string;
  name: string;
  imprint: string | null;
  country: string | null;
  website: string | null;
  email: string | null;
}

/**
 * The parent relation, as the API actually sends it.
 *
 * This was declared `string | null`, which was a straight lie: `CATEGORY_SELECT`
 * in `catalogue.service.ts` selects `parent: { id, name, slug }`, and
 * `toCategoryDto` passes that object through untouched. Because the declared type
 * said string, TypeScript happily accepted `{`Under ${category.parent}`}` — so the
 * object reached React as a child and the whole page threw
 * "Objects are not valid as a React child".
 *
 * Keep this in step with the backend `select`. A hand-written DTO that disagrees
 * with the payload does not fail loudly; it fails at render time, in production.
 */
export interface CategoryParentDto {
  id: string;
  name: string;
  slug: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  isActive: boolean;
  parent: CategoryParentDto | null;
  createdAt: string;
  updatedAt: string;
}

export type BookFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  q?: string;
  branchId?: string;
  authorId?: string;
  categoryId?: string;
  tagId?: string;
  availableOnly?: boolean;
  includeArchived?: boolean;
};

export type CopyFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  branchId?: string;
  bookId?: string;
  status?: CopyStatusDto;
  condition?: string;
};

export type SimpleListFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  q?: string;
};

/* ── Books ─────────────────────────────────────────────────────────────────── */

export function listBooks(filters: BookFilters, signal?: AbortSignal): Promise<Paginated<BookDto>> {
  return api.get<BookDto[]>('/books', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<BookDto>>;
}

export function getBook(id: string, signal?: AbortSignal) {
  return api.get<{ book: BookDto }>(`/books/${id}`, signal ? { signal } : {});
}

/* ── Book writes ──────────────────────────────────────────────────────────────
 * Optional text fields are omitted rather than sent empty: the server's
 * `bookCreateSchema` accepts `null` or an empty string for most of them, but the
 * UI forms follow the members' convention of sending only what was typed.
 */

export interface BookCreateInput {
  title: string;
  subtitle?: string;
  description?: string;
  edition?: string;
  language?: string;
  publicationYear?: number;
  publicationDate?: string;
  pageCount?: number;
  publisherId?: string;
  coverImageUrl?: string;
  callNumber?: string;
  subjects?: string[];
  summary?: string;
  isReferenceOnly?: boolean;
  isbn10?: string;
  isbn13?: string;
  authorIds?: string[];
  categoryIds?: string[];
  tagIds?: string[];
  /** Copies to accession in the library's active branch at the same time as the record. */
  copies?: number;
}

export interface BookUpdateInput {
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  edition?: string | null;
  language?: string;
  publicationYear?: number | null;
  publicationDate?: string | null;
  pageCount?: number | null;
  publisherId?: string | null;
  coverImageUrl?: string | null;
  callNumber?: string | null;
  subjects?: string[];
  summary?: string | null;
  isReferenceOnly?: boolean;
  isbn10?: string | null;
  isbn13?: string | null;
  authorIds?: string[];
  categoryIds?: string[];
}

export function createBook(input: BookCreateInput) {
  return api.post<{ book: BookDto }>('/books', input);
}

export function updateBook(id: string, input: BookUpdateInput) {
  return api.patch<{ book: BookDto }>(`/books/${id}`, input);
}

/** Retires a title: record, copies and loan history are retained for audit. */
export function archiveBook(id: string) {
  return api.delete(`/books/${id}`, { query: { action: 'archive' } });
}

/**
 * Physically removes the record and its copies.
 *
 * The server refuses (409) while copies, loans, reservations, borrow requests or
 * digital resources still reference the book — withdraw it instead, which keeps
 * the history. Nothing except an administrator may do this.
 */
export function deleteBook(id: string) {
  return api.delete(`/books/${id}`, { query: { action: 'delete' } });
}

/* ── Copies ────────────────────────────────────────────────────────────────── */

export function listCopies(
  filters: CopyFilters,
  signal?: AbortSignal,
): Promise<Paginated<CopyDto>> {
  return api.get<CopyDto[]>('/copies', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<CopyDto>>;
}

/* ── Reference lists ───────────────────────────────────────────────────────── */

export function listAuthors(
  filters: SimpleListFilters,
  signal?: AbortSignal,
): Promise<Paginated<AuthorDto>> {
  return api.get<AuthorDto[]>('/authors', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<AuthorDto>>;
}

export function listPublishers(
  filters: SimpleListFilters,
  signal?: AbortSignal,
): Promise<Paginated<PublisherDto>> {
  return api.get<PublisherDto[]>('/publishers', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<PublisherDto>>;
}

export function listCategories(
  filters: SimpleListFilters,
  signal?: AbortSignal,
): Promise<Paginated<CategoryDto>> {
  return api.get<CategoryDto[]>('/categories', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<CategoryDto>>;
}

/* ── Reference-list writes ─────────────────────────────────────────────────── */

export interface AuthorCreateInput {
  name: string;
  sortName?: string;
  biography?: string;
  nationality?: string;
  birthYear?: number;
  deathYear?: number;
}

export interface AuthorUpdateInput {
  name?: string;
  sortName?: string | null;
  biography?: string | null;
  nationality?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
}

export interface CategoryCreateInput {
  name: string;
  description?: string;
  parentId?: string;
  position?: number;
}

export interface CategoryUpdateInput {
  name?: string;
  description?: string | null;
  parentId?: string | null;
  position?: number;
}

export function createAuthor(input: AuthorCreateInput) {
  return api.post<{ author: AuthorDto }>('/authors', input);
}

export function updateAuthor(id: string, input: AuthorUpdateInput) {
  return api.patch<{ author: AuthorDto }>(`/authors/${id}`, input);
}

export function deleteAuthor(id: string) {
  return api.delete(`/authors/${id}`);
}

export function createCategory(input: CategoryCreateInput) {
  return api.post<{ category: CategoryDto }>('/categories', input);
}

export function updateCategory(id: string, input: CategoryUpdateInput) {
  return api.patch<{ category: CategoryDto }>(`/categories/${id}`, input);
}

export function deleteCategory(id: string) {
  return api.delete(`/categories/${id}`);
}

/** Filters, shown above the books table. Empty until the caller holds the view permission. */
export const COPY_STATUS_FILTERS: readonly { value: CopyStatusDto; label: string }[] = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'BORROWED', label: 'On loan' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'LOST', label: 'Lost' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'MAINTENANCE', label: 'In maintenance' },
  { value: 'REMOVED', label: 'Removed' },
];

export const COPY_STATUS_LABELS: Record<CopyStatusDto, string> = {
  AVAILABLE: 'Available',
  BORROWED: 'On loan',
  RESERVED: 'Reserved',
  LOST: 'Lost',
  DAMAGED: 'Damaged',
  MAINTENANCE: 'In maintenance',
  REMOVED: 'Removed',
};
