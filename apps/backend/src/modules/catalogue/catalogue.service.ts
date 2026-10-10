import type { CopyCondition, CopyStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma, withTransaction } from '../../config/database.js';
import { SORTABLE_FIELDS } from '../../config/constants.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { publishRealtime } from '../../lib/events.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';
import {
  canonicalIsbn13,
  isValidIsbn10,
  isValidIsbn13,
  isbn13To10,
  isbnsAgree,
  normalizeIsbn,
} from '../../lib/isbn.js';
import { orderBy, skipTake, type PaginationQuery } from '../../lib/pagination.js';
import { assertRequestedBranchAllowed, branchScopeFilter } from '../../middleware/scope.js';
import type { AuthPrincipal } from '@lms/shared';

/** Announces a catalogue change so every connected client refetches. */
function announce(action: string, entityId?: string): void {
  publishRealtime({
    channel: 'catalogue',
    action,
    entityId,
    occurredAt: new Date().toISOString(),
  });
}

/**
 * The copy subset that belongs to the SHARED catalogue for this principal.
 *
 * Two rules compose here:
 *   • `branch.isActive: true` — stock at a deactivated branch is not part of the
 *     live library. Applying it for EVERYONE (a null `branchScope` included)
 *     keeps the admin's totals identical to a branch-scoped librarian's.
 *   • the principal's branch scope, when it is scoped.
 */
function inScopeCopiesFilter(principal: AuthPrincipal): Prisma.BookCopyWhereInput {
  return principal.branchScope === null
    ? { branch: { isActive: true } }
    : { branchId: { in: [...principal.branchScope] }, branch: { isActive: true } };
}

/**
 * A book is visible when it has a copy in the shared catalogue OR no copies at
 * all. A title that only holds stock at an inactive branch, and a title that has
 * never been accessioned, are both real catalogue records — hiding them from a
 * scoped librarian while an admin sees them is exactly the inconsistency this
 * makes impossible.
 */
function bookVisibilityFilter(principal: AuthPrincipal): Prisma.BookWhereInput {
  return {
    OR: [
      { copies: { some: inScopeCopiesFilter(principal) } },
      { copies: { none: {} } },
    ],
  };
}

/**
 * Resolves the branch freshly-created copies are placed at.
 *
 * Scoped staff use their first branch; a branch-scope-less creator (an admin
 * with `BRANCH_MANAGE_ALL`) uses the single active branch of their library,
 * which is the shared Main Branch. The client never supplies the branch — in a
 * single-branch library there is exactly one answer.
 */
async function resolveCopyCreationBranchId(principal: AuthPrincipal): Promise<string> {
  if (principal.branchScope !== null && principal.branchScope.length > 0) {
    const branchId = principal.branchScope[0];
    if (branchId) return branchId;
  }

  const branch = await prisma.branch.findFirst({
    where: {
      ...(principal.libraryScope ? { libraryId: principal.libraryScope } : {}),
      isActive: true,
    },
    select: { id: true },
  });
  if (!branch) throw badRequest('No active branch is available to place copies in');
  return branch.id;
}

const AUTHOR_SELECT = {
  id: true,
  name: true,
  sortName: true,
  biography: true,
  nationality: true,
  birthYear: true,
  deathYear: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AuthorSelect;

const PUBLISHER_SELECT = {
  id: true,
  name: true,
  imprint: true,
  country: true,
  website: true,
  email: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PublisherSelect;

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  position: true,
  isActive: true,
  parent: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

const TAG_SELECT = {
  id: true,
  name: true,
  label: true,
} satisfies Prisma.TagSelect;

const BOOK_SELECT = {
  id: true,
  isbn13: true,
  isbn10: true,
  title: true,
  subtitle: true,
  description: true,
  edition: true,
  language: true,
  publicationYear: true,
  publicationDate: true,
  pageCount: true,
  coverImageUrl: true,
  callNumber: true,
  subjects: true,
  summary: true,
  isReferenceOnly: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  publisher: { select: { id: true, name: true, country: true } },
  authors: {
    select: {
      position: true,
      role: true,
      author: { select: { id: true, name: true, sortName: true } },
    },
  },
  categories: {
    select: {
      isPrimary: true,
      category: { select: { id: true, name: true, slug: true } },
    },
  },
  tags: {
    select: {
      tag: { select: { id: true, name: true, label: true } },
    },
  },
} satisfies Prisma.BookSelect;

const COPY_SELECT = {
  id: true,
  accessionNumber: true,
  barcode: true,
  qrToken: true,
  bookId: true,
  branchId: true,
  locationId: true,
  shelfId: true,
  condition: true,
  status: true,
  acquisitionDate: true,
  acquisitionSource: true,
  purchasePrice: true,
  replacementCost: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  book: {
    select: {
      id: true,
      title: true,
      isbn13: true,
      isbn10: true,
    },
  },
  branch: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, code: true, name: true } },
  shelf: { select: { id: true, code: true } },
} satisfies Prisma.BookCopySelect;

function ensureBookIsbnPair(
  isbn10?: string | null,
  isbn13?: string | null,
): {
  isbn10?: string;
  isbn13?: string;
} {
  const raw10 = isbn10 ? normalizeIsbn(isbn10) : undefined;
  const raw13 = isbn13 ? normalizeIsbn(isbn13) : undefined;

  if (raw10 && !isValidIsbn10(raw10)) {
    throw badRequest('ISBN-10 is not valid');
  }
  if (raw13 && !isValidIsbn13(raw13)) {
    throw badRequest('ISBN-13 is not valid');
  }
  if (raw10 && raw13 && !isbnsAgree(raw10, raw13)) {
    throw badRequest('The supplied ISBN values do not match the same edition');
  }

  const final13 = raw13 ?? (raw10 ? (canonicalIsbn13(raw10) ?? undefined) : undefined);
  const final10 = raw10 ?? (final13 ? (isbn13To10(final13) ?? undefined) : undefined);

  return { isbn10: final10, isbn13: final13 };
}

