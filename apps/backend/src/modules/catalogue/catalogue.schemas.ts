import { z } from 'zod';
import { uuidSchema } from '@lms/shared';
import { LIMITS } from '../../config/constants.js';

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed)) return false;
    return new Date(parsed).toISOString().slice(0, 10) === value;
  }, 'Enter a real calendar date');

const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((value) => (value === null || value.length === 0 ? null : value))
    .optional();

const isbnString = z
  .string()
  .trim()
  .min(10)
  .max(17)
  .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
  .refine((value) => value.length >= 10 && value.length <= 17, 'Enter a valid ISBN');

export const authorIdParamSchema = z.object({ id: uuidSchema }).strict();
export const publisherIdParamSchema = z.object({ id: uuidSchema }).strict();
export const categoryIdParamSchema = z.object({ id: uuidSchema }).strict();
export const tagIdParamSchema = z.object({ id: uuidSchema }).strict();
export const bookIdParamSchema = z.object({ id: uuidSchema }).strict();
export const copyIdParamSchema = z.object({ id: uuidSchema }).strict();

/**
 * The destructive action taken on a book.
 *
 * `archive` (default) retires the record while keeping copies, loan history and
 * audit; `delete` physically removes it and is refused while any record depends
 * on it.
 */
export const bookActionQuerySchema = z
  .object({ action: z.enum(['archive', 'delete']).optional() })
  .strict();

export const authorListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const authorCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    sortName: z.string().trim().min(1).max(200).optional(),
    biography: optionalText(4000),
    nationality: optionalText(100),
    birthYear: z.coerce.number().int().min(0).max(9999).optional(),
    deathYear: z.coerce.number().int().min(0).max(9999).optional(),
  })
  .strict();

export const authorUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    sortName: z.string().trim().min(1).max(200).optional(),
    biography: optionalText(4000),
    nationality: optionalText(100),
    birthYear: z.coerce.number().int().min(0).max(9999).optional(),
    deathYear: z.coerce.number().int().min(0).max(9999).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

export const publisherListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const publisherCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    imprint: optionalText(200),
    country: optionalText(100),
    website: optionalText(255),
    email: optionalText(255),
  })
  .strict();

export const publisherUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    imprint: optionalText(200),
    country: optionalText(100),
    website: optionalText(255),
    email: optionalText(255),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

export const categoryListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const categoryCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    description: optionalText(2000),
    parentId: uuidSchema.optional(),
    position: z.coerce.number().int().min(0).max(10000).optional(),
  })
  .strict();

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    description: optionalText(2000),
    parentId: uuidSchema.optional().nullable(),
    position: z.coerce.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

export const tagListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const tagCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    label: optionalText(80),
  })
  .strict();

export const tagUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    label: optionalText(80),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

export const bookListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    branchId: uuidSchema.optional(),
    authorId: uuidSchema.optional(),
    categoryId: uuidSchema.optional(),
    tagId: uuidSchema.optional(),
    availableOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    includeArchived: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict();

export const bookCreateSchema = z
  .object({
    isbn10: isbnString.optional(),
    isbn13: isbnString.optional(),
    title: z.string().trim().min(1).max(400),
    subtitle: optionalText(400),
    description: optionalText(4000),
    edition: optionalText(100),
    language: z.string().trim().min(2).max(50).optional().default('en'),
    publicationYear: z.coerce.number().int().min(0).max(9999).optional(),
    publicationDate: calendarDate.optional(),
    pageCount: z.coerce.number().int().positive().max(20000).optional(),
    publisherId: uuidSchema.optional(),
    coverImageUrl: z.string().trim().url().max(500).optional(),
    callNumber: optionalText(50),
    subjects: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    summary: optionalText(2000),
    isReferenceOnly: z.boolean().optional(),
    authorIds: z.array(uuidSchema).min(1, 'Provide at least one author').max(30),
    categoryIds: z.array(uuidSchema).min(1, 'Assign the book to at least one category').max(30),
    tagIds: z.array(uuidSchema).max(30).optional(),
    /**
     * Copies to accession in the library's active branch at the same time as the
     * record. A new book is part of the catalogue only once a physical copy
     * exists to lend, so at least one is required.
     */
    copies: z.coerce.number().int().min(1, 'Provide at least one copy').max(100),
  })
  .strict();

export const bookUpdateSchema = z
  .object({
    isbn10: isbnString.optional(),
    isbn13: isbnString.optional(),
    title: z.string().trim().min(1).max(400).optional(),
    subtitle: optionalText(400),
    description: optionalText(4000),
    edition: optionalText(100),
    language: z.string().trim().min(2).max(50).optional(),
    publicationYear: z.coerce.number().int().min(0).max(9999).optional(),
    publicationDate: calendarDate.optional(),
    pageCount: z.coerce.number().int().positive().max(20000).optional(),
    publisherId: uuidSchema.optional().nullable(),
    coverImageUrl: z.string().trim().url().max(500).optional().nullable(),
    callNumber: optionalText(50),
    subjects: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    summary: optionalText(2000),
    isReferenceOnly: z.boolean().optional(),
    authorIds: z.array(uuidSchema).max(30).optional(),
    categoryIds: z.array(uuidSchema).max(30).optional(),
    tagIds: z.array(uuidSchema).max(30).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

export const copyListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    branchId: uuidSchema.optional(),
    bookId: uuidSchema.optional(),
    status: z
      .enum(['AVAILABLE', 'BORROWED', 'RESERVED', 'LOST', 'DAMAGED', 'MAINTENANCE', 'REMOVED'])
      .optional(),
    condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']).optional(),
  })
  .strict();

export const copyCreateSchema = z
  .object({
    bookId: uuidSchema,
    branchId: uuidSchema,
    locationId: uuidSchema.optional(),
    shelfId: uuidSchema.optional(),
    accessionNumber: z.string().trim().min(1).max(50).optional(),
    barcode: z.string().trim().min(1).max(64).optional(),
    qrToken: z.string().trim().min(1).max(64).optional(),
    condition: z
      .enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'])
      .optional()
      .default('GOOD'),
    status: z
      .enum(['AVAILABLE', 'BORROWED', 'RESERVED', 'LOST', 'DAMAGED', 'MAINTENANCE', 'REMOVED'])
      .optional()
      .default('AVAILABLE'),
    acquisitionDate: calendarDate.optional(),
    acquisitionSource: z.string().trim().max(50).optional(),
    purchasePrice: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals')
      .optional(),
    replacementCost: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals')
      .optional(),
    notes: optionalText(2000),
  })
  .strict();

export const copyUpdateSchema = z
  .object({
    branchId: uuidSchema.optional(),
    locationId: uuidSchema.optional().nullable(),
    shelfId: uuidSchema.optional().nullable(),
    condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']).optional(),
    status: z
      .enum(['AVAILABLE', 'BORROWED', 'RESERVED', 'LOST', 'DAMAGED', 'MAINTENANCE', 'REMOVED'])
      .optional(),
    acquisitionDate: calendarDate.optional(),
    acquisitionSource: z.string().trim().max(50).optional(),
    purchasePrice: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals')
      .optional(),
    replacementCost: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals')
      .optional(),
    notes: optionalText(2000),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });
