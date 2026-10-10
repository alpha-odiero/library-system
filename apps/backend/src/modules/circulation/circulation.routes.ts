import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { parsePagination } from '../../lib/pagination.js';
import { sendCreated, sendNoContent, sendOk, sendPaginated } from '../../lib/response.js';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate, validated } from '../../middleware/validate.js';
import * as circulation from './circulation.service.js';
import {
  loanIdParamSchema,
  loanIssueSchema,
  loanListQuerySchema,
  loanRenewSchema,
  loanReturnSchema,
  reservationCreateSchema,
  reservationFulfillSchema,
  reservationIdParamSchema,
  reservationListQuerySchema,
} from './circulation.schemas.js';

export const loansRouter = Router();
export const reservationsRouter = Router();

/*
 * Either permission admits the route: `LOAN_VIEW` for staff across the library,
 * `LOAN_VIEW_OWN` for a member reading their own record. `requirePermission` is
 * OR, and the ownership narrowing that makes `LOAN_VIEW_OWN` safe lives in
 * `circulation.service.ts` — this guard must not require the staff permission or a
 * member is refused before that narrowing runs.
 */
loansRouter.get(
  '/',
  requireAuth(),
  requirePermission('LOAN_VIEW', 'LOAN_VIEW_OWN'),
  validate({ query: loanListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, loanListQuerySchema);
    const { loans, total } = await circulation.listLoans(principal, {
      memberId: query.memberId,
      copyId: query.copyId,
      bookId: query.bookId,
      branchId: query.branchId,
      status: query.status,
      includeReturned: query.includeReturned,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });

    sendPaginated(res, loans.map(circulation.toLoanDto), {
      ...parsePagination(req.query as Record<string, unknown>),
      total,
    });
  }),
);

loansRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('LOAN_VIEW', 'LOAN_VIEW_OWN'),
  validate({ params: loanIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, loanIdParamSchema);
    sendOk(res, { loan: circulation.toLoanDto(await circulation.getLoan(principal, id)) });
  }),
);

loansRouter.post(
  '/',
  requireAuth(),
  requirePermission('LOAN_CREATE'),
  validate({ body: loanIssueSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, loanIssueSchema);
    const loan = await circulation.issueLoan(principal, body);
    sendCreated(res, { loan: circulation.toLoanDto(loan) });
  }),
);

loansRouter.post(
  '/:id/return',
  requireAuth(),
  requirePermission('LOAN_RETURN'),
  validate({ params: loanIdParamSchema, body: loanReturnSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, loanIdParamSchema);
    const body = validated.body(req, loanReturnSchema);
    const loan = await circulation.returnLoan(principal, id, body);
    sendOk(res, { loan: circulation.toLoanDto(loan) }, { message: 'Loan returned' });
  }),
);

loansRouter.post(
  '/:id/renew',
  requireAuth(),
  requirePermission('LOAN_RENEW'),
  validate({ params: loanIdParamSchema, body: loanRenewSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, loanIdParamSchema);
    const body = validated.body(req, loanRenewSchema);
    const loan = await circulation.renewLoan(principal, id, body);
    sendOk(res, { loan: circulation.toLoanDto(loan) }, { message: 'Loan renewed' });
  }),
);

reservationsRouter.get(
  '/',
  requireAuth(),
  requirePermission('RESERVATION_VIEW', 'RESERVATION_VIEW_OWN'),
  validate({ query: reservationListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, reservationListQuerySchema);
    const { reservations, total } = await circulation.listReservations(principal, {
      memberId: query.memberId,
      bookId: query.bookId,
      branchId: query.branchId,
      status: query.status,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });

    sendPaginated(res, reservations.map(circulation.toReservationDto), {
      ...parsePagination(req.query as Record<string, unknown>),
      total,
    });
  }),
);

reservationsRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('RESERVATION_VIEW', 'RESERVATION_VIEW_OWN'),
  validate({ params: reservationIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, reservationIdParamSchema);
    sendOk(res, {
      reservation: circulation.toReservationDto(await circulation.getReservation(principal, id)),
    });
  }),
);

reservationsRouter.post(
  '/',
  requireAuth(),
  requirePermission('RESERVATION_CREATE'),
  validate({ body: reservationCreateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, reservationCreateSchema);
    const reservation = await circulation.createReservation(principal, body);
    sendCreated(res, { reservation: circulation.toReservationDto(reservation) });
  }),
);

reservationsRouter.delete(
  '/:id',
  requireAuth(),
  requirePermission('RESERVATION_CANCEL'),
  validate({ params: reservationIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, reservationIdParamSchema);
    await circulation.cancelReservation(principal, id);
    sendNoContent(res);
  }),
);

reservationsRouter.post(
  '/:id/fulfill',
  requireAuth(),
  requirePermission('RESERVATION_FULFIL'),
  validate({ params: reservationIdParamSchema, body: reservationFulfillSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, reservationIdParamSchema);
    const body = validated.body(req, reservationFulfillSchema);
    const reservation = await circulation.fulfillReservation(principal, id, body);
    sendOk(
      res,
      { reservation: circulation.toReservationDto(reservation) },
      { message: 'Reservation fulfilled' },
    );
  }),
);