function generateToken(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex').slice(0, 12)}`.slice(0, 64);
}

/** Presentation-normalised form used to detect same-title duplicates. */
function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Refuses a second catalogue record for the same physical title.
 *
 * Two rules, both required by the product spec:
 *
 *   • A supplied ISBN-13 is unique database-wide (`books.isbn13 @unique`). It is
 *     checked here up front so the caller sees the readable
 *     "A book with this ISBN-13 already exists." rather than a raw constraint
 *     error, and reinforced by P2002 handling around the create for the race
 *     between the check and the insert.
 *
 *   • Books without an ISBN are matched on TITLE + AUTHORS + PUBLICATION YEAR.
 *     That triple is the guard spec wants: a librarian pasting the same record
 *     twice is caught, while a genuinely different edition (year differs) or a
 *     different author's book with the same title is let through.
 */
async function assertNoDuplicateBook(
  input: {
    isbn13?: string | null;
    title: string;
    publicationYear?: number | null;
    authorIds?: (string | null)[] | null;
  },
  excludeId?: string,
): Promise<void> {
  const isbn = input.isbn13 ? normalizeIsbn(input.isbn13) : null;
  if (isbn) {
    const existing = await prisma.book.findUnique({
      where: { isbn13: isbn },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw conflict('BOOK_ISBN13_DUPLICATE', 'A book with this ISBN-13 already exists.');
    }
    return;
  }

  if (!input.title || input.publicationYear === undefined || input.publicationYear === null) {
    return;
  }
  const authorIds = (input.authorIds ?? []).filter((id): id is string => Boolean(id));
  if (authorIds.length === 0) return;

  const normalized = normalizeTitle(input.title);
  const wanted = new Set(authorIds);
  const candidates = await prisma.book.findMany({
    where: {
      isbn13: null,
      publicationYear: input.publicationYear,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, title: true, authors: { select: { authorId: true } } },
  });

  const match = candidates.find(
    (candidate) =>
      normalizeTitle(candidate.title) === normalized &&
      candidate.authors.length === wanted.size &&
      candidate.authors.every(({ authorId }) => wanted.has(authorId)),
  );

  if (match) {
    throw conflict(
      'BOOK_DUPLICATE',
      'A book with this title, author(s) and publication year already exists',
      { duplicateBookId: match.id },
    );
  }
}

/** True when a Prisma error is the `books.isbn13` uniqueness race. */
function isIsbn13UniqueConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) && target.includes('isbn13');
}

export function toAuthorDto(author: Prisma.AuthorGetPayload<{ select: typeof AUTHOR_SELECT }>) {
  return {
    id: author.id,
    name: author.name,
    sortName: author.sortName,
    biography: author.biography,
    nationality: author.nationality,
    birthYear: author.birthYear,
    deathYear: author.deathYear,
    createdAt: author.createdAt.toISOString(),
    updatedAt: author.updatedAt.toISOString(),
  };
}

export function toPublisherDto(
  publisher: Prisma.PublisherGetPayload<{ select: typeof PUBLISHER_SELECT }>,
) {
  return {
    id: publisher.id,
    name: publisher.name,
    imprint: publisher.imprint,
    country: publisher.country,
    website: publisher.website,
    email: publisher.email,
    createdAt: publisher.createdAt.toISOString(),
    updatedAt: publisher.updatedAt.toISOString(),
  };
}

export function toCategoryDto(
  category: Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>,
) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    position: category.position,
    isActive: category.isActive,
    parent: category.parent,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function toTagDto(tag: Prisma.TagGetPayload<{ select: typeof TAG_SELECT }>) {
  return {
    id: tag.id,
    name: tag.name,
    label: tag.label,
  };
}

export interface BookCopySummaryDto {
  total: number;
  available: number;
  onLoan: number;
}

/**
 * The copy roll-up a book response carries.
 *
 * `copies` is a SUMMARY `{ total, available, onLoan }`, never the rows
 * themselves: a title with 40 copies must not make the catalogue list response
 * 40x larger, and the per-status breakdown lives on the separate `GET /copies`
 * endpoint. The counts are computed HERE, server-side, over the principal's
 * branch scope AND active branches only — an inactive branch's stock is not part
 * of the shared catalogue a librarian or member sees, so every role renders the
 * same availability for the same title.
 */
export async function bookCopySummaries(
  principal: AuthPrincipal,
  bookIds: readonly string[],
): Promise<Map<string, BookCopySummaryDto>> {
  const summaries = new Map<string, BookCopySummaryDto>();
  if (bookIds.length === 0) return summaries;

  const where: Prisma.BookCopyWhereInput = {
    bookId: { in: [...bookIds] },
    branch: { isActive: true },
  };
  if (principal.branchScope !== null) {
    where.branchId = { in: [...principal.branchScope] };
  }

  const rows = await prisma.bookCopy.groupBy({
    by: ['bookId', 'status'],
    where,
    _count: { _all: true },
  });

  for (const bookId of bookIds) {
    summaries.set(bookId, { total: 0, available: 0, onLoan: 0 });
  }
  for (const row of rows) {
    const summary = summaries.get(row.bookId) ?? { total: 0, available: 0, onLoan: 0 };
    summary.total += row._count._all;
    if (row.status === 'AVAILABLE') summary.available += row._count._all;
    if (row.status === 'BORROWED') summary.onLoan += row._count._all;
    summaries.set(row.bookId, summary);
  }

  return summaries;
}

