import type { Prisma, ReservationStatus } from '@prisma/client';
import { LoanStatus, type CopyCondition, type CopyStatus } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma, withTransaction } from '../../config/database.js';
import { SORTABLE_FIELDS } from '../../config/constants.js';
import { addCalendarDays } from '../../lib/dates.js';
import { conflict, notFound } from '../../lib/errors.js';
import { publishRealtime } from '../../lib/events.js';
import { orderBy, skipTake, type PaginationQuery } from '../../lib/pagination.js';
import { branchScopeFilter, assertRequestedBranchAllowed } from '../../middleware/scope.js';
import type { AuthPrincipal } from '@lms/shared';
import { actorFromPrincipal, recordAudit } from '../audit/audit.service.js';
import { messages, notifyMember } from '../notifications/notification.service.js';

/** Announces a circulation change so every connected client refetches. */
function announce(action: string, entityId?: string): void {
  publishRealtime({
    channel: 'circulation',
    action,
    entityId,
    occurredAt: new Date().toISOString(),
  });
}

const LOAN_SELECT = {
  id: true,
  copyId: true,
  bookId: true,
  memberId: true,
  branchId: true,
  issuedBy: true,
  memberTypeId: true,
  loanedAt: true,
  dueDate: true,
  graceUntil: true,
  returnedAt: true,
  returnedBy: true,
  status: true,
  renewalCount: true,
  lastRenewedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  copy: {
    select: {
      id: true,
      accessionNumber: true,
      barcode: true,
      status: true,
      condition: true,
      book: { select: { id: true, title: true, isbn13: true, isbn10: true } },
      branch: { select: { id: true, code: true, name: true } },
    },
  },
  book: { select: { id: true, title: true, isbn13: true, isbn10: true } },
  member: {
    select: {
      id: true,
      membershipNumber: true,
      status: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  },
  branch: { select: { id: true, code: true, name: true } },
  issuedByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
  returnedByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
  memberType: {
    select: {
      id: true,
      code: true,
      name: true,
      maxActiveLoans: true,
      loanDurationDays: true,
      gracePeriodDays: true,
      maxRenewals: true,
    },
  },
} satisfies Prisma.LoanSelect;

const RESERVATION_SELECT = {
  id: true,
  bookId: true,
  memberId: true,
  branchId: true,
  position: true,
  status: true,
  reservedAt: true,
  notifiedAt: true,
  readyAt: true,
  holdExpiresAt: true,
  fulfilledAt: true,
  fulfilledLoanId: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  book: { select: { id: true, title: true, isbn13: true, isbn10: true } },
  member: {
    select: {
      id: true,
      membershipNumber: true,
      status: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  },
  branch: { select: { id: true, code: true, name: true } },
  fulfilledLoan: { select: { id: true, dueDate: true, status: true } },
} satisfies Prisma.ReservationSelect;

export function toLoanDto(loan: Prisma.LoanGetPayload<{ select: typeof LOAN_SELECT }>) {
  return {
    id: loan.id,
    bookId: loan.bookId,
    copyId: loan.copyId,
    memberId: loan.memberId,
    branchId: loan.branchId,
    issue: {
      byUserId: loan.issuedBy,
      at: loan.loanedAt.toISOString(),
    },
    dueDate: loan.dueDate.toISOString(),
    graceUntil: loan.graceUntil?.toISOString() ?? null,
    returnedAt: loan.returnedAt?.toISOString() ?? null,
    status: loan.status,
    renewalCount: loan.renewalCount,
    lastRenewedAt: loan.lastRenewedAt?.toISOString() ?? null,
    notes: loan.notes,
    book: loan.book,
    copy: {
      id: loan.copy.id,
      accessionNumber: loan.copy.accessionNumber,
      barcode: loan.copy.barcode,
      status: loan.copy.status,
      condition: loan.copy.condition,
      branch: loan.copy.branch,
    },
    member: loan.member,
    branch: loan.branch,
    memberType: loan.memberType,
    issuedBy: loan.issuedByUser,
    returnedBy: loan.returnedByUser,
    createdAt: loan.createdAt.toISOString(),
    updatedAt: loan.updatedAt.toISOString(),
  };
}

export function toReservationDto(
  reservation: Prisma.ReservationGetPayload<{ select: typeof RESERVATION_SELECT }>,
) {
  return {
    id: reservation.id,
    bookId: reservation.bookId,
    memberId: reservation.memberId,
    branchId: reservation.branchId,
    position: reservation.position,
    status: reservation.status,
    reservedAt: reservation.reservedAt.toISOString(),
    notifiedAt: reservation.notifiedAt?.toISOString() ?? null,
    readyAt: reservation.readyAt?.toISOString() ?? null,
    holdExpiresAt: reservation.holdExpiresAt?.toISOString() ?? null,
    fulfilledAt: reservation.fulfilledAt?.toISOString() ?? null,
    cancelledAt: reservation.cancelledAt?.toISOString() ?? null,
    cancelReason: reservation.cancelReason,
    book: reservation.book,
    member: reservation.member,
    branch: reservation.branch,
    fulfilledLoan: reservation.fulfilledLoan,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

export async function listLoans(
  principal: AuthPrincipal,
  filters: {
    memberId?: string;
    copyId?: string;
    bookId?: string;
    branchId?: string;
    status?: string;
    includeReturned?: boolean;
    pagination: PaginationQuery;
    sort?: string;
    direction?: 'asc' | 'desc';
  },
): Promise<{ loans: Prisma.LoanGetPayload<{ select: typeof LOAN_SELECT }>[]; total: number }> {
  const where: Prisma.LoanWhereInput = {
    ...branchScopeFilter(principal, 'branchId'),
    ...(filters.memberId ? { memberId: filters.memberId } : {}),
    ...(filters.copyId ? { copyId: filters.copyId } : {}),
    ...(filters.bookId ? { bookId: filters.bookId } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.status ? { status: filters.status as LoanStatus } : {}),
    ...(filters.includeReturned ? {} : { returnedAt: null }),
  };

  if (!principal.permissions.has('LOAN_VIEW') && principal.memberId) {
    where.memberId = principal.memberId;
  }

  const order = orderBy(
    ['loanedAt', 'dueDate', 'createdAt', 'returnedAt'] as const,
    filters.direction ?? 'desc',
    SORTABLE_FIELDS.loan,
  );

  const [loans, total] = await Promise.all([
    prisma.loan.findMany({
      where,
      select: LOAN_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.loan.count({ where }),
  ]);

  return { loans, total };
}

export async function getLoan(
  principal: AuthPrincipal,
  id: string,
): Promise<Prisma.LoanGetPayload<{ select: typeof LOAN_SELECT }>> {
  const where: Prisma.LoanWhereInput = {
    id,
    ...branchScopeFilter(principal, 'branchId'),
  };

  if (!principal.permissions.has('LOAN_VIEW') && principal.memberId) {
    where.memberId = principal.memberId;
  }

  const loan = await prisma.loan.findFirst({ where, select: LOAN_SELECT });
  if (!loan) throw notFound('Loan');
  return loan;
}

export async function issueLoan(
  principal: AuthPrincipal,
  input: { memberId: string; copyId: string; branchId?: string; notes?: string | null },
): Promise<Prisma.LoanGetPayload<{ select: typeof LOAN_SELECT }>> {
  const member = await prisma.member.findUnique({
    where: { id: input.memberId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      homeBranchId: true,
      memberType: {
        select: {
          id: true,
          maxActiveLoans: true,
          loanDurationDays: true,
          gracePeriodDays: true,
          maxRenewals: true,
        },
      },
    },
  });

  if (!member) throw notFound('Member');
  if (member.status !== 'ACTIVE') throw conflict('MEMBER_INACTIVE', 'Member is not active');
  if (member.expiresAt && member.expiresAt.getTime() <= Date.now()) {
    throw conflict('MEMBERSHIP_EXPIRED', 'Membership has expired');
  }

  const copy = await prisma.bookCopy.findUnique({
    where: { id: input.copyId },
    select: {
      id: true,
      status: true,
      branchId: true,
      bookId: true,
      book: { select: { id: true, title: true, isReferenceOnly: true } },
      condition: true,
    },
  });

  if (!copy) throw notFound('Copy');
  if (copy.status !== 'AVAILABLE')
    throw conflict('COPY_NOT_AVAILABLE', 'Copy is not available for loan');
  if (copy.book.isReferenceOnly)
    throw conflict('BOOK_NOT_LOANABLE', 'This title cannot be borrowed');

  const branchId = input.branchId ?? copy.branchId;
  assertRequestedBranchAllowed(principal, branchId);

  const activeLoanCount = await prisma.loan.count({
    where: {
      memberId: member.id,
      returnedAt: null,
      status: { in: ['ACTIVE', 'OVERDUE'] },
    },
  });

  if (activeLoanCount >= member.memberType.maxActiveLoans) {
    throw conflict('LOAN_LIMIT_REACHED', 'Member has reached the active loan limit');
  }

  const dueDate = addCalendarDays(new Date(), member.memberType.loanDurationDays, env.TIMEZONE);

  return withTransaction(async (tx) => {
    const loan = await tx.loan.create({
      data: {
        copyId: copy.id,
        bookId: copy.bookId,
        memberId: member.id,
        branchId,
        issuedBy: principal.userId,
        memberTypeId: member.memberType.id,
        dueDate,
        graceUntil: addCalendarDays(dueDate, member.memberType.gracePeriodDays, env.TIMEZONE),
        status: LoanStatus.ACTIVE,
        notes: input.notes ?? null,
      },
      select: LOAN_SELECT,
    });

    await tx.bookCopy.update({
      where: { id: copy.id },
      data: { status: 'BORROWED' as CopyStatus },
    });

    await tx.loanStatusHistory.create({
      data: {
        loanId: loan.id,
        toStatus: LoanStatus.ACTIVE,
        reason: 'Loan issued',
        changedBy: principal.userId,
      },
    });

    await tx.copyStatusHistory.create({
      data: {
        copyId: copy.id,
        fromStatus: copy.status,
        toStatus: 'BORROWED' as CopyStatus,
        reason: 'Loan issued',
        changedBy: principal.userId,
      },
    });

    await recordAudit({
      action: 'LOAN_CREATED',
      entityType: 'loan',
      entityId: loan.id,
      description: 'Loan issued to member',
      actor: actorFromPrincipal(principal),
      before: undefined,
      after: { memberId: member.id, copyId: copy.id, dueDate: dueDate.toISOString() },
    });

    // In the member's own transaction so a failed issue never leaves a "your
    // book is due" notice behind.
    const loanMessage = messages.loanCreated(copy.book.title, dueDate.toISOString().slice(0, 10));
    await notifyMember(
      {
        memberId: member.id,
        type: 'GENERAL',
        title: loanMessage.title,
        message: loanMessage.message,
        data: { loanId: loan.id, dueDate: dueDate.toISOString() },
        actionUrl: '/loans',
      },
      tx,
    );

    return tx.loan.findUniqueOrThrow({ where: { id: loan.id }, select: LOAN_SELECT });
  }).then((issued) => {
    announce('Loan.issued', issued.id);
    return issued;
  });
}

export async function returnLoan(
  principal: AuthPrincipal,
  id: string,
  input: { condition?: keyof typeof CopyCondition | null; notes?: string | null },
): Promise<Prisma.LoanGetPayload<{ select: typeof LOAN_SELECT }>> {
  const loan = await prisma.loan.findFirst({
    where: { id, ...branchScopeFilter(principal, 'branchId') },
    select: {
      ...LOAN_SELECT,
      copy: { select: { id: true, status: true, condition: true } },
    },
  });

  if (!loan) throw notFound('Loan');
  if (loan.returnedAt) throw conflict('LOAN_ALREADY_RETURNED', 'Loan has already been returned');

  const nextCondition = input.condition ? (input.condition as CopyCondition) : loan.copy.condition;

  return withTransaction(async (tx) => {
    await tx.loan.update({
      where: { id },
      data: {
        status: LoanStatus.RETURNED,
        returnedAt: new Date(),
        returnedBy: principal.userId,
        notes: input.notes ?? loan.notes,
      },
      select: LOAN_SELECT,
    });

    await tx.bookCopy.update({
      where: { id: loan.copyId },
      data: {
        status: 'AVAILABLE' as CopyStatus,
        condition: nextCondition,
      },
    });

    await tx.loanStatusHistory.create({
      data: {
        loanId: id,
        fromStatus: loan.status,
        toStatus: LoanStatus.RETURNED,
        reason: 'Loan returned',
        changedBy: principal.userId,
      },
    });

    await tx.copyStatusHistory.create({
      data: {
        copyId: loan.copyId,
        fromStatus: loan.copy.status,
        toStatus: 'AVAILABLE' as CopyStatus,
        fromCondition: loan.copy.condition,
        toCondition: nextCondition,
        reason: 'Loan returned',
        changedBy: principal.userId,
      },
    });

    await recordAudit({
      action: 'BOOK_RETURNED',
      entityType: 'loan',
      entityId: id,
      description: 'Loan returned and copy made available',
      actor: actorFromPrincipal(principal),
      before: { status: loan.status, returnedAt: loan.returnedAt },
      after: { status: 'RETURNED', returnedAt: new Date().toISOString() },
    });

    const returnMessage = messages.loanReturned(loan.book.title);
    await notifyMember(
      {
        memberId: loan.memberId,
        type: 'BOOK_RETURNED',
        title: returnMessage.title,
        message: returnMessage.message,
        data: { loanId: id, bookTitle: loan.book.title },
        actionUrl: '/loans',
      },
      tx,
    );

    return tx.loan.findUniqueOrThrow({ where: { id }, select: LOAN_SELECT });
  }).then((returned) => {
    announce('Loan.returned', returned.id);
    return returned;
  });
}

export async function renewLoan(
  principal: AuthPrincipal,
  id: string,
  input: { reason?: string | null },
): Promise<Prisma.LoanGetPayload<{ select: typeof LOAN_SELECT }>> {
  const loan = await prisma.loan.findFirst({
    where: { id, ...branchScopeFilter(principal, 'branchId') },
    select: {
      ...LOAN_SELECT,
      memberType: { select: { id: true, maxRenewals: true, loanDurationDays: true } },
    },
  });

  if (!loan) throw notFound('Loan');
  if (loan.returnedAt) throw conflict('LOAN_ALREADY_RETURNED', 'Loan has already been returned');
  if (loan.status === LoanStatus.OVERDUE)
    throw conflict('LOAN_OVERDUE', 'Overdue loans cannot be renewed');
  if (loan.status === LoanStatus.LOST || loan.status === LoanStatus.DAMAGED) {
    throw conflict('LOAN_NOT_ACTIVE', 'This loan cannot be renewed');
  }
  if (loan.renewalCount >= loan.memberType.maxRenewals) {
    throw conflict('RENEWAL_LIMIT_REACHED', 'Renewal limit reached for this member type');
  }

  const activeReservation = await prisma.reservation.findFirst({
    where: {
      bookId: loan.bookId,
      status: { in: ['ACTIVE', 'READY'] },
      NOT: { memberId: loan.memberId },
    },
  });

  if (activeReservation) {
    throw conflict('RENEWAL_BLOCKED_BY_RESERVATION', 'Another member is waiting for this title');
  }

  const newDueDate = addCalendarDays(loan.dueDate, loan.memberType.loanDurationDays, env.TIMEZONE);

  return withTransaction(async (tx) => {
    await tx.loan.update({
      where: { id },
      data: {
        dueDate: newDueDate,
        status: LoanStatus.ACTIVE,
        renewalCount: loan.renewalCount + 1,
        lastRenewedAt: new Date(),
      },
      select: LOAN_SELECT,
    });

    await tx.loanRenewal.create({
      data: {
        loanId: id,
        renewedBy: principal.userId,
        previousDueDate: loan.dueDate,
        newDueDate,
        renewalNumber: loan.renewalCount + 1,
        previousStatus: loan.status,
        reason: input.reason ?? 'Renewed by staff',
      },
    });

    await tx.loanStatusHistory.create({
      data: {
        loanId: id,
        fromStatus: loan.status,
        toStatus: LoanStatus.ACTIVE,
        reason: 'Loan renewed',
        changedBy: principal.userId,
      },
    });

    await recordAudit({
      action: 'BOOK_RENEWED',
      entityType: 'loan',
      entityId: id,
      description: 'Loan renewed',
      actor: actorFromPrincipal(principal),
      before: { status: loan.status, dueDate: loan.dueDate.toISOString() },
      after: { status: 'ACTIVE', dueDate: newDueDate.toISOString() },
    });

    const renewedMessage = messages.renewed(loan.book.title, newDueDate.toISOString().slice(0, 10));
    await notifyMember(
      {
        memberId: loan.memberId,
        type: 'GENERAL',
        title: renewedMessage.title,
        message: renewedMessage.message,
        data: { loanId: id, dueDate: newDueDate.toISOString() },
        actionUrl: '/loans',
      },
      tx,
    );

    return tx.loan.findUniqueOrThrow({ where: { id }, select: LOAN_SELECT });
  }).then((renewed) => {
    announce('Loan.renewed', renewed.id);
    return renewed;
  });
}

export async function listReservations(
  principal: AuthPrincipal,
  filters: {
    memberId?: string;
    bookId?: string;
    branchId?: string;
    status?: string;
    pagination: PaginationQuery;
    sort?: string;
    direction?: 'asc' | 'desc';
  },
): Promise<{
  reservations: Prisma.ReservationGetPayload<{ select: typeof RESERVATION_SELECT }>[];
  total: number;
}> {
  const where: Prisma.ReservationWhereInput = {
    ...branchScopeFilter(principal, 'branchId'),
    ...(filters.memberId ? { memberId: filters.memberId } : {}),
    ...(filters.bookId ? { bookId: filters.bookId } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.status ? { status: filters.status as ReservationStatus } : {}),
  };

  if (!principal.permissions.has('RESERVATION_VIEW') && principal.memberId) {
    where.memberId = principal.memberId;
  }

  const order = orderBy(
    ['reservedAt', 'position', 'holdExpiresAt', 'createdAt'] as const,
    filters.direction ?? 'desc',
    SORTABLE_FIELDS.reservation,
  );

  const [reservations, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      select: RESERVATION_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.reservation.count({ where }),
  ]);

  return { reservations, total };
}

export async function getReservation(
  principal: AuthPrincipal,
  id: string,
): Promise<Prisma.ReservationGetPayload<{ select: typeof RESERVATION_SELECT }>> {
  const where: Prisma.ReservationWhereInput = {
    id,
    ...branchScopeFilter(principal, 'branchId'),
  };

  if (!principal.permissions.has('RESERVATION_VIEW') && principal.memberId) {
    where.memberId = principal.memberId;
  }

  const reservation = await prisma.reservation.findFirst({ where, select: RESERVATION_SELECT });
  if (!reservation) throw notFound('Reservation');
  return reservation;
}

export async function createReservation(
  principal: AuthPrincipal,
  input: { memberId?: string; bookId: string; branchId?: string },
): Promise<Prisma.ReservationGetPayload<{ select: typeof RESERVATION_SELECT }>> {
  const memberId = input.memberId ?? principal.memberId;
  if (!memberId) throw notFound('Member');

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      memberType: { select: { id: true, reservationLimit: true } },
      homeBranchId: true,
    },
  });

  if (!member) throw notFound('Member');
  if (member.status !== 'ACTIVE') throw conflict('MEMBER_INACTIVE', 'Member is not active');
  if (member.expiresAt && member.expiresAt.getTime() <= Date.now()) {
    throw conflict('MEMBERSHIP_EXPIRED', 'Membership has expired');
  }

  const book = await prisma.book.findUnique({
    where: { id: input.bookId },
    select: { id: true, title: true },
  });
  if (!book) throw notFound('Book');

  const activeReservations = await prisma.reservation.count({
    where: { memberId, bookId: input.bookId, status: { in: ['ACTIVE', 'READY'] } },
  });
  if (activeReservations > 0) {
    throw conflict(
      'RESERVATION_DUPLICATE',
      'Member already has an active reservation for this title',
    );
  }

  const memberReservationCount = await prisma.reservation.count({
    where: { memberId, status: { in: ['ACTIVE', 'READY'] } },
  });
  if (memberReservationCount >= (member.memberType.reservationLimit ?? 0)) {
    throw conflict('RESERVATION_LIMIT_REACHED', 'Member has reached the reservation limit');
  }

  const position =
    (await prisma.reservation.count({
      where: { bookId: input.bookId, status: 'ACTIVE' },
    })) + 1;

  const branchId = input.branchId ?? member.homeBranchId ?? null;
  if (branchId) {
    assertRequestedBranchAllowed(principal, branchId);
  }

  return withTransaction(async (tx) => {
    const reservation = await tx.reservation.create({
      data: {
        bookId: input.bookId,
        memberId,
        branchId,
        position,
        status: 'ACTIVE',
        holdExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
      },
      select: RESERVATION_SELECT,
    });

    await recordAudit({
      action: 'RESERVATION_CREATED',
      entityType: 'reservation',
      entityId: reservation.id,
      description: 'Reservation created',
      actor: actorFromPrincipal(principal),
      after: { memberId, bookId: input.bookId, position },
    });

    const placedMessage = messages.reservationPlaced(book.title, position);
    await notifyMember(
      {
        memberId,
        type: 'GENERAL',
        title: placedMessage.title,
        message: placedMessage.message,
        data: { reservationId: reservation.id, bookTitle: book.title, position },
        actionUrl: '/reservations',
      },
      tx,
    );

    return tx.reservation.findUniqueOrThrow({
      where: { id: reservation.id },
      select: RESERVATION_SELECT,
    });
  }).then((created) => {
    announce('Reservation.created', created.id);
    return created;
  });
}

export async function cancelReservation(
  principal: AuthPrincipal,
  id: string,
  reason?: string,
): Promise<Prisma.ReservationGetPayload<{ select: typeof RESERVATION_SELECT }>> {
  const reservation = await prisma.reservation.findFirst({
    where: { id, ...branchScopeFilter(principal, 'branchId') },
    select: RESERVATION_SELECT,
  });

  if (!reservation) throw notFound('Reservation');

  return withTransaction(async (tx) => {
    await tx.reservation.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason ?? 'Cancelled by staff',
      },
      select: RESERVATION_SELECT,
    });

    await recordAudit({
      action: 'RESERVATION_CANCELLED',
      entityType: 'reservation',
      entityId: id,
      description: 'Reservation cancelled',
      actor: actorFromPrincipal(principal),
      before: { status: reservation.status },
      after: { status: 'CANCELLED' },
    });

    const cancelledMessage = messages.reservationCancelled(reservation.book.title);
    await notifyMember(
      {
        memberId: reservation.memberId,
        type: 'GENERAL',
        title: cancelledMessage.title,
        message: cancelledMessage.message,
        data: { reservationId: id, bookTitle: reservation.book.title },
        actionUrl: '/reservations',
      },
      tx,
    );

    return tx.reservation.findUniqueOrThrow({ where: { id }, select: RESERVATION_SELECT });
  }).then((cancelled) => {
    announce('Reservation.cancelled', cancelled.id);
    return cancelled;
  });
}

