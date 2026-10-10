import type { FineStatusDto, PaymentMethodDto } from '@lms/shared';
import type { Paginated } from '../../lib/api';
import { api } from '../../lib/api';

/**
 * Fines and payments.
 *
 * **Every amount is a decimal string, never a number.** `Decimal(14,2)` is exact in
 * the database and inexact the moment it becomes a JSON number, so a client that
 * summed a page of fines with `reduce((a, b) => a + b)` would be off by fractions
 * of a cent that nobody could see and everybody would eventually dispute. The
 * server sends strings; `formatMoney` parses them through `Intl.NumberFormat`, and
 * any client arithmetic goes through `sumMoney` below.
 */

export interface FineMemberDto {
  id: string;
  membershipNumber: string;
  user: { id: string; email: string; firstName: string; lastName: string } | null;
}

export interface FineDto {
  id: string;
  reference: string;
  memberId: string;
  loanId: string | null;
  type: string;
  /** Decimal string. Never a number — see the module note. */
  amount: string;
  waivedAmount: string;
  status: FineStatusDto;
  description: string | null;
  daysOverdue: number | null;
  assessedAt: string;
  dueDate: string | null;
  waivedAt: string | null;
  waiverReason: string | null;
  member: FineMemberDto;
  loan: { id: string; dueDate: string; status: string; book: { id: string; title: string } } | null;
  payments: {
    id: string;
    receiptNumber: string;
    amount: string;
    method: PaymentMethodDto;
    paidAt: string;
    voidedAt: string | null;
    branchId: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDto {
  id: string;
  receiptNumber: string;
  fineId: string;
  memberId: string;
  /** Decimal string. */
  amount: string;
  method: PaymentMethodDto;
  reference: string | null;
  paidAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  branchId: string;
  branch: { id: string; code: string; name: string };
  member: FineMemberDto;
  fine: { id: string; reference: string; type: string; status: FineStatusDto } | null;
}

export type FineFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  memberId?: string;
  loanId?: string;
  branchId?: string;
  status?: FineStatusDto;
  type?: string;
};

export type PaymentFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  fineId?: string;
  memberId?: string;
  branchId?: string;
};

export function listFines(filters: FineFilters, signal?: AbortSignal): Promise<Paginated<FineDto>> {
  return api.get<FineDto[]>('/fines', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<FineDto>>;
}

export function listPayments(
  filters: PaymentFilters,
  signal?: AbortSignal,
): Promise<Paginated<PaymentDto>> {
  return api.get<PaymentDto[]>('/payments', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<PaymentDto>>;
}

export const FINE_STATUS_LABELS: Record<FineStatusDto, string> = {
  OUTSTANDING: 'Outstanding',
  PARTIAL: 'Partially paid',
  PAID: 'Paid',
  WAIVED: 'Waived',
  VOID: 'Void',
};

export const FINE_STATUS_FILTERS: readonly { value: FineStatusDto; label: string }[] = [
  { value: 'OUTSTANDING', label: 'Outstanding' },
  { value: 'PARTIAL', label: 'Partially paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'WAIVED', label: 'Waived' },
  { value: 'VOID', label: 'Void' },
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodDto, string> = {
  CASH: 'Cash',
  MPESA: 'M-Pesa',
  BANK: 'Bank transfer',
  CARD: 'Card',
  OTHER: 'Other',
};

/**
 * Sums decimal strings without going through a float.
 *
 * Shifting to integer hundredths is exact for every amount this schema allows
 * (`Decimal(14,2)`), so the result is the true total and is returned as a string
 * for `formatMoney`. A number-based sum would be the one place in the client where
 * a rounding error becomes a wrong figure on someone's account.
 */
export function sumMoney(amounts: readonly string[]): string {
  let hundredths = 0;

  for (const amount of amounts) {
    if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) continue;
    const negative = amount.startsWith('-');
    const [whole = '0', fraction = ''] = amount.replace('-', '').split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    hundredths += negative ? -cents : cents;
  }

  const sign = hundredths < 0 ? '-' : '';
  const absolute = Math.abs(hundredths);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/**
 * What is still owed on a fine: assessed less waived, less valid payments.
 *
 * The server stores all three figures positive (the status row works from
 * `amount - waived - payments`), so the balance is the assessed amount minus the
 * other two — not their sum. `sumMoney` accepts signed strings, so the credited
 * amounts are negated before adding.
 *
 * Clamps at zero rather than reporting a negative balance. An overpayment is a real
 * state — it happens when a rate changes between assessment and payment — but showing
 * a member "KES -400.00 owing" is a confusing way to say "you are in credit", and the
 * credit is tracked elsewhere. The floor here keeps this function's contract simple:
 * it returns an amount, and that amount is never negative.
 */
export function fineBalance(fine: FineDto): string {
  const paid = sumMoney(
    fine.payments.filter((payment) => payment.voidedAt === null).map((payment) => payment.amount),
  );
  const owed = sumMoney([fine.amount, negate(fine.waivedAmount), negate(paid)]);
  return owed.startsWith('-') ? '0.00' : owed;
}

/** Flips the sign of a decimal string. `-0.00` stays a zero. */
function negate(amount: string): string {
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}

/* ── Fine & payment actions ───────────────────────────────────────────────────
 * All four endpoints exist behind their staff permissions (`FINE_UPDATE`,
 * `FINE_WAIVE`, `PAYMENT_CREATE`, `PAYMENT_VOID`); these call them.
 */

export interface FineUpdateInput {
  amount?: string;
  description?: string;
  status?: FineStatusDto;
  dueDate?: string;
}

export interface FineWaiveInput {
  amount: string;
  reason: string;
}

export interface PaymentCreateInput {
  fineId: string;
  amount: string;
  method: PaymentMethodDto;
  reference?: string;
  notes?: string;
  branchId?: string;
}

/** Adjust the assessed amount or the description on a fine. */
export function updateFine(id: string, input: FineUpdateInput) {
  return api.patch<{ fine: FineDto }>(`/fines/${id}`, input);
}

/** Waive part or all of a fine, with the reason recorded. */
export function waiveFine(id: string, input: FineWaiveInput) {
  return api.post<{ fine: FineDto }>(`/fines/${id}/waive`, input);
}

/** Record a payment against a fine at the desk. */
export function createPayment(input: PaymentCreateInput) {
  return api.post<{ payment: PaymentDto }>('/payments', input);
}

/** Void a mistaken payment. The receipt stays visible for audit. */
export function voidPayment(id: string, reason: string) {
  return api.post<{ payment: PaymentDto }>(`/payments/${id}/void`, { reason });
}