export function toBookDto(
  book: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>,
  copies: BookCopySummaryDto,
) {
  return {
    id: book.id,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    title: book.title,
    subtitle: book.subtitle,
    description: book.description,
    edition: book.edition,
    language: book.language,
    publicationYear: book.publicationYear,
    publicationDate: book.publicationDate?.toISOString().slice(0, 10) ?? null,
    pageCount: book.pageCount,
    publisher: book.publisher,
    coverImageUrl: book.coverImageUrl,
    callNumber: book.callNumber,
    subjects: book.subjects,
    summary: book.summary,
    isReferenceOnly: book.isReferenceOnly,
    archivedAt: book.archivedAt?.toISOString() ?? null,
    authors: book.authors.map(({ author, position, role }) => ({
      id: author.id,
      name: author.name,
      sortName: author.sortName,
      role,
      position,
    })),
    categories: book.categories.map(({ category, isPrimary }) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      isPrimary,
    })),
    tags: book.tags.map(({ tag }) => ({
      id: tag.id,
      name: tag.name,
      label: tag.label,
    })),
    copies: {
      total: copies.total,
      available: copies.available,
      onLoan: copies.onLoan,
    },
    createdAt: book.createdAt.toISOString(),
    updatedAt: book.updatedAt.toISOString(),
  };
}

export function toCopyDto(copy: Prisma.BookCopyGetPayload<{ select: typeof COPY_SELECT }>) {
  return {
    id: copy.id,
    accessionNumber: copy.accessionNumber,
    barcode: copy.barcode,
    qrToken: copy.qrToken,
    bookId: copy.bookId,
    book: copy.book,
    branchId: copy.branchId,
    branch: copy.branch,
    locationId: copy.locationId,
    location: copy.location,
    shelfId: copy.shelfId,
    shelf: copy.shelf,
    condition: copy.condition,
    status: copy.status,
    acquisitionDate: copy.acquisitionDate?.toISOString().slice(0, 10) ?? null,
    acquisitionSource: copy.acquisitionSource,
    purchasePrice: copy.purchasePrice?.toString() ?? null,
    replacementCost: copy.replacementCost?.toString() ?? null,
    notes: copy.notes,
    createdAt: copy.createdAt.toISOString(),
    updatedAt: copy.updatedAt.toISOString(),
  };
}

export async function listAuthors(
  _principal: AuthPrincipal,
  filters: { q?: string; pagination: PaginationQuery; sort?: string; direction?: 'asc' | 'desc' },
): Promise<{
  authors: Prisma.AuthorGetPayload<{ select: typeof AUTHOR_SELECT }>[];
  total: number;
}> {
  const where: Prisma.AuthorWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { sortName: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const order = orderBy(
    (['name', 'sortName', 'createdAt'] as const).filter((field) =>
      filters.sort ? (SORTABLE_FIELDS.author as readonly string[]).includes(field) : true,
    ),
    filters.direction ?? 'asc',
    SORTABLE_FIELDS.author,
  );

  const [authors, total] = await Promise.all([
    prisma.author.findMany({
      where,
      select: AUTHOR_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.author.count({ where }),
  ]);

  return { authors, total };
}

export async function getAuthor(
  id: string,
): Promise<Prisma.AuthorGetPayload<{ select: typeof AUTHOR_SELECT }>> {
  const author = await prisma.author.findUnique({ where: { id }, select: AUTHOR_SELECT });
  if (!author) throw notFound('Author');
  return author;
}

export async function createAuthor(input: {
  name: string;
  sortName?: string;
  biography?: string | null;
  nationality?: string | null;
  birthYear?: number;
  deathYear?: number;
}): Promise<Prisma.AuthorGetPayload<{ select: typeof AUTHOR_SELECT }>> {
  const author = await prisma.author.create({
    data: {
      name: input.name,
      sortName: input.sortName ?? input.name,
      biography: input.biography ?? null,
      nationality: input.nationality ?? null,
      birthYear: input.birthYear ?? null,
      deathYear: input.deathYear ?? null,
    },
    select: AUTHOR_SELECT,
  });
  announce('Author.created', author.id);
  return author;
}

export async function updateAuthor(
  id: string,
  input: {
    name?: string;
    sortName?: string;
    biography?: string | null;
    nationality?: string | null;
    birthYear?: number;
    deathYear?: number;
  },
): Promise<Prisma.AuthorGetPayload<{ select: typeof AUTHOR_SELECT }>> {
  const existing = await prisma.author.findUnique({ where: { id } });
  if (!existing) throw notFound('Author');

  const author = await prisma.author.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.sortName !== undefined ? { sortName: input.sortName } : {}),
      ...(input.biography !== undefined ? { biography: input.biography } : {}),
      ...(input.nationality !== undefined ? { nationality: input.nationality } : {}),
      ...(input.birthYear !== undefined ? { birthYear: input.birthYear } : {}),
      ...(input.deathYear !== undefined ? { deathYear: input.deathYear } : {}),
    },
    select: AUTHOR_SELECT,
  });
  announce('Author.updated', author.id);
  return author;
}

