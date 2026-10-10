import { describe, expect, it } from 'vitest';
import { isAllowed, orderBy, parsePagination, skipTake } from './pagination.js';
import { AppError } from './errors.js';
import { LIMITS } from '../config/constants.js';

describe('parsePagination', () => {
  it('applies defaults', () => {
    expect(parsePagination({})).toEqual({
      page: 1,
      limit: LIMITS.DEFAULT_PAGE_SIZE,
      order: 'desc',
    });
  });

  it('coerces query-string values', () => {
    expect(parsePagination({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 });
  });

  it('rejects a page size above the hard ceiling even when the caller asks nicely', () => {
    expect(() => parsePagination({ limit: '101' })).toThrow(AppError);
    expect(() => parsePagination({ limit: '100000' })).toThrow(AppError);
    expect(() => parsePagination({ limit: '0' })).toThrow(AppError);
    expect(() => parsePagination({ page: '-1' })).toThrow(AppError);
  });

  it('rejects an unknown sort order', () => {
    expect(() => parsePagination({ order: 'sideways' })).toThrow(AppError);
  });
});

describe('skipTake', () => {
  it('translates page/limit into Prisma offset and take', () => {
    expect(skipTake({ page: 1, limit: 20, order: 'desc' })).toEqual({ skip: 0, take: 20 });
    expect(skipTake({ page: 3, limit: 20, order: 'desc' })).toEqual({ skip: 40, take: 20 });
    expect(skipTake({ page: 25, limit: 20, order: 'desc' })).toEqual({ skip: 480, take: 20 });
  });
});

describe('orderBy', () => {
  const SORTABLE = ['title', 'publicationYear', 'createdAt'] as const;

  it('accepts allowlisted fields', () => {
    expect(orderBy(['title'], 'asc', SORTABLE)).toEqual([{ title: 'asc' }]);
  });

  it('rejects fields outside the allowlist — this is the mass-assignment guard', () => {
    // Without the allowlist a caller could order by any column or relation and
    // use result ordering as a side channel to infer the contents of a column
    // they are not authorised to read.
    expect(() => orderBy(['passwordHash'], 'asc', SORTABLE)).toThrow(AppError);
    expect(() => orderBy(['role'], 'asc', SORTABLE)).toThrow(AppError);
  });

  it('keeps allowlisted fields and drops the rest from a mixed request', () => {
    expect(orderBy(['title', 'passwordHash'], 'asc', SORTABLE)).toEqual([{ title: 'asc' }]);
  });

  it('applies ascending tie-breakers so pagination is stable', () => {
    // Without a deterministic secondary key, rows 20 and 21 can swap between
    // two requests and a member sees the same record twice and misses another.
    //
    // Each field is its OWN array element. This is the shape Prisma validates:
    // an element carrying two keys passes the type check (OrderBy is
    // Record<string, 'asc'|'desc'>) but Prisma rejects the query with
    // "Expected BookOrderByWithRelationInput, provided (Object)", which surfaces
    // as a 400 on every list endpoint at once.
    expect(orderBy(['title', 'publicationYear'], 'desc', SORTABLE)).toEqual([
      { title: 'desc' },
      { publicationYear: 'asc' },
    ]);
  });

  it('emits exactly one key per array element', () => {
    // The regression this guards: a single element holding every sort key.
    for (const entry of orderBy(['title', 'publicationYear', 'createdAt'], 'asc', SORTABLE)) {
      expect(Object.keys(entry)).toHaveLength(1);
    }
  });

  it('does not let a repeated field overwrite the primary direction', () => {
    expect(orderBy(['title', 'title'], 'desc', SORTABLE)).toEqual([{ title: 'desc' }]);
  });

  it('defaults to descending', () => {
    expect(orderBy(['createdAt'], undefined, SORTABLE)).toEqual([{ createdAt: 'desc' }]);
  });

  it('throws when the request contains no allowable field at all', () => {
    expect(() => orderBy(['nope'], 'asc', SORTABLE)).toThrow(/Invalid sort field/);
    expect(() => orderBy([], 'asc', SORTABLE)).toThrow(/Invalid sort field/);
  });

  it('works without an allowlist when the caller supplies a literal union', () => {
    expect(orderBy(['title'], 'asc')).toEqual([{ title: 'asc' }]);
  });
});

describe('isAllowed', () => {
  it('narrows a string to the allowed union', () => {
    expect(isAllowed('title', ['title', 'edition'] as const)).toBe(true);
    expect(isAllowed('secret', ['title'] as const)).toBe(false);
  });
});
