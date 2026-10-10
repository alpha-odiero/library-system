import type { LoanStatusDto, ReservationStatusDto } from '@lms/shared';
import type { Paginated } from '../../lib/api';
import { api } from '../../lib/api';

/**
 * Loans and reservations.
 *
 * A loan carries its member, its book, its copy and its branch inline. That is a
 * deliberate server-side choice, not laziness: every loan list in this product is
 * read alongside who the loan belongs to and what was borrowed, and a client that
 * had to join three more collections to render a table would be a client issuing
 * N+1 requests the moment a page showed twenty rows.
 *
 * Money is never involved here, but the same rule applies to the dates: `dueDate`
 * and `returnedAt` are ISO instants from the server, formatted in the library's
 * timezone by `lib/format.ts`. Not by the browser's.
 */

export interface LoanPersonDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface LoanDto {
  id: string;
  bookId: string;
  copyId: string;
  memberId: string;
  branchId: string;
  issue: { byUserId: string; at: string };
  dueDate: string;
  graceUntil: string | null;
  returnedAt: string | null;
  status: LoanStatusDto;
  renewalCount: number;
  lastRenewedAt: string | null;
  notes: string | null;
  book: { id: string; title: string; isbn13: string | null; isbn10: string | null };
  copy: {
    id: string;
    accessionNumber: string;
    barcode: string | null;
    status: string;
    condition: string;
    branch: { id: string; code: string; name: string };
  };
  member: {
    id: string;
    membershipNumber: string;
    status: string;
    user: LoanPersonDto | null;
  };
  branch: { id: string; code: string; name: string };
  issuedBy: LoanPersonDto | null;
  returnedBy: LoanPersonDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationDto {
  id: string;
  bookId: string;
  memberId: string;
  branchId: string;
  position: number;
  status: ReservationStatusDto;
  reservedAt: string;
  notifiedAt: string | null;
  readyAt: string | null;
  /** Instant the hold lapses if not collected. Null when the status makes it moot. */
  holdExpiresAt: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  book: { id: string; title: string; isbn13: string | null; isbn10: string | null };
  member: {
    id: string;
    membershipNumber: string;
    user: LoanPersonDto | null;
  };
  branch: { id: string; code: string; name: string };
  fulfilledLoan: { id: string; dueDate: string; status: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type LoanFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  memberId?: string;
  copyId?: string;
  bookId?: string;
  branchId?: string;
  status?: LoanStatusDto;
  /** Returned loans are excluded unless this is true. */
  includeReturned?: boolean;
  q?: string;
};

export type ReservationFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  memberId?: string;
  bookId?: string;
  branchId?: string;
  status?: ReservationStatusDto;
};

/* ── Loans ─────────────────────────────────────────────────────────────────── */

export function listLoans(filters: LoanFilters, signal?: AbortSignal): Promise<Paginated<LoanDto>> {
  return api.get<LoanDto[]>('/loans', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<LoanDto>>;
}

export function getLoan(id: string, signal?: AbortSignal) {
  return api.get<{ loan: LoanDto }>(`/loans/${id}`, signal ? { signal } : {});
}

export interface LoanIssueInput {
  memberId: string;
  copyId: string;
  branchId?: string;
  notes?: string | null;
}

export interface LoanReturnInput {
  condition?: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'DAMAGED';
  notes?: string | null;
}

export function issueLoan(input: LoanIssueInput) {
  return api.post<{ loan: LoanDto }>('/loans', input);
}

export function returnLoan(id: string, input: LoanReturnInput = {}) {
  return api.post<{ loan: LoanDto }>(`/loans/${id}/return`, input);
}

export function renewLoan(id: string, reason?: string | null) {
  return api.post<{ loan: LoanDto }>(`/loans/${id}/renew`, reason ? { reason } : {});
}

/* ── Reservations ──────────────────────────────────────────────────────────── */

export function listReservations(
  filters: ReservationFilters,
  signal?: AbortSignal,
): Promise<Paginated<ReservationDto>> {
  return api.get<ReservationDto[]>('/reservations', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<ReservationDto>>;
}

export function cancelReservation(id: string) {
  return api.delete<void>(`/reservations/${id}`);
}

/* ── Presentation maps ─────────────────────────────────────────────────────── */

export const LOAN_STATUS_LABELS: Record<LoanStatusDto, string> = {
  ACTIVE: 'Active',
  RETURNED: 'Returned',
  OVERDUE: 'Overdue',
  LOST: 'Lost',
  DAMAGED: 'Damaged',
};

export const LOAN_STATUS_FILTERS: readonly { value: LoanStatusDto; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'LOST', label: 'Lost' },
  { value: 'DAMAGED', label: 'Damaged' },
];

export const RESERVATION_STATUS_LABELS: Record<ReservationStatusDto, string> = {
  ACTIVE: 'Active',
  READY: 'Ready',
  FULFILLED: 'Fulfilled',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export const RESERVATION_STATUS_FILTERS: readonly { value: ReservationStatusDto; label: string }[] =
  [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'READY', label: 'Ready' },
    { value: 'FULFILLED', label: 'Fulfilled' },
    { value: 'CANCELLED', label: 'Cancelled' },
    { value: 'EXPIRED', label: 'Expired' },
  ];

/**
 * "Borrowed" or "Returned" — what happened, not what the row currently is.
 *
 * A circulation table that says the same word in its Type column for a book going
 * out and a book coming back tells the reader nothing, and the reference to "Type"
 * in most circulation reports means the movement. `returnedAt` is the fact, not
 * `status`, because a loan can be `RETURNED` and still be the newest row.
 */
export function loanMovement(loan: LoanDto): 'Borrowed' | 'Returned' | 'Renewed' {
  if (loan.returnedAt) return 'Returned';
  if (loan.lastRenewedAt && loan.renewalCount > 0) return 'Renewed';
  return 'Borrowed';
}