export async function deleteAuthor(id: string): Promise<void> {
  const author = await prisma.author.findUnique({ where: { id }, select: { id: true } });
  if (!author) throw notFound('Author');

  await prisma.author.delete({ where: { id } });
  announce('Author.deleted', id);
}

export async function listPublishers(
  _principal: AuthPrincipal,
  filters: { q?: string; pagination: PaginationQuery; sort?: string; direction?: 'asc' | 'desc' },
): Promise<{
  publishers: Prisma.PublisherGetPayload<{ select: typeof PUBLISHER_SELECT }>[];
  total: number;
}> {
  const where: Prisma.PublisherWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { imprint: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const order = orderBy(
    (['name', 'createdAt'] as const).filter((field) =>
      filters.sort ? (SORTABLE_FIELDS.publisher as readonly string[]).includes(field) : true,
    ),
    filters.direction ?? 'asc',
    SORTABLE_FIELDS.publisher,
  );

  const [publishers, total] = await Promise.all([
    prisma.publisher.findMany({
      where,
      select: PUBLISHER_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.publisher.count({ where }),
  ]);

  return { publishers, total };
}

export async function getPublisher(
  id: string,
): Promise<Prisma.PublisherGetPayload<{ select: typeof PUBLISHER_SELECT }>> {
  const publisher = await prisma.publisher.findUnique({ where: { id }, select: PUBLISHER_SELECT });
  if (!publisher) throw notFound('Publisher');
  return publisher;
}

export async function createPublisher(input: {
  name: string;
  imprint?: string | null;
  country?: string | null;
  website?: string | null;
  email?: string | null;
}): Promise<Prisma.PublisherGetPayload<{ select: typeof PUBLISHER_SELECT }>> {
  const publisher = await prisma.publisher.create({
    data: {
      name: input.name,
      imprint: input.imprint ?? null,
      country: input.country ?? null,
      website: input.website ?? null,
      email: input.email ?? null,
    },
    select: PUBLISHER_SELECT,
  });
  announce('Publisher.created', publisher.id);
  return publisher;
}

export async function updatePublisher(
  id: string,
  input: {
    name?: string;
    imprint?: string | null;
    country?: string | null;
    website?: string | null;
    email?: string | null;
  },
): Promise<Prisma.PublisherGetPayload<{ select: typeof PUBLISHER_SELECT }>> {
  const existing = await prisma.publisher.findUnique({ where: { id } });
  if (!existing) throw notFound('Publisher');

  const publisher = await prisma.publisher.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.imprint !== undefined ? { imprint: input.imprint } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
    },
    select: PUBLISHER_SELECT,
  });
  announce('Publisher.updated', publisher.id);
  return publisher;
}

export async function deletePublisher(id: string): Promise<void> {
  const publisher = await prisma.publisher.findUnique({ where: { id }, select: { id: true } });
  if (!publisher) throw notFound('Publisher');
  await prisma.publisher.delete({ where: { id } });
  announce('Publisher.deleted', id);
}

export async function listCategories(
  _principal: AuthPrincipal,
  filters: { q?: string; pagination: PaginationQuery; sort?: string; direction?: 'asc' | 'desc' },
): Promise<{
  categories: Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>[];
  total: number;
}> {
  const where: Prisma.CategoryWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { description: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const order = orderBy(
    (['name', 'position', 'createdAt'] as const).filter((field) =>
      filters.sort ? (SORTABLE_FIELDS.category as readonly string[]).includes(field) : true,
    ),
    filters.direction ?? 'asc',
    SORTABLE_FIELDS.category,
  );

  const [categories, total] = await Promise.all([
    prisma.category.findMany({
      where,
      select: CATEGORY_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.category.count({ where }),
  ]);

  return { categories, total };
}

export async function getCategory(
  id: string,
): Promise<Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>> {
  const category = await prisma.category.findUnique({ where: { id }, select: CATEGORY_SELECT });
  if (!category) throw notFound('Category');
  return category;
}

export async function createCategory(input: {
  name: string;
  description?: string | null;
  parentId?: string | null;
  position?: number;
}): Promise<Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>> {
  const category = await prisma.category.create({
    data: {
      name: input.name,
      slug:
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'category',
      description: input.description ?? null,
      parentId: input.parentId ?? null,
      position: input.position ?? 0,
    },
    select: CATEGORY_SELECT,
  });
  announce('Category.created', category.id);
  return category;
}

export async function updateCategory(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    parentId?: string | null;
    position?: number;
  },
): Promise<Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>> {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw notFound('Category');

  const category = await prisma.category.update({
    where: { id },
    data: {
      ...(input.name !== undefined
        ? {
            name: input.name,
            slug:
              input.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '') || 'category',
          }
        : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    },
    select: CATEGORY_SELECT,
  });
  announce('Category.updated', category.id);
  return category;
}

export async function deleteCategory(id: string): Promise<void> {
  const category = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!category) throw notFound('Category');
  await prisma.category.delete({ where: { id } });
  announce('Category.deleted', id);
}

export async function listTags(
  _principal: AuthPrincipal,
  filters: { q?: string; pagination: PaginationQuery; sort?: string; direction?: 'asc' | 'desc' },
): Promise<{ tags: Prisma.TagGetPayload<{ select: typeof TAG_SELECT }>[]; total: number }> {
  const where: Prisma.TagWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { label: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const order = orderBy(
    (['name', 'createdAt'] as const).filter((field) =>
      filters.sort ? (SORTABLE_FIELDS.category as readonly string[]).includes(field) : true,
    ),
    filters.direction ?? 'asc',
    SORTABLE_FIELDS.category,
  );

  const [tags, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      select: TAG_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.tag.count({ where }),
  ]);

  return { tags, total };
}

export async function getTag(
  id: string,
): Promise<Prisma.TagGetPayload<{ select: typeof TAG_SELECT }>> {
  const tag = await prisma.tag.findUnique({ where: { id }, select: TAG_SELECT });
  if (!tag) throw notFound('Tag');
  return tag;
}

export async function createTag(input: {
  name: string;
  label?: string | null;
}): Promise<Prisma.TagGetPayload<{ select: typeof TAG_SELECT }>> {
  const tag = await prisma.tag.create({
    data: { name: input.name, label: input.label ?? null },
    select: TAG_SELECT,
  });
  announce('Tag.created', tag.id);
  return tag;
}

export async function updateTag(
  id: string,
  input: { name?: string; label?: string | null },
): Promise<Prisma.TagGetPayload<{ select: typeof TAG_SELECT }>> {
  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) throw notFound('Tag');

  const tag = await prisma.tag.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
    },
    select: TAG_SELECT,
  });
  announce('Tag.updated', tag.id);
  return tag;
}

export async function deleteTag(id: string): Promise<void> {
  const tag = await prisma.tag.findUnique({ where: { id }, select: { id: true } });
  if (!tag) throw notFound('Tag');
  await prisma.tag.delete({ where: { id } });
  announce('Tag.deleted', id);
}

export async function listBooks(
  principal: AuthPrincipal,
  filters: {
    q?: string;
    branchId?: string;
    authorId?: string;
    categoryId?: string;
    tagId?: string;
    availableOnly?: boolean;
    includeArchived?: boolean;
    pagination: PaginationQuery;
    sort?: string;
    direction?: 'asc' | 'desc';
  },
): Promise<{
  books: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>[];
  total: number;
  copySummaries: Map<string, BookCopySummaryDto>;
}> {
  const where: Prisma.BookWhereInput = {
    ...(filters.includeArchived ? {} : { archivedAt: null }),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: 'insensitive' } },
            { isbn13: { contains: filters.q, mode: 'insensitive' } },
            { isbn10: { contains: filters.q, mode: 'insensitive' } },
            { description: { contains: filters.q, mode: 'insensitive' } },
            {
              authors: { some: { author: { name: { contains: filters.q, mode: 'insensitive' } } } },
            },
          ],
        }
      : {}),
  };

  const andClauses: Prisma.BookWhereInput[] = [];

  andClauses.push(bookVisibilityFilter(principal));
  if (filters.branchId) {
    assertRequestedBranchAllowed(principal, filters.branchId);
    andClauses.push({ copies: { some: { branchId: filters.branchId, branch: { isActive: true } } } });
  }
  if (filters.authorId) {
    andClauses.push({ authors: { some: { authorId: filters.authorId } } });
  }
  if (filters.categoryId) {
    andClauses.push({ categories: { some: { categoryId: filters.categoryId } } });
  }
  if (filters.tagId) {
    andClauses.push({ tags: { some: { tagId: filters.tagId } } });
  }
  if (filters.availableOnly) {
    andClauses.push({ copies: { some: { status: 'AVAILABLE', branch: { isActive: true } } } });
  }

  if (andClauses.length > 0) {
    where.AND = andClauses;
  }

  const order = orderBy(
    (['title', 'publicationYear', 'createdAt', 'updatedAt'] as const).filter((field) =>
      filters.sort ? (SORTABLE_FIELDS.book as readonly string[]).includes(field) : true,
    ),
    filters.direction ?? 'asc',
    SORTABLE_FIELDS.book,
  );

  const [books, total] = await Promise.all([
    prisma.book.findMany({
      where,
      select: BOOK_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.book.count({ where }),
  ]);

  const copySummaries = await bookCopySummaries(
    principal,
    books.map((book) => book.id),
  );

  return { books, total, copySummaries };
}

export async function getBook(
  principal: AuthPrincipal,
  id: string,
): Promise<{
  book: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>;
  summary: BookCopySummaryDto;
}> {
  const book = await prisma.book.findFirst({
    where: {
      id,
      ...bookVisibilityFilter(principal),
    },
    select: BOOK_SELECT,
  });

  if (!book) throw notFound('Book');

  const summary = (await bookCopySummaries(principal, [book.id])).get(book.id) ?? {
    total: 0,
    available: 0,
    onLoan: 0,
  };
  return { book, summary };
}

export async function createBook(
  principal: AuthPrincipal,
  input: {
    isbn10?: string | null;
    isbn13?: string | null;
    title: string;
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
    subjects?: string[] | null;
    summary?: string | null;
    isReferenceOnly?: boolean;
    authorIds?: string[] | null;
    categoryIds?: string[] | null;
    tagIds?: string[] | null;
    /** Copies accessioned in the shared active branch at the same time as the record. */
    copies?: number | null;
  },
): Promise<{
  book: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>;
  summary: BookCopySummaryDto;
}> {
  const isbn = ensureBookIsbnPair(input.isbn10, input.isbn13);

  if (!input.authorIds || input.authorIds.length === 0) {
    throw badRequest('Provide at least one author');
  }
  if (!input.categoryIds || input.categoryIds.length === 0) {
    throw badRequest('Assign the book to at least one category');
  }
  if ((input.copies ?? 0) < 1) {
    throw badRequest('Provide at least one copy');
  }

  // Duplicate guard checked BEFORE the transaction so the common rejection path
  // reads naturally; the P2002 catch below handles the check→write race.
  await assertNoDuplicateBook({
    isbn13: isbn.isbn13 ?? null,
    title: input.title,
    publicationYear: input.publicationYear,
    authorIds: input.authorIds,
  });

  const copyCount = input.copies ?? 0;
  const copyBranchId = copyCount > 0 ? await resolveCopyCreationBranchId(principal) : null;

  let created: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>;
  try {
    created = await withTransaction(async (tx) => {
    const data: Prisma.BookCreateInput = {
      isbn10: isbn.isbn10 ?? null,
      isbn13: isbn.isbn13 ?? null,
      title: input.title,
      subtitle: input.subtitle ?? null,
      description: input.description ?? null,
      edition: input.edition ?? null,
      language: input.language ?? 'en',
      publicationYear: input.publicationYear ?? null,
      publicationDate: input.publicationDate
        ? new Date(`${input.publicationDate}T00:00:00.000Z`)
        : null,
      pageCount: input.pageCount ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      callNumber: input.callNumber ?? null,
      subjects: input.subjects ?? [],
      summary: input.summary ?? null,
      isReferenceOnly: input.isReferenceOnly ?? false,
      createdByUser: { connect: { id: principal.userId } },
      ...(input.publisherId ? { publisher: { connect: { id: input.publisherId } } } : {}),
    };

    const book = await tx.book.create({
      data: {
        ...data,
        authors: input.authorIds?.length
          ? {
              create: input.authorIds.map((authorId, index) => ({
                position: index + 1,
                role: 'AUTHOR',
                author: { connect: { id: authorId } },
              })),
            }
          : undefined,
        categories: input.categoryIds?.length
          ? {
              create: input.categoryIds.map((categoryId, index) => ({
                isPrimary: index === 0,
                category: { connect: { id: categoryId } },
              })),
            }
          : undefined,
        tags: input.tagIds?.length
          ? {
              create: input.tagIds.map((tagId) => ({
                tag: { connect: { id: tagId } },
              })),
            }
          : undefined,
      },
      select: BOOK_SELECT,
    });

    if (copyCount > 0 && copyBranchId) {
      await tx.bookCopy.createMany({
        data: Array.from({ length: copyCount }, () => ({
          bookId: book.id,
          branchId: copyBranchId,
          accessionNumber: generateToken('ACC'),
          barcode: generateToken('BAR'),
          qrToken: generateToken('QR'),
          condition: 'GOOD' as CopyCondition,
          status: 'AVAILABLE' as CopyStatus,
        })),
      });
    }

    return book;
  });
  } catch (error) {
    // Lost the uniqueness race between the guard above and the insert.
    if (isIsbn13UniqueConflict(error)) {
      throw conflict('BOOK_ISBN13_DUPLICATE', 'A book with this ISBN-13 already exists.');
    }
    throw error;
  }

  const summary = (await bookCopySummaries(principal, [created.id])).get(created.id) ?? {
    total: 0,
    available: 0,
    onLoan: 0,
  };

  announce('Book.created', created.id);
  return { book: created, summary };
}

export async function updateBook(
  principal: AuthPrincipal,
  id: string,
  input: {
    isbn10?: string | null;
    isbn13?: string | null;
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
    subjects?: string[] | null;
    summary?: string | null;
    isReferenceOnly?: boolean;
    authorIds?: string[] | null;
    categoryIds?: string[] | null;
    tagIds?: string[] | null;
  },
): Promise<{
  book: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>;
  summary: BookCopySummaryDto;
}> {
  const existing = await prisma.book.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      publicationYear: true,
      authors: { select: { authorId: true } },
    },
  });
  if (!existing) throw notFound('Book');

  const isbn =
    input.isbn10 !== undefined || input.isbn13 !== undefined
      ? ensureBookIsbnPair(input.isbn10, input.isbn13)
      : undefined;

  await assertNoDuplicateBook(
    {
      isbn13: isbn?.isbn13 ?? null,
      title: input.title ?? existing.title,
      publicationYear:
        input.publicationYear !== undefined ? input.publicationYear : existing.publicationYear,
      authorIds: input.authorIds ?? existing.authors.map(({ authorId }) => authorId),
    },
    id,
  );

  let updated: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>;
  try {
    updated = await withTransaction(async (tx) => {
    const data: Prisma.BookUpdateInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.subtitle !== undefined ? { subtitle: input.subtitle ?? null } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.edition !== undefined ? { edition: input.edition ?? null } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.publicationYear !== undefined
        ? { publicationYear: input.publicationYear ?? null }
        : {}),
      ...(input.publicationDate !== undefined
        ? {
            publicationDate: input.publicationDate
              ? new Date(`${input.publicationDate}T00:00:00.000Z`)
              : null,
          }
        : {}),
      ...(input.pageCount !== undefined ? { pageCount: input.pageCount ?? null } : {}),
      ...(input.publisherId !== undefined
        ? {
            publisher: input.publisherId
              ? { connect: { id: input.publisherId } }
              : { disconnect: true },
          }
        : {}),
      ...(input.coverImageUrl !== undefined ? { coverImageUrl: input.coverImageUrl ?? null } : {}),
      ...(input.callNumber !== undefined ? { callNumber: input.callNumber ?? null } : {}),
      ...(input.subjects !== undefined ? { subjects: input.subjects ?? [] } : {}),
      ...(input.summary !== undefined ? { summary: input.summary ?? null } : {}),
      ...(input.isReferenceOnly !== undefined ? { isReferenceOnly: input.isReferenceOnly } : {}),
      ...(isbn ? { isbn10: isbn.isbn10 ?? null, isbn13: isbn.isbn13 ?? null } : {}),
    };

    await tx.book.update({ where: { id }, data, select: BOOK_SELECT });

    if (input.authorIds !== undefined) {
      await tx.bookAuthor.deleteMany({ where: { bookId: id } });
      if (input.authorIds && input.authorIds.length > 0) {
        await tx.bookAuthor.createMany({
          data: input.authorIds.map((authorId, index) => ({
            bookId: id,
            authorId,
            position: index + 1,
            role: 'AUTHOR',
          })),
        });
      }
    }

    if (input.categoryIds !== undefined) {
      await tx.bookCategory.deleteMany({ where: { bookId: id } });
      if (input.categoryIds && input.categoryIds.length > 0) {
        await tx.bookCategory.createMany({
          data: input.categoryIds.map((categoryId, index) => ({
            bookId: id,
            categoryId,
            isPrimary: index === 0,
          })),
        });
      }
    }

    if (input.tagIds !== undefined) {
      await tx.bookTag.deleteMany({ where: { bookId: id } });
      if (input.tagIds && input.tagIds.length > 0) {
        await tx.bookTag.createMany({
          data: input.tagIds.map((tagId) => ({
            bookId: id,
            tagId,
          })),
        });
      }
    }

    return tx.book.findUniqueOrThrow({ where: { id }, select: BOOK_SELECT });
    });
  } catch (error) {
    // Lost the ISBN uniqueness race between the guard above and the update.
    if (isIsbn13UniqueConflict(error)) {
      throw conflict('BOOK_ISBN13_DUPLICATE', 'A book with this ISBN-13 already exists.');
    }
    throw error;
  }

  const summary = (await bookCopySummaries(principal, [updated.id])).get(updated.id) ?? {
    total: 0,
    available: 0,
    onLoan: 0,
  };
  announce('Book.updated', updated.id);
  return { book: updated, summary };
}

