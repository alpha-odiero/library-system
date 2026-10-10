import { Router } from 'express';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate, validated } from '../../middleware/validate.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { forbidden } from '../../lib/errors.js';
import { sendCreated, sendNoContent, sendOk, sendPaginated } from '../../lib/response.js';
import { parsePagination } from '../../lib/pagination.js';
import * as catalogue from './catalogue.service.js';
import {
  authorCreateSchema,
  authorIdParamSchema,
  authorListQuerySchema,
  authorUpdateSchema,
  bookActionQuerySchema,
  bookCreateSchema,
  bookIdParamSchema,
  bookListQuerySchema,
  bookUpdateSchema,
  categoryCreateSchema,
  categoryIdParamSchema,
  categoryListQuerySchema,
  categoryUpdateSchema,
  copyCreateSchema,
  copyIdParamSchema,
  copyListQuerySchema,
  copyUpdateSchema,
  publisherCreateSchema,
  publisherIdParamSchema,
  publisherListQuerySchema,
  publisherUpdateSchema,
  tagCreateSchema,
  tagIdParamSchema,
  tagListQuerySchema,
  tagUpdateSchema,
} from './catalogue.schemas.js';

export const authorsRouter = Router();
export const publishersRouter = Router();
export const categoriesRouter = Router();
export const tagsRouter = Router();
export const booksRouter = Router();
export const copiesRouter = Router();

authorsRouter.get(
  '/',
  requireAuth(),
  requirePermission('AUTHOR_VIEW'),
  validate({ query: authorListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, authorListQuerySchema);
    const { authors, total } = await catalogue.listAuthors(principal, {
      q: query.q,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });
    sendPaginated(res, authors.map(catalogue.toAuthorDto), {
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
      total,
    });
  }),
);

authorsRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('AUTHOR_VIEW'),
  validate({ params: authorIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, authorIdParamSchema);
    sendOk(res, { author: catalogue.toAuthorDto(await catalogue.getAuthor(id)) });
  }),
);

authorsRouter.post(
  '/',
  requireAuth(),
  requirePermission('AUTHOR_MANAGE'),
  validate({ body: authorCreateSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, authorCreateSchema);
    const author = await catalogue.createAuthor(body);
    sendCreated(res, { author: catalogue.toAuthorDto(author) });
  }),
);

authorsRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('AUTHOR_MANAGE'),
  validate({ params: authorIdParamSchema, body: authorUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, authorIdParamSchema);
    const body = validated.body(req, authorUpdateSchema);
    sendOk(
      res,
      { author: catalogue.toAuthorDto(await catalogue.updateAuthor(id, body)) },
      { message: 'Author updated' },
    );
  }),
);

authorsRouter.delete(
  '/:id',
  requireAuth(),
  requirePermission('AUTHOR_MANAGE'),
  validate({ params: authorIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, authorIdParamSchema);
    await catalogue.deleteAuthor(id);
    sendNoContent(res);
  }),
);

publishersRouter.get(
  '/',
  requireAuth(),
  requirePermission('PUBLISHER_VIEW'),
  validate({ query: publisherListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, publisherListQuerySchema);
    const { publishers, total } = await catalogue.listPublishers(principal, {
      q: query.q,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });
    sendPaginated(res, publishers.map(catalogue.toPublisherDto), {
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
      total,
    });
  }),
);

publishersRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('PUBLISHER_VIEW'),
  validate({ params: publisherIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, publisherIdParamSchema);
    sendOk(res, { publisher: catalogue.toPublisherDto(await catalogue.getPublisher(id)) });
  }),
);

publishersRouter.post(
  '/',
  requireAuth(),
  requirePermission('PUBLISHER_MANAGE'),
  validate({ body: publisherCreateSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, publisherCreateSchema);
    const publisher = await catalogue.createPublisher(body);
    sendCreated(res, { publisher: catalogue.toPublisherDto(publisher) });
  }),
);

publishersRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('PUBLISHER_MANAGE'),
  validate({ params: publisherIdParamSchema, body: publisherUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, publisherIdParamSchema);
    const body = validated.body(req, publisherUpdateSchema);
    sendOk(
      res,
      { publisher: catalogue.toPublisherDto(await catalogue.updatePublisher(id, body)) },
      { message: 'Publisher updated' },
    );
  }),
);

publishersRouter.delete(
  '/:id',
  requireAuth(),
  requirePermission('PUBLISHER_MANAGE'),
  validate({ params: publisherIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, publisherIdParamSchema);
    await catalogue.deletePublisher(id);
    sendNoContent(res);
  }),
);

categoriesRouter.get(
  '/',
  requireAuth(),
  requirePermission('CATEGORY_VIEW'),
  validate({ query: categoryListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, categoryListQuerySchema);
    const { categories, total } = await catalogue.listCategories(principal, {
      q: query.q,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });
    sendPaginated(res, categories.map(catalogue.toCategoryDto), {
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
      total,
    });
  }),
);

categoriesRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('CATEGORY_VIEW'),
  validate({ params: categoryIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, categoryIdParamSchema);
    sendOk(res, { category: catalogue.toCategoryDto(await catalogue.getCategory(id)) });
  }),
);

categoriesRouter.post(
  '/',
  requireAuth(),
  requirePermission('CATEGORY_MANAGE'),
  validate({ body: categoryCreateSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, categoryCreateSchema);
    const category = await catalogue.createCategory(body);
    sendCreated(res, { category: catalogue.toCategoryDto(category) });
  }),
);

categoriesRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('CATEGORY_MANAGE'),
  validate({ params: categoryIdParamSchema, body: categoryUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, categoryIdParamSchema);
    const body = validated.body(req, categoryUpdateSchema);
    sendOk(
      res,
      { category: catalogue.toCategoryDto(await catalogue.updateCategory(id, body)) },
      { message: 'Category updated' },
    );
  }),
);

categoriesRouter.delete(
  '/:id',
  requireAuth(),
  requirePermission('CATEGORY_MANAGE'),
  validate({ params: categoryIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, categoryIdParamSchema);
    await catalogue.deleteCategory(id);
    sendNoContent(res);
  }),
);

tagsRouter.get(
  '/',
  requireAuth(),
  requirePermission('TAG_VIEW'),
  validate({ query: tagListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, tagListQuerySchema);
    const { tags, total } = await catalogue.listTags(principal, {
      q: query.q,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });
    sendPaginated(res, tags.map(catalogue.toTagDto), {
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
      total,
    });
  }),
);

tagsRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('TAG_VIEW'),
  validate({ params: tagIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, tagIdParamSchema);
    sendOk(res, { tag: catalogue.toTagDto(await catalogue.getTag(id)) });
  }),
);

tagsRouter.post(
  '/',
  requireAuth(),
  requirePermission('TAG_MANAGE'),
  validate({ body: tagCreateSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, tagCreateSchema);
    const tag = await catalogue.createTag(body);
    sendCreated(res, { tag: catalogue.toTagDto(tag) });
  }),
);

tagsRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('TAG_MANAGE'),
  validate({ params: tagIdParamSchema, body: tagUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, tagIdParamSchema);
    const body = validated.body(req, tagUpdateSchema);
    sendOk(
      res,
      { tag: catalogue.toTagDto(await catalogue.updateTag(id, body)) },
      { message: 'Tag updated' },
    );
  }),
);

tagsRouter.delete(
  '/:id',
  requireAuth(),
  requirePermission('TAG_MANAGE'),
  validate({ params: tagIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, tagIdParamSchema);
    await catalogue.deleteTag(id);
    sendNoContent(res);
  }),
);

