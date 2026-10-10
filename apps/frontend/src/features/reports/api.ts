import { api } from '../../lib/api';

/**
 * Reports — the aggregate view of the library's numbers.
 *
 * Response shapes are declared here because the backend assembles them inline in
 * `reports.service.ts` (live counts, no stored snapshots). Money fields arrive
 * as decimal *strings* — see `lib/format.ts` on why JSON numbers cannot carry
 * them — and every count is scoped server-side to the caller's branch.
 */

export interface LibrarySummaryReport {
  /** Catalogue titles with at least one non-removed copy in scope. */
  titles: number;
  branches: number;
  copies: Record<string, number>;
  copyTotal: number;
  loans: Record<string, number>;
  members: Record<string, number>;
  reservations: Record<string, number>;
  /** Open borrow-request queue (pending + approved). */
  requestsPending: number;
}

export interface CirculationReport {
  loans: Record<string, number>;
  /** Copies currently out (ACTIVE + OVERDUE). */
  onLoan: number;
  overdue: number;
  reservations: Record<string, number>;
  topBorrowed: Array<{ bookId: string; title: string; loans: number }>;
  /** Members with at least one active or overdue loan. */
  activeBorrowers: number;
}

export interface FinancialReport {
  assessed: string;
  waived: string;
  collected: string;
  outstanding: string;
  openFines: number;
}

export function getLibrarySummary(signal?: AbortSignal) {
  return api.get<{ report: LibrarySummaryReport }>('/reports/summary', {
    ...(signal ? { signal } : {}),
  });
}

export function getCirculationReport(signal?: AbortSignal) {
  return api.get<{ report: CirculationReport }>('/reports/circulation', {
    ...(signal ? { signal } : {}),
  });
}

export function getFinancialReport(signal?: AbortSignal) {
  return api.get<{ report: FinancialReport }>('/reports/financial', {
    ...(signal ? { signal } : {}),
  });
}