export async function archiveBook(
  principal: AuthPrincipal,
  id: string,
  reason?: string,
  context: AuditContext = {},
): Promise<Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>> {
  const existing = await prisma.book.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Book');

  const book = await prisma.book.update({
    where: { id },
    data: {
      archivedAt: new Date(),
      archivedReason: reason ?? 'Archived by staff',
    },
    select: BOOK_SELECT,
  });

  await recordAudit({
    action: 'BOOK_ARCHIVED',
    entityType: 'Book',
    entityId: id,
    description: reason ?? 'Archived by staff',
    actor: { userId: principal.userId, email: principal.email, roleCode: principal.roleCode },
    context,
  });

  announce('Book.archived', book.id);
  return book;
}

/**
 * Physically removes a book record.
 *
 * Deliberately narrow: refused while ANY dependent record exists. Copy, loan,
 * reservation, borrow-request and digital-resource rows all carry `onDelete:
 * Restrict` edges to `books`, so the refuse list here is exactly the set the
 * database would reject with a constraint error — the message turns that opaque
 * error into advice ("withdraw it instead"). A book with a loan history can
 * never be deleted at all; that is the point of an append-only library.
 */
export async function deleteBook(
  principal: AuthPrincipal,
  id: string,
  context: AuditContext = {},
): Promise<void> {
  const book = await prisma.book.findUnique({
    where: { id },
    select: {
      id: true,
      _count: {
        select: {
          copies: true,
          loans: true,
          reservations: true,
          borrowRequests: true,
          digitalResources: true,
        },
      },
    },
  });
  if (!book) throw notFound('Book');

  const { copies, loans, reservations, borrowRequests, digitalResources } = book._count;
  if (copies + loans + reservations + borrowRequests + digitalResources > 0) {
    throw new AppError(
      'CONFLICT',
      'This book has dependent records (copies, loans or reservations) and cannot be deleted. Withdraw it from the catalogue instead.',
      { logContext: { bookId: id, counts: book._count } },
    );
  }

  // Recorded BEFORE the row disappears — a deletion event can only describe a
  // record that still exists at the time it is written.
  await recordAudit({
    action: 'BOOK_DELETED',
    entityType: 'Book',
    entityId: id,
    description: 'Book record deleted',
    actor: { userId: principal.userId, email: principal.email, roleCode: principal.roleCode },
    context,
  });

  await prisma.book.delete({ where: { id } });
  announce('Book.deleted', id);
}