booksRouter.get(
  '/',
  requireAuth(),
  requirePermission('BOOK_VIEW'),
  validate({ query: bookListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, bookListQuerySchema);
    const { books, total, copySummaries } = await catalogue.listBooks(principal, {
      q: query.q,
      branchId: query.branchId,
      authorId: query.authorId,
      categoryId: query.categoryId,
      tagId: query.tagId,
      availableOnly: query.availableOnly,
      includeArchived: query.includeArchived,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });
    sendPaginated(
      res,
      books.map((book) => catalogue.toBookDto(book, copySummaries.get(book.id) ?? { total: 0, available: 0, onLoan: 0 })),
      {
        page: Number(req.query.page ?? 1),
        limit: Number(req.query.limit ?? 20),
        total,
      },
    );
  }),
);

booksRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('BOOK_VIEW'),
  validate({ params: bookIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, bookIdParamSchema);
    const { book, summary } = await catalogue.getBook(principal, id);
    sendOk(res, { book: catalogue.toBookDto(book, summary) });
  }),
);

booksRouter.post(
  '/',
  requireAuth(),
  requirePermission('BOOK_CREATE'),
  validate({ body: bookCreateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, bookCreateSchema);
    const { book, summary } = await catalogue.createBook(principal, body);
    sendCreated(res, { book: catalogue.toBookDto(book, summary) });
  }),
);

booksRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('BOOK_UPDATE'),
  validate({ params: bookIdParamSchema, body: bookUpdateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, bookIdParamSchema);
    const body = validated.body(req, bookUpdateSchema);
    const { book, summary } = await catalogue.updateBook(principal, id, body);
    sendOk(res, { book: catalogue.toBookDto(book, summary) }, { message: 'Book updated' });
  }),
);

booksRouter.delete(
  '/:id',
  requireAuth(),
  validate({ params: bookIdParamSchema, query: bookActionQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, bookIdParamSchema);
    const { action = 'archive' } = validated.query(req, bookActionQuerySchema);
    const context = {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };

    if (action === 'delete') {
      // Hard delete is a sensitive, separate grant from archiving.
      if (!principal.permissions.has('BOOK_DELETE')) {
        throw forbidden('You do not have permission to delete this book', 'BOOK_DELETE');
      }
      await catalogue.deleteBook(principal, id, context);
    } else {
      if (!principal.permissions.has('BOOK_ARCHIVE')) {
        throw forbidden('You do not have permission to withdraw this book', 'BOOK_ARCHIVE');
      }
      await catalogue.archiveBook(principal, id, 'Archived via API', context);
    }
    sendNoContent(res);
  }),
);

copiesRouter.get(
  '/',
  requireAuth(),
  requirePermission('COPY_VIEW'),
  validate({ query: copyListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, copyListQuerySchema);
    const { copies, total } = await catalogue.listCopies(principal, {
      branchId: query.branchId,
      bookId: query.bookId,
      status: query.status,
      condition: query.condition,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });
    sendPaginated(res, copies.map(catalogue.toCopyDto), {
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
      total,
    });
  }),
);

copiesRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('COPY_VIEW'),
  validate({ params: copyIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, copyIdParamSchema);
    sendOk(res, { copy: catalogue.toCopyDto(await catalogue.getCopy(principal, id)) });
  }),
);

copiesRouter.post(
  '/',
  requireAuth(),
  requirePermission('COPY_CREATE'),
  validate({ body: copyCreateSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, copyCreateSchema);
    const copy = await catalogue.createCopy(body);
    sendCreated(res, { copy: catalogue.toCopyDto(copy) });
  }),
);

copiesRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('COPY_UPDATE'),
  validate({ params: copyIdParamSchema, body: copyUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, copyIdParamSchema);
    const body = validated.body(req, copyUpdateSchema);
    const updated = await catalogue.updateCopy(id, body);
    sendOk(res, { copy: catalogue.toCopyDto(updated) }, { message: 'Copy updated' });
  }),
);

copiesRouter.delete(
  '/:id',
  requireAuth(),
  requirePermission('COPY_DELETE'),
  validate({ params: copyIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validated.params(req, copyIdParamSchema);
    await catalogue.deleteCopy(id);
    sendNoContent(res);
  }),
);
