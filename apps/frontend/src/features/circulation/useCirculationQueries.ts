import { useCallback, useEffect, useState } from 'react';
import type { LoanStatusDto, PaginationMeta, ReservationStatusDto } from '@lms/shared';
import { subscribeToRealtime, type RealtimeChannel } from '../../lib/realtime';
import {
  listLoans,
  listReservations,
  type LoanDto,
  type LoanFilters,
  type ReservationDto,
  type ReservationFilters,
} from './api';

/**
 * Data fetching for the circulation lists.
 *
 * `useMemberQueries` explains the abort signal, the stable `reload` and the row
 * reset. The one thing added here is `includeReturned` on the loan list: returned
 * loans are excluded by default because they accumulate without bound, and a list
 * that defaults to showing every loan ever issued is unusable after a month of
 * operation. The returns desk asks for them explicitly.
 */
function useList<TItem, TFilters extends object>(
  fetch: (
    filters: TFilters,
    signal: AbortSignal,
  ) => Promise<{ data: TItem[]; meta: PaginationMeta }>,
  filters: TFilters,
  realtimeChannel?: RealtimeChannel,
) {
  const [items, setItems] = useState<TItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const key = JSON.stringify(filters);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(JSON.parse(key) as TFilters, signal);
        setItems(response.data);
        setMeta(response.meta);
      } catch (caught) {
        if (!signal.aborted) setError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [key],
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(JSON.parse(key) as TFilters, new AbortController().signal);
      setItems(response.data);
      setMeta(response.meta);
    } catch {
      // A background refresh must never blank an otherwise working table.
    }
  }, [key]);

  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!realtimeChannel) return;
    return subscribeToRealtime(realtimeChannel, () => void refresh());
  }, [realtimeChannel, refresh]);

  return {
    items,
    meta,
    loading,
    error,
    reload: () => load(new AbortController().signal),
  };
}

/**
 * `ownOnly` narrows to the caller's own records.
 *
 * Passed as `memberId` from the session rather than being a separate request: the
 * backend already scopes `LOAN_VIEW_OWN` to the caller, so the client sends the same
 * filter a staff user would rather than inventing an endpoint. The server re-checks
 * it regardless — this narrows what is *asked for*, not what is *granted*.
 */
export function useLoanList(
  filters: LoanFilters & { ownMemberId?: string | null },
  ownOnly = false,
) {
  const { ownMemberId, ...rest } = filters;
  const resolved = ownOnly && ownMemberId ? { ...rest, memberId: ownMemberId } : rest;

  const result = useList<LoanDto, LoanFilters>(listLoans, resolved, 'circulation');
  return { ...result, loans: result.items };
}

export function useReservationList(
  filters: ReservationFilters & { ownMemberId?: string | null },
  ownOnly = false,
) {
  const { ownMemberId, ...rest } = filters;
  const resolved = ownOnly && ownMemberId ? { ...rest, memberId: ownMemberId } : rest;

  const result = useList<ReservationDto, ReservationFilters>(
    listReservations,
    resolved,
    'circulation',
  );
  return { ...result, reservations: result.items };
}

export const LOAN_STATUS_FILTERS: readonly { value: LoanStatusDto; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'LOST', label: 'Lost' },
  { value: 'DAMAGED', label: 'Damaged' },
];

export const RESERVATION_STATUS_FILTERS: readonly {
  value: ReservationStatusDto;
  label: string;
}[] = [
  { value: 'ACTIVE', label: 'Waiting' },
  { value: 'READY', label: 'Ready for collection' },
  { value: 'FULFILLED', label: 'Fulfilled' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
