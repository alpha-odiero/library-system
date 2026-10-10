import { useCallback, useEffect, useState } from 'react';
import type { PaginationMeta } from '@lms/shared';
import { subscribeToRealtime } from '../../lib/realtime';
import {
  listFines,
  listPayments,
  type FineDto,
  type FineFilters,
  type PaymentDto,
  type PaymentFilters,
} from './api';

/**
 * Data fetching for the finance desk.
 *
 * Same abort/stable-reload/reset rules as the other list hooks. The totals below are
 * a separate concern from the rows and are fetched independently, because a page of
 * twenty fines says nothing about how much is owed across four hundred of them —
 * and a sum of the visible rows would be a figure that changes with the pagination
 * and is therefore wrong.
 *
 * The outstanding total is a client-side sum rather than a server aggregate. That is
 * a deliberate limitation, not an oversight: summing a page is only correct while
 * the page holds every outstanding fine, so `summed` reports the coverage it
 * actually has and the caller shows the figure as a floor when it is partial.
 */
const PAGE_LIMIT = 100;

export function useFineList(filters: FineFilters) {
  const [fines, setFines] = useState<FineDto[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const key = JSON.stringify(filters);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listFines(JSON.parse(key) as typeof filters, signal);
        setFines(response.data);
        setMeta(response.meta);
      } catch (caught) {
        if (!signal.aborted) setError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [key],
  );

  useEffect(() => {
    const controller = new AbortController();
    setFines([]);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      const response = await listFines(
        JSON.parse(key) as typeof filters,
        new AbortController().signal,
      );
      setFines(response.data);
      setMeta(response.meta);
    } catch {
      // A background refresh must never blank an otherwise working table.
    }
  }, [key]);

  useEffect(() => {
    return subscribeToRealtime('finance', () => void refresh());
  }, [refresh]);

  return { fines, meta, loading, error, reload: () => load(new AbortController().signal) };
}

export function usePaymentList(filters: PaymentFilters) {
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const key = JSON.stringify(filters);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listPayments(JSON.parse(key) as typeof filters, signal);
        setPayments(response.data);
        setMeta(response.meta);
      } catch (caught) {
        if (!signal.aborted) setError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [key],
  );

  useEffect(() => {
    const controller = new AbortController();
    setPayments([]);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      const response = await listPayments(
        JSON.parse(key) as typeof filters,
        new AbortController().signal,
      );
      setPayments(response.data);
      setMeta(response.meta);
    } catch {
      // A background refresh must never blank an otherwise working table.
    }
  }, [key]);

  useEffect(() => {
    return subscribeToRealtime('finance', () => void refresh());
  }, [refresh]);

  return { payments, meta, loading, error, reload: () => load(new AbortController().signal) };
}

export interface FineTotals {
  /** Assessed less waived, less valid payments. */
  outstanding: string;
  /** True when `outstanding` covers every outstanding fine, not just a page of them. */
  complete: boolean;
  /** The number of outstanding fines behind the figure. */
  count: number;
}

/**
 * Sums the outstanding balance across every outstanding fine.
 *
 * Fetched to the maximum page size and marked `complete` only when the page held all
 * of them. When it is incomplete the caller renders the figure as a lower bound
 * ("KES 12,400.00+"), because printing the partial sum as though it were the whole
 * debt is the kind of error that ends up in a dispute.
 */
export function useFineTotals(entitled: boolean): { totals: FineTotals | null; loading: boolean } {
  const [totals, setTotals] = useState<FineTotals | null>(null);
  const [loading, setLoading] = useState(entitled);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!entitled) return;
    return subscribeToRealtime('finance', () => setRevision((n) => n + 1));
  }, [entitled]);

  useEffect(() => {
    if (!entitled) return;

    const controller = new AbortController();

    void listFines({ limit: PAGE_LIMIT, status: 'OUTSTANDING' }, controller.signal)
      .then((response) => {
        const amounts = response.data.map((fine) => fine.amount);
        setTotals({
          outstanding: sum(amounts),
          complete: response.meta.total <= response.data.length,
          count: response.meta.total,
        });
      })
      .catch(() => {
        // A failed total shows nothing. Rendering zero here would be the single most
        // misleading thing on the page: a librarian would read "KES 0.00 owed" as
        // good news about the library's finances.
        setTotals(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [entitled, revision]);

  return { totals, loading };
}

/** Decimal string sum, exact in integer hundredths. Mirrors `sumMoney` in api.ts. */
function sum(amounts: readonly string[]): string {
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

export const FINE_TYPE_LABELS: Record<string, string> = {
  OVERDUE: 'Overdue',
  LOST: 'Lost item',
  DAMAGED: 'Damage',
  LATE_RETURN: 'Late return',
  RESERVATION_HOLD: 'Reservation hold',
};
