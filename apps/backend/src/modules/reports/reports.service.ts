import type { AuthPrincipal } from '@lms/shared';
import { prisma } from '../../config/database.js';
import { money, toMoneyString, zero, type Money } from '../../lib/money.js';
import { branchScopeFilter, branchScopeFilterPath } from '../../middleware/scope.js';

/**
 * Reports.
 *
 * Every figure here is a live count from the database — there are no stored
 * summaries and no snapshots, so a report can never disagree with the screens
 * next to it. The dashboard already composes list endpoints per-permission; this
 * module is the one place where an administrator (or a librarian) asks for the
 * same numbers in aggregate, behind `REPORT_VIEW` / `REPORT_VIEW_FINANCIAL`.
 *
 * Scope follows the caller: `branchScopeFilter` produces `{}` for an
 * all-branch principal (ADMIN) and an `IN` clause for a branch-scoped one, so a
 * librarian's report is limited to the desks they are assigned to.
 */

interface StatusCount {
  status: string;
  _count: { _all: number };
}

function statusCounts(rows: readonly StatusCount[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.status] = row._count._all;
  return out;
}

function totalOf(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

/* ── Library summary ────────────────────────────────────────────────────────── */

export interface LibrarySummaryReport {
  titles: number;
  branches: number;
  copies: Record<string, number>;
  copyTotal: number;
  loans: Record<string, number>;
  members: Record<string, number>;
  reservations: Record<string, number>;
  /** Open borrow-request queue (pending + approved), for the desk. */
  requestsPending: number;
}

export async function librarySummary(principal: AuthPrincipal): Promise<LibrarySummaryReport> {
  const copyScope = branchScopeFilter(principal, 'branchId');
  const memberScope = branchScopeFilter(principal, 'homeBranchId');

  // All seven aggregates are independent; issuing them together keeps this to a
  // single round trip's worth of latency instead of a second sequential batch.
  const [copies, loans, members, reservations, requests, titles, branches] = await Promise.all([
    prisma.bookCopy.groupBy({
      by: ['status'],
      where: { ...copyScope, removedAt: null },
      _count: { _all: true },
    }),
    prisma.loan.groupBy({ by: ['status'], where: copyScope, _count: { _all: true } }),
    prisma.member.groupBy({
      by: ['status'],
      where: { ...memberScope, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.reservation.groupBy({ by: ['status'], where: copyScope, _count: { _all: true } }),
    prisma.borrowRequest.count({
      where: {
        status: { in: ['PENDING', 'APPROVED'] },
        ...(principal.libraryScope ? { libraryId: principal.libraryScope } : {}),
      },
    }),
    prisma.book.count({
      where: {
        deletedAt: null,
        archivedAt: null,
        copies: { some: { ...copyScope, removedAt: null } },
      },
    }),
    prisma.branch.count({ where: branchScopeFilter(principal, 'id') }),
  ]);

  const copyCounts = statusCounts(copies);
  const loanCounts = statusCounts(loans);

  return {
    titles,
    branches,
    copies: copyCounts,
    copyTotal: totalOf(copyCounts),
    loans: loanCounts,
    members: statusCounts(members),
    reservations: statusCounts(reservations),
    requestsPending: requests,
  };
}

/* ── Borrowing / circulation ────────────────────────────────────────────────── */

export interface CirculationReport {
  loans: Record<string, number>;
  /** Live on-loan total (ACTIVE + OVERDUE), i.e. copies currently out. */
  onLoan: number;
  overdue: number;
  reservations: Record<string, number>;
  /** The five titles that have been loans most often. */
  topBorrowed: Array<{ bookId: string; title: string; loans: number }>;
  /** Members with at least one active or overdue loan. */
  activeBorrowers: number;
}

export async function circulationReport(principal: AuthPrincipal): Promise<CirculationReport> {
  const copyScope = branchScopeFilter(principal, 'branchId');

  const [loans, reservations, topRows, activeBorrowers] = await Promise.all([
    prisma.loan.groupBy({ by: ['status'], where: copyScope, _count: { _all: true } }),
    prisma.reservation.groupBy({ by: ['status'], where: copyScope, _count: { _all: true } }),
    prisma.loan.groupBy({
      by: ['bookId'],
      where: { status: { in: ['ACTIVE', 'OVERDUE', 'RETURNED'] }, ...copyScope },
      _count: { bookId: true },
      orderBy: { _count: { bookId: 'desc' } },
      take: 5,
    }),
    // Distinct member ids rather than a group-by: we only need the count of
    // borrowers, so SELECT DISTINCT avoids materialising a per-member tally the
    // caller throws away.
    prisma.loan.findMany({
      where: { status: { in: ['ACTIVE', 'OVERDUE'] }, ...copyScope },
      select: { memberId: true },
      distinct: ['memberId'],
    }),
  ]);

  const loanCounts = statusCounts(loans);
  const onLoan = (loanCounts['ACTIVE'] ?? 0) + (loanCounts['OVERDUE'] ?? 0);

  const ids = topRows.map((row) => row.bookId);
  const books = await prisma.book.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true },
  });
  const titleById = new Map(books.map((book) => [book.id, book.title]));

  return {
    loans: loanCounts,
    onLoan,
    overdue: loanCounts['OVERDUE'] ?? 0,
    reservations: statusCounts(reservations),
    topBorrowed: topRows.map((row) => ({
      bookId: row.bookId,
      title: titleById.get(row.bookId) ?? 'Unknown title',
      loans: row._count.bookId,
    })),
    activeBorrowers: activeBorrowers.length,
  };
}

/* ── Finance ────────────────────────────────────────────────────────────────── */

export interface FinancialReport {
  /** Sum of every assessed fine (nothing in finance is ever deleted). */
  assessed: string;
  /** Sum of amounts waived by staff. */
  waived: string;
  /** Sum of non-voided payments received. */
  collected: string;
  /** assessed − waived − collected, floored at zero. */
  outstanding: string;
  /** Fines still open at all (OUTSTANDING or PARTIAL). */
  openFines: number;
}

export async function financialReport(principal: AuthPrincipal): Promise<FinancialReport> {
  const fineScope = branchScopeFilterPath(principal, 'member.homeBranchId');

  const [assessed, waived, payments, openFines] = await Promise.all([
    prisma.fine.aggregate({ where: fineScope, _sum: { amount: true } }),
    prisma.fine.aggregate({ where: fineScope, _sum: { waivedAmount: true } }),
    prisma.finePayment.aggregate({
      where: { voidedAt: null, ...branchScopeFilter(principal, 'branchId') },
      _sum: { amount: true },
    }),
    prisma.fine.count({ where: { ...fineScope, status: { in: ['OUTSTANDING', 'PARTIAL'] } } }),
  ]);

  const assessedMoney: Money = money(assessed._sum.amount ?? 0);
  const waivedMoney: Money = money(waived._sum.waivedAmount ?? 0);
  const paidMoney: Money = money(payments._sum.amount ?? 0);

  let outstanding = assessedMoney.minus(waivedMoney).minus(paidMoney);
  if (outstanding.isNegative()) outstanding = zero();

  return {
    assessed: toMoneyString(assessedMoney),
    waived: toMoneyString(waivedMoney),
    collected: toMoneyString(paidMoney),
    outstanding: toMoneyString(outstanding),
    openFines,
  };
}