export async function listCopies(
  principal: AuthPrincipal,
  filters: {
    branchId?: string;
    bookId?: string;
    status?: string;
    condition?: string;
    pagination: PaginationQuery;
    sort?: string;
    direction?: 'asc' | 'desc';
  },
): Promise<{ copies: Prisma.BookCopyGetPayload<{ select: typeof COPY_SELECT }>[]; total: number }> {
  const where: Prisma.BookCopyWhereInput = {
    ...branchScopeFilter(principal, 'branchId'),
    branch: { isActive: true },
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.bookId ? { bookId: filters.bookId } : {}),
    ...(filters.status ? { status: filters.status as CopyStatus } : {}),
    ...(filters.condition ? { condition: filters.condition as CopyCondition } : {}),
  };

  const order = orderBy(
    (['accessionNumber', 'acquisitionDate', 'createdAt', 'updatedAt'] as const).filter((field) =>
      filters.sort ? (SORTABLE_FIELDS.copy as readonly string[]).includes(field) : true,
    ),
    filters.direction ?? 'asc',
    SORTABLE_FIELDS.copy,
  );

  const [copies, total] = await Promise.all([
    prisma.bookCopy.findMany({
      where,
      select: COPY_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.bookCopy.count({ where }),
  ]);

  return { copies, total };
}

export async function getCopy(
  principal: AuthPrincipal,
  id: string,
): Promise<Prisma.BookCopyGetPayload<{ select: typeof COPY_SELECT }>> {
  const copy = await prisma.bookCopy.findFirst({
    where: { id, ...branchScopeFilter(principal, 'branchId'), branch: { isActive: true } },
    select: COPY_SELECT,
  });

  if (!copy) throw notFound('Copy');
  return copy;
}

export async function createCopy(input: {
  bookId: string;
  branchId: string;
  locationId?: string | null;
  shelfId?: string | null;
  accessionNumber?: string | null;
  barcode?: string | null;
  qrToken?: string | null;
  condition?: string | null;
  status?: string | null;
  acquisitionDate?: string | null;
  acquisitionSource?: string | null;
  purchasePrice?: string | null;
  replacementCost?: string | null;
  notes?: string | null;
}): Promise<Prisma.BookCopyGetPayload<{ select: typeof COPY_SELECT }>> {
  const book = await prisma.book.findUnique({ where: { id: input.bookId }, select: { id: true } });
  if (!book) throw notFound('Book');

  const branch = await prisma.branch.findUnique({
    where: { id: input.branchId },
    select: { id: true },
  });
  if (!branch) throw notFound('Branch');

  if (input.locationId) {
    const location = await prisma.location.findUnique({
      where: { id: input.locationId },
      select: { id: true },
    });
    if (!location) throw notFound('Location');
  }
  if (input.shelfId) {
    const shelf = await prisma.shelf.findUnique({
      where: { id: input.shelfId },
      select: { id: true },
    });
    if (!shelf) throw notFound('Shelf');
  }

  const data = {
    book: { connect: { id: input.bookId } },
    branch: { connect: { id: input.branchId } },
    location: input.locationId ? { connect: { id: input.locationId } } : undefined,
    shelf: input.shelfId ? { connect: { id: input.shelfId } } : undefined,
    accessionNumber: input.accessionNumber ?? generateToken('ACC'),
    barcode: input.barcode ?? generateToken('BAR'),
    qrToken: input.qrToken ?? generateToken('QR'),
    condition: (input.condition ?? 'GOOD') as CopyCondition,
    status: (input.status ?? 'AVAILABLE') as CopyStatus,
    acquisitionDate: input.acquisitionDate
      ? new Date(`${input.acquisitionDate}T00:00:00.000Z`)
      : null,
    acquisitionSource: input.acquisitionSource ?? null,
    purchasePrice: input.purchasePrice ? new Prisma.Decimal(input.purchasePrice) : null,
    replacementCost: input.replacementCost ? new Prisma.Decimal(input.replacementCost) : null,
    notes: input.notes ?? null,
  } satisfies Prisma.BookCopyCreateInput;

  const copy = await prisma.bookCopy.create({ data, select: COPY_SELECT });
  announce('Copy.created', copy.id);
  return copy;
}

export async function updateCopy(
  id: string,
  input: {
    branchId?: string | null;
    locationId?: string | null;
    shelfId?: string | null;
    condition?: string | null;
    status?: string | null;
    acquisitionDate?: string | null;
    acquisitionSource?: string | null;
    purchasePrice?: string | null;
    replacementCost?: string | null;
    notes?: string | null;
  },
): Promise<Prisma.BookCopyGetPayload<{ select: typeof COPY_SELECT }>> {
  const existing = await prisma.bookCopy.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Copy');

  return prisma.bookCopy
    .update({
      where: { id },
      data: {
        ...(input.branchId !== undefined
          ? { branch: input.branchId ? { connect: { id: input.branchId } } : undefined }
          : {}),
        ...(input.locationId !== undefined
          ? {
              location: input.locationId
                ? { connect: { id: input.locationId } }
                : { disconnect: true },
            }
          : {}),
        ...(input.shelfId !== undefined
          ? { shelf: input.shelfId ? { connect: { id: input.shelfId } } : { disconnect: true } }
          : {}),
        ...(input.condition !== undefined ? { condition: input.condition as CopyCondition } : {}),
        ...(input.status !== undefined ? { status: input.status as CopyStatus } : {}),
        ...(input.acquisitionDate !== undefined
          ? {
              acquisitionDate: input.acquisitionDate
                ? new Date(`${input.acquisitionDate}T00:00:00.000Z`)
                : null,
            }
          : {}),
        ...(input.acquisitionSource !== undefined
          ? { acquisitionSource: input.acquisitionSource ?? null }
          : {}),
        ...(input.purchasePrice !== undefined
          ? { purchasePrice: input.purchasePrice ? new Prisma.Decimal(input.purchasePrice) : null }
          : {}),
        ...(input.replacementCost !== undefined
          ? {
              replacementCost: input.replacementCost
                ? new Prisma.Decimal(input.replacementCost)
                : null,
            }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      select: COPY_SELECT,
    })
    .then((copy) => {
      announce('Copy.updated', copy.id);
      return copy;
    });
}

export async function deleteCopy(id: string): Promise<void> {
  const copy = await prisma.bookCopy.findUnique({ where: { id }, select: { id: true } });
  if (!copy) throw notFound('Copy');
  await prisma.bookCopy.delete({ where: { id } });
  announce('Copy.deleted', id);
}
