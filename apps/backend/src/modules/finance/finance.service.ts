import type { FineStatus, FineType, PaymentMethod } from '@prisma/client';
import { type Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { SORTABLE_FIELDS } from '../../config/constants.js';
import { invalidOperation, notFound, conflict } from '../../lib/errors.js';
import { publishRealtime } from '../../lib/events.js';
import { moneyFromInput, sumMoney, toMoneyString, type Money } from '../../lib/money.js';
import { orderBy, skipTake, type PaginationQuery } from '../../lib/pagination.js';
import type { AuthPrincipal } from '@lms/shared';

/** Announces a finance change so every connected client refetches. */
function announce(action: string, entityId?: string): void {
  publishRealtime({
    channel: 'finance',
    action,
    entityId,
    occurredAt: new Date().toISOString(),
  });
}

const FINE_SELECT = {
  id: true,
  reference: true,
  memberId: true,
  loanId: true,
  type: true,
  amount: true,
  waivedAmount: true,
  status: true,
  description: true,
  daysOverdue: true,
  assessedAt: true,
  dueDate: true,
  waivedAt: true,
  waivedBy: true,
  waiverReason: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  member: {
    select: {
      id: true,
      membershipNumber: true,
      status: true,
      homeBranchId: true,
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  },
  loan: {
    select: {
      id: true,
      status: true,
      dueDate: true,
      branchId: true,
      member: { select: { id: true, membershipNumber: true } },
    },
  },
  waivedByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
  createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
  payments: {
    select: {
      id: true,
      amount: true,
      receiptNumber: true,
      method: true,
      paidAt: true,
      voidedAt: true,
      receivedBy: true,
      branchId: true,
    },
  },
} satisfies Prisma.FineSelect;

const PAYMENT_SELECT = {
  id: true,
  fineId: true,
  receiptNumber: true,
  amount: true,
  method: true,
  reference: true,
  paidAt: true,
  receivedBy: true,
  branchId: true,
  notes: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  createdAt: true,
  fine: {
    select: {
      id: true,
      reference: true,
      amount: true,
      waivedAmount: true,
      memberId: true,
      status: true,
      member: {
        select: { id: true, membershipNumber: true, user: { select: { id: true, email: true } } },
      },
    },
  },
  receivedByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
  voidedByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
  branch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.FinePaymentSelect;

function scopeFineWhere(
  principal: AuthPrincipal,
  base: Prisma.FineWhereInput = {},
): Prisma.FineWhereInput {
  const allowed = principal.branchScope ? [...principal.branchScope] : null;
  if (!allowed || allowed.length === 0) {
    return base;
  }

  return {
    ...base,
    OR: [{ member: { homeBranchId: { in: allowed } } }, { loan: { branchId: { in: allowed } } }],
  };
}

function scopePaymentWhere(
  principal: AuthPrincipal,
  base: Prisma.FinePaymentWhereInput = {},
): Prisma.FinePaymentWhereInput {
  const allowed = principal.branchScope ? [...principal.branchScope] : null;
  if (!allowed || allowed.length === 0) {
    return base;
  }

  return {
    ...base,
    OR: [
      { fine: { member: { homeBranchId: { in: allowed } } } },
      { branchId: { in: allowed } },
      { fine: { loan: { branchId: { in: allowed } } } },
    ],
  };
}

function nextFineStatus(
  amount: Money,
  waivedAmount: Money,
  paidTotal: Money,
): 'OUTSTANDING' | 'PARTIAL' | 'PAID' | 'WAIVED' {
  const outstanding = amount.minus(waivedAmount).minus(paidTotal);
  if (outstanding.lte(0)) return 'PAID';
  if (paidTotal.gt(0) || waivedAmount.gt(0)) return 'PARTIAL';
  return 'OUTSTANDING';
}

export function toFineDto(fine: Prisma.FineGetPayload<{ select: typeof FINE_SELECT }>) {
  return {
    id: fine.id,
    reference: fine.reference,
    memberId: fine.memberId,
    loanId: fine.loanId,
    type: fine.type,
    amount: toMoneyString(fine.amount),
    waivedAmount: toMoneyString(fine.waivedAmount),
    status: fine.status,
    description: fine.description,
    daysOverdue: fine.daysOverdue,
    assessedAt: fine.assessedAt.toISOString(),
    dueDate: fine.dueDate?.toISOString() ?? null,
    waivedAt: fine.waivedAt?.toISOString() ?? null,
    waivedBy: fine.waivedBy,
    waiverReason: fine.waiverReason,
    createdBy: fine.createdBy,
    createdAt: fine.createdAt.toISOString(),
    updatedAt: fine.updatedAt.toISOString(),
    member: fine.member,
    loan: fine.loan,
    waivedByUser: fine.waivedByUser,
    createdByUser: fine.createdByUser,
    payments: fine.payments.map((payment) => ({
      id: payment.id,
      receiptNumber: payment.receiptNumber,
      amount: toMoneyString(payment.amount),
      method: payment.method,
      paidAt: payment.paidAt.toISOString(),
      voidedAt: payment.voidedAt?.toISOString() ?? null,
      receivedBy: payment.receivedBy,
      branchId: payment.branchId,
    })),
  };
}

export function toPaymentDto(
  payment: Prisma.FinePaymentGetPayload<{ select: typeof PAYMENT_SELECT }>,
) {
  return {
    id: payment.id,
    fineId: payment.fineId,
    receiptNumber: payment.receiptNumber,
    amount: toMoneyString(payment.amount),
    method: payment.method,
    reference: payment.reference,
    paidAt: payment.paidAt.toISOString(),
    receivedBy: payment.receivedBy,
    receivedByUser: payment.receivedByUser,
    branchId: payment.branchId,
    branch: payment.branch,
    notes: payment.notes,
    voidedAt: payment.voidedAt?.toISOString() ?? null,
    voidedBy: payment.voidedBy,
    voidedByUser: payment.voidedByUser,
    voidReason: payment.voidReason,
    createdAt: payment.createdAt.toISOString(),
    fine: payment.fine,
  };
}

export async function listFines(
  principal: AuthPrincipal,
  filters: {
    memberId?: string;
    loanId?: string;
    branchId?: string;
    status?: string;
    type?: string;
    pagination: PaginationQuery;
    sort?: string;
    direction?: 'asc' | 'desc';
  },
): Promise<{ fines: Prisma.FineGetPayload<{ select: typeof FINE_SELECT }>[]; total: number }> {
  const where: Prisma.FineWhereInput = {
    ...(filters.memberId ? { memberId: filters.memberId } : {}),
    ...(filters.loanId ? { loanId: filters.loanId } : {}),
    ...(filters.status ? { status: filters.status as FineStatus } : {}),
    ...(filters.type ? { type: filters.type as FineType } : {}),
    ...(filters.branchId
      ? {
          OR: [
            { member: { homeBranchId: filters.branchId } },
            { loan: { branchId: filters.branchId } },
          ],
        }
      : {}),
  };

  if (!principal.permissions.has('FINE_VIEW') && principal.memberId) {
    where.memberId = principal.memberId;
  }

  const staffScope = principal.branchScope ? [...principal.branchScope] : null;
  if (staffScope && staffScope.length > 0) {
    where.OR = [
      { member: { homeBranchId: { in: staffScope } } },
      { loan: { branchId: { in: staffScope } } },
    ];
  }

  const order = orderBy(
    ['assessedAt', 'dueDate', 'amount', 'createdAt'] as const,
    filters.direction ?? 'desc',
    SORTABLE_FIELDS.fine,
  );

  const [fines, total] = await Promise.all([
    prisma.fine.findMany({
      where: scopeFineWhere(principal, where),
      select: FINE_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.fine.count({ where: scopeFineWhere(principal, where) }),
  ]);

  return { fines, total };
}

export async function getFine(
  principal: AuthPrincipal,
  id: string,
): Promise<Prisma.FineGetPayload<{ select: typeof FINE_SELECT }>> {
  const where: Prisma.FineWhereInput = { id };
  if (!principal.permissions.has('FINE_VIEW') && principal.memberId) {
    where.memberId = principal.memberId;
  }
  const staffScope = principal.branchScope ? [...principal.branchScope] : null;
  if (staffScope && staffScope.length > 0) {
    where.OR = [
      { member: { homeBranchId: { in: staffScope } } },
      { loan: { branchId: { in: staffScope } } },
    ];
  }

  const fine = await prisma.fine.findFirst({
    where: scopeFineWhere(principal, where),
    select: FINE_SELECT,
  });
  if (!fine) throw notFound('Fine');
  return fine;
}

export async function createFine(
  principal: AuthPrincipal,
  input: {
    memberId: string;
    loanId?: string;
    type: string;
    amount: string | number;
    description: string;
    daysOverdue?: number;
    dueDate?: string | null;
  },
): Promise<Prisma.FineGetPayload<{ select: typeof FINE_SELECT }>> {
  const member = await prisma.member.findUnique({
    where: { id: input.memberId },
    select: { id: true, status: true, homeBranchId: true },
  });

  if (!member) throw notFound('Member');

  if (input.loanId) {
    const loan = await prisma.loan.findUnique({
      where: { id: input.loanId },
      select: { id: true, memberId: true, status: true, branchId: true },
    });
    if (!loan) throw notFound('Loan');
    if (loan.memberId !== input.memberId) {
      throw invalidOperation('PAYMENT_INVALID', 'Loan does not belong to the selected member');
    }
  }

  const amount = moneyFromInput(input.amount, 'amount');
  if (amount.lte(0)) {
    throw invalidOperation('PAYMENT_INVALID', 'amount must be greater than zero');
  }

  const reference = await generateUniqueReference('FNE');

  const fine = await prisma.fine.create({
    data: {
      memberId: input.memberId,
      loanId: input.loanId ?? null,
      type: input.type as FineType,
      amount,
      status: 'OUTSTANDING',
      description: input.description,
      daysOverdue: input.daysOverdue ?? 0,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      createdBy: principal.userId,
      reference,
    },
    select: FINE_SELECT,
  });
  announce('Fine.created', fine.id);
  return fine;
}

export async function updateFine(
  principal: AuthPrincipal,
  id: string,
  input: {
    amount?: string | number;
    description?: string;
    status?: string;
    dueDate?: string | null;
  },
): Promise<Prisma.FineGetPayload<{ select: typeof FINE_SELECT }>> {
  const existing = await prisma.fine.findUnique({ where: { id }, select: FINE_SELECT });
  if (!existing) throw notFound('Fine');

  if (!principal.permissions.has('FINE_UPDATE')) {
    throw invalidOperation('PAYMENT_INVALID', 'You do not have permission to update fines');
  }

  const data: Prisma.FineUpdateInput = {};
  if (input.amount !== undefined) {
    const nextAmount = moneyFromInput(input.amount, 'amount');
    if (nextAmount.lte(0)) {
      throw invalidOperation('PAYMENT_INVALID', 'amount must be greater than zero');
    }
    data.amount = nextAmount;
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.status !== undefined) data.status = input.status as FineStatus;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;

  const fine = await prisma.fine.update({ where: { id }, data, select: FINE_SELECT });
  announce('Fine.updated', fine.id);
  return fine;
}

export async function waiveFine(
  principal: AuthPrincipal,
  id: string,
  input: { amount: string | number; reason: string },
): Promise<Prisma.FineGetPayload<{ select: typeof FINE_SELECT }>> {
  const fine = await prisma.fine.findUnique({ where: { id }, select: FINE_SELECT });
  if (!fine) throw notFound('Fine');

  const waiveAmount = moneyFromInput(input.amount, 'amount');
  if (waiveAmount.lte(0)) {
    throw invalidOperation('PAYMENT_INVALID', 'amount must be greater than zero');
  }
  if (fine.waivedAmount.plus(waiveAmount).gt(fine.amount)) {
    throw invalidOperation('FINE_NOT_WAIVABLE', 'Waiver exceeds the original fine amount');
  }

  const nextWaived = fine.waivedAmount.plus(waiveAmount);
  const calculatedStatus = nextWaived.eq(fine.amount) ? 'WAIVED' : 'PARTIAL';

  const waived = await prisma.fine.update({
    where: { id },
    data: {
      waivedAmount: nextWaived,
      waivedBy: principal.userId,
      waiverReason: input.reason,
      waivedAt: new Date(),
      status: calculatedStatus,
    },
    select: FINE_SELECT,
  });
  announce('Fine.waived', waived.id);
  return waived;
}

export async function listPayments(
  principal: AuthPrincipal,
  filters: {
    fineId?: string;
    memberId?: string;
    branchId?: string;
    pagination: PaginationQuery;
    sort?: string;
    direction?: 'asc' | 'desc';
  },
): Promise<{
  payments: Prisma.FinePaymentGetPayload<{ select: typeof PAYMENT_SELECT }>[];
  total: number;
}> {
  const where: Prisma.FinePaymentWhereInput = {
    ...(filters.fineId ? { fineId: filters.fineId } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
  };

  if (filters.memberId) {
    where.fine = { memberId: filters.memberId };
  }

  if (!principal.permissions.has('PAYMENT_VIEW') && principal.memberId) {
    where.fine = { memberId: principal.memberId };
  }

  const staffScope = principal.branchScope ? [...principal.branchScope] : null;
  if (staffScope && staffScope.length > 0) {
    where.OR = [
      { fine: { member: { homeBranchId: { in: staffScope } } } },
      { branchId: { in: staffScope } },
      { fine: { loan: { branchId: { in: staffScope } } } },
    ];
  }

  const order = orderBy(
    ['paidAt', 'amount', 'createdAt'] as const,
    filters.direction ?? 'desc',
    SORTABLE_FIELDS.payment,
  );

  const [payments, total] = await Promise.all([
    prisma.finePayment.findMany({
      where: scopePaymentWhere(principal, where),
      select: PAYMENT_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.finePayment.count({ where: scopePaymentWhere(principal, where) }),
  ]);

  return { payments, total };
}

export async function getPayment(
  principal: AuthPrincipal,
  id: string,
): Promise<Prisma.FinePaymentGetPayload<{ select: typeof PAYMENT_SELECT }>> {
  const where: Prisma.FinePaymentWhereInput = { id };
  if (!principal.permissions.has('PAYMENT_VIEW') && principal.memberId) {
    where.fine = { memberId: principal.memberId };
  }
  const staffScope = principal.branchScope ? [...principal.branchScope] : null;
  if (staffScope && staffScope.length > 0) {
    where.OR = [
      { fine: { member: { homeBranchId: { in: staffScope } } } },
      { branchId: { in: staffScope } },
      { fine: { loan: { branchId: { in: staffScope } } } },
    ];
  }

  const payment = await prisma.finePayment.findFirst({
    where: scopePaymentWhere(principal, where),
    select: PAYMENT_SELECT,
  });
  if (!payment) throw notFound('Payment');
  return payment;
}

export async function createPayment(
  principal: AuthPrincipal,
  input: {
    fineId: string;
    amount: string | number;
    method: string;
    reference?: string | null;
    notes?: string | null;
    branchId?: string | null;
  },
): Promise<Prisma.FinePaymentGetPayload<{ select: typeof PAYMENT_SELECT }>> {
  const fine = await prisma.fine.findUnique({
    where: { id: input.fineId },
    select: {
      id: true,
      amount: true,
      waivedAmount: true,
      status: true,
      memberId: true,
      payments: { where: { voidedAt: null }, select: { amount: true } },
    },
  });

  if (!fine) throw notFound('Fine');

  const amount = moneyFromInput(input.amount, 'amount');
  if (amount.lte(0)) {
    throw invalidOperation('PAYMENT_INVALID', 'amount must be greater than zero');
  }

  const paidTotal = sumMoney(fine.payments.map((payment) => payment.amount));
  const remaining = fine.amount.minus(fine.waivedAmount).minus(paidTotal);
  if (amount.gt(remaining)) {
    throw invalidOperation('FINE_OVERPAYMENT', 'Payment exceeds the outstanding balance');
  }

  const receiptNumber = await generateUniqueReference('RCPT');
  const payment = await prisma.finePayment.create({
    data: {
      fineId: input.fineId,
      receiptNumber,
      amount,
      method: input.method as PaymentMethod,
      reference: input.reference ?? null,
      receivedBy: principal.userId,
      branchId: input.branchId ?? null,
      notes: input.notes ?? null,
    },
    select: PAYMENT_SELECT,
  });

  const updatedTotal = sumMoney(fine.payments.map((row) => row.amount).concat(amount));
  const nextStatus = nextFineStatus(fine.amount, fine.waivedAmount, updatedTotal);

  await prisma.fine.update({
    where: { id: input.fineId },
    data: { status: nextStatus },
  });

  announce('Payment.created', payment.id);
  return payment;
}

export async function voidPayment(
  principal: AuthPrincipal,
  id: string,
  input: { reason: string },
): Promise<Prisma.FinePaymentGetPayload<{ select: typeof PAYMENT_SELECT }>> {
  const payment = await prisma.finePayment.findUnique({ where: { id }, select: PAYMENT_SELECT });
  if (!payment) throw notFound('Payment');
  if (payment.voidedAt) {
    throw conflict('PAYMENT_ALREADY_VOIDED', 'Payment has already been voided');
  }

  const voided = await prisma.finePayment.update({
    where: { id },
    data: {
      voidedAt: new Date(),
      voidedBy: principal.userId,
      voidReason: input.reason,
    },
    select: PAYMENT_SELECT,
  });

  const payments = await prisma.finePayment.findMany({
    where: { fineId: payment.fineId, voidedAt: null },
    select: { amount: true },
  });
  const totalPaid = sumMoney(payments.map((entry) => entry.amount));
  const fine = await prisma.fine.findUnique({
    where: { id: payment.fineId },
    select: { amount: true, waivedAmount: true },
  });
  if (!fine) throw notFound('Fine');

  const nextStatus = nextFineStatus(fine.amount, fine.waivedAmount, totalPaid);

  await prisma.fine.update({ where: { id: payment.fineId }, data: { status: nextStatus } });

  announce('Payment.voided', voided.id);
  return voided;
}

async function generateUniqueReference(prefix: 'FNE' | 'RCPT'): Promise<string> {
  const year = new Date().getUTCFullYear();
  let candidate = `${prefix}-${year}-${String(Math.floor(Math.random() * 900000) + 100000)}`;
  while (true) {
    const table = prefix === 'FNE' ? 'fine' : 'finePayment';
    const existing =
      table === 'fine'
        ? await prisma.fine.findUnique({ where: { reference: candidate }, select: { id: true } })
        : await prisma.finePayment.findUnique({
            where: { receiptNumber: candidate },
            select: { id: true },
          });
    if (!existing) return candidate;
    candidate = `${prefix}-${year}-${String(Math.floor(Math.random() * 900000) + 100000)}`;
  }
}
