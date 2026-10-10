import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { parsePagination } from '../../lib/pagination.js';
import { sendCreated, sendOk, sendPaginated } from '../../lib/response.js';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate, validated } from '../../middleware/validate.js';
import * as finance from './finance.service.js';
import {
  fineCreateSchema,
  fineIdParamSchema,
  fineListQuerySchema,
  fineUpdateSchema,
  fineWaiveSchema,
  paymentCreateSchema,
  paymentIdParamSchema,
  paymentListQuerySchema,
  paymentVoidSchema,
} from './finance.schemas.js';

export const finesRouter = Router();
export const paymentsRouter = Router();

/*
 * Either permission admits the route. `FINE_VIEW_OWN` is what a member holds, and
 * the narrowing that makes it safe — `where.memberId = principal.memberId` when the
 * staff permission is absent — is in `finance.service.ts`. Requiring `FINE_VIEW`
 * here would refuse a member before that query ever ran, which is why the two are
 * passed together rather than the staff one alone.
 */
finesRouter.get(
  '/',
  requireAuth(),
  requirePermission('FINE_VIEW', 'FINE_VIEW_OWN'),
  validate({ query: fineListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, fineListQuerySchema);
    const { fines, total } = await finance.listFines(principal, {
      memberId: query.memberId,
      loanId: query.loanId,
      branchId: query.branchId,
      status: query.status,
      type: query.type,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });

    sendPaginated(res, fines.map(finance.toFineDto), {
      ...parsePagination(req.query as Record<string, unknown>),
      total,
    });
  }),
);

finesRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('FINE_VIEW', 'FINE_VIEW_OWN'),
  validate({ params: fineIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, fineIdParamSchema);
    sendOk(res, { fine: finance.toFineDto(await finance.getFine(principal, id)) });
  }),
);

finesRouter.post(
  '/',
  requireAuth(),
  requirePermission('FINE_CREATE'),
  validate({ body: fineCreateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, fineCreateSchema);
    const fine = await finance.createFine(principal, body);
    sendCreated(res, { fine: finance.toFineDto(fine) });
  }),
);

finesRouter.patch(
  '/:id',
  requireAuth(),
  requirePermission('FINE_UPDATE'),
  validate({ params: fineIdParamSchema, body: fineUpdateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, fineIdParamSchema);
    const body = validated.body(req, fineUpdateSchema);
    const fine = await finance.updateFine(principal, id, body);
    sendOk(res, { fine: finance.toFineDto(fine) }, { message: 'Fine updated' });
  }),
);

finesRouter.post(
  '/:id/waive',
  requireAuth(),
  requirePermission('FINE_WAIVE'),
  validate({ params: fineIdParamSchema, body: fineWaiveSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, fineIdParamSchema);
    const body = validated.body(req, fineWaiveSchema);
    const fine = await finance.waiveFine(principal, id, body);
    sendOk(res, { fine: finance.toFineDto(fine) }, { message: 'Fine waived' });
  }),
);

paymentsRouter.get(
  '/',
  requireAuth(),
  requirePermission('PAYMENT_VIEW', 'PAYMENT_VIEW_OWN'),
  validate({ query: paymentListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, paymentListQuerySchema);
    const { payments, total } = await finance.listPayments(principal, {
      fineId: query.fineId,
      memberId: query.memberId,
      branchId: query.branchId,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });

    sendPaginated(res, payments.map(finance.toPaymentDto), {
      ...parsePagination(req.query as Record<string, unknown>),
      total,
    });
  }),
);

paymentsRouter.get(
  '/:id/receipt',
  requireAuth(),
  requirePermission('PAYMENT_VIEW', 'PAYMENT_VIEW_OWN'),
  validate({ params: paymentIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, paymentIdParamSchema);
    const payment = await finance.getPayment(principal, id);
    sendOk(res, { payment: finance.toPaymentDto(payment) });
  }),
);

paymentsRouter.post(
  '/',
  requireAuth(),
  requirePermission('PAYMENT_CREATE'),
  validate({ body: paymentCreateSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const body = validated.body(req, paymentCreateSchema);
    const payment = await finance.createPayment(principal, body);
    sendCreated(res, { payment: finance.toPaymentDto(payment) });
  }),
);

paymentsRouter.post(
  '/:id/void',
  requireAuth(),
  requirePermission('PAYMENT_VOID'),
  validate({ params: paymentIdParamSchema, body: paymentVoidSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, paymentIdParamSchema);
    const body = validated.body(req, paymentVoidSchema);
    const payment = await finance.voidPayment(principal, id, body);
    sendOk(res, { payment: finance.toPaymentDto(payment) }, { message: 'Payment voided' });
  }),
);

paymentsRouter.get(
  '/:id',
  requireAuth(),
  requirePermission('PAYMENT_VIEW', 'PAYMENT_VIEW_OWN'),
  validate({ params: paymentIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, paymentIdParamSchema);
    const payment = await finance.getPayment(principal, id);
    sendOk(res, { payment: finance.toPaymentDto(payment) });
  }),
);