export async function fulfillReservation(
  principal: AuthPrincipal,
  id: string,
  input?: { copyId?: string },
): Promise<Prisma.ReservationGetPayload<{ select: typeof RESERVATION_SELECT }>> {
  const reservation = await prisma.reservation.findFirst({
    where: { id, ...branchScopeFilter(principal, 'branchId') },
    select: RESERVATION_SELECT,
  });

  if (!reservation) throw notFound('Reservation');

  const copyId = input?.copyId ?? null;
  if (copyId) {
    const copy = await prisma.bookCopy.findUnique({
      where: { id: copyId },
      select: { id: true, status: true, bookId: true },
    });
    if (!copy) throw notFound('Copy');
    if (copy.bookId !== reservation.bookId) {
      throw conflict('COPY_NOT_AVAILABLE', 'Selected copy does not match the reserved title');
    }
  }

  return withTransaction(async (tx) => {
    await tx.reservation.update({
      where: { id },
      data: {
        status: 'FULFILLED',
        readyAt: new Date(),
        fulfilledAt: new Date(),
        holdExpiresAt: null,
      },
      select: RESERVATION_SELECT,
    });

    await recordAudit({
      action: 'RESERVATION_FULFILLED',
      entityType: 'reservation',
      entityId: id,
      description: 'Reservation fulfilled',
      actor: actorFromPrincipal(principal),
      before: { status: reservation.status },
      after: { status: 'FULFILLED' },
    });

    const readyMessage = messages.reservationReady(
      reservation.book.title,
      new Date().toISOString(),
    );
    await notifyMember(
      {
        memberId: reservation.memberId,
        type: 'RESERVATION_READY',
        title: readyMessage.title,
        message: readyMessage.message,
        data: { reservationId: id, bookTitle: reservation.book.title },
        actionUrl: '/reservations',
      },
      tx,
    );

    return tx.reservation.findUniqueOrThrow({ where: { id }, select: RESERVATION_SELECT });
  }).then((fulfilled) => {
    announce('Reservation.fulfilled', fulfilled.id);
    return fulfilled;
  });
}
