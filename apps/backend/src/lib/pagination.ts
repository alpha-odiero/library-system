import { paginationQuerySchema, type PaginationQuery } from '@lms/shared';
import { LIMITS } from '../config/constants.js';
import { badRequest } from './errors.js';

export type { PaginationQuery };

/**
 * Pagination and sorting.
 *
 * Sort fields are allowlisted per resource. Interpolating a caller-supplied
 * `sort` value into Prisma's `orderBy` would be a mass-assignment hole: an
 * arbitrary key could order by an internal column or a relation, letting a
 * caller probe data through result ordering.
 */

export function parsePagination(query: Record<string, unknown>): PaginationQuery {
  const parsed = paginationQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw badRequest('Invalid pagination parameters', [
      { path: 'page', message: 'page must be a positive integer' },
      { path: 'limit', message: `limit must be between 1 and ${LIMITS.MAX_PAGE_SIZE}` },
    ]);
  }
  return parsed.data;
}

export function skipTake(pagination: PaginationQuery): { skip: number; take: number } {
  return {
    skip: (pagination.page - 1) * pagination.limit,
    take: pagination.limit,
  };
}

export type SortDirection = 'asc' | 'desc';

/**
 * Prisma's `orderBy` is model-specific (`BookOrderByWithRelationInput` and so
 * on), and there is no generic supertype. Returning an array of loose sort
 * objects keeps this helper reusable across every model; the allowlist is what
 * makes it safe.
 *
 * Each element is a SINGLE-KEY object. That is the shape Prisma requires when
 * `orderBy` is an array: the array is a sort-priority list, and every element
 * must be one complete `XOrderByWithRelationInput`. Packing several keys into
 * one array element — `{ title: 'asc', createdAt: 'asc' }` — is rejected at
 * runtime with
 * `Argument orderBy: Invalid value provided. Expected BookOrderByWithRelationInput, provided (Object)`,
 * which surfaces as a 400 from every list endpoint at once. Multi-key sorting
 * remains available by passing several *elements*, one key each.
 */
export type OrderBy = Record<string, 'asc' | 'desc'>;

/**
 * Builds a Prisma `orderBy` array from an allowlist.
 *
 *   orderBy(['title', 'publicationYear'], 'asc', SORTABLE_BOOK_FIELDS)
 *   // -> [{ title: 'asc' }, { publicationYear: 'asc' }]
 *
 * The first field honours the requested direction; subsequent tie-breakers
 * always ascend so pagination is deterministic. Without a stable tie-breaker,
 * rows either side of a page boundary can swap between requests and a member
 * sees duplicates.
 */
export function orderBy<T extends string>(
  fields: readonly T[],
  direction: SortDirection = 'desc',
  allowed?: readonly T[],
): OrderBy[] {
  const chosen = allowed ? fields.filter((field) => allowed.includes(field)) : [...fields];

  if (chosen.length === 0) {
    throw badRequest('Invalid sort field');
  }

  const [primary, ...rest] = chosen as [T, ...T[]];

  /*
   * One key per array element. A single element carrying every key looks like the
   * object form of `orderBy` and type-checks, because `OrderBy` is
   * `Record<string, 'asc' | 'desc'>` — but Prisma validates the *array* form
   * element by element, so it rejects the whole query at runtime.
   */
  const result: OrderBy[] = [{ [primary]: direction }];

  for (const field of rest) {
    // A repeated field must not displace the primary or flip its direction.
    if (!result.some((entry) => field in entry)) result.push({ [field]: 'asc' });
  }

  return result;
}

/** True when `value` is in `allowed`; used by query-filter helpers. */
export function isAllowed<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}
