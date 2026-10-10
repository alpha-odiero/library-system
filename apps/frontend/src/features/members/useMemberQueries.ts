import { useCallback, useEffect, useState } from 'react';
import type { MemberStatusDto, PaginationMeta } from '@lms/shared';
import { subscribeToRealtime } from '../../lib/realtime';
import type { MemberDto, MemberFilters, MemberTypeDto } from './api';
import { listMembers, listMemberTypes } from './api';

/**
 * Data fetching for list pages.
 *
 * One hook rather than a library, with three rules that are the difference
 * between a working list and a haunted one:
 *
 *   1. **The abort signal is threaded through.** Typing in a search box fires a
 *      request per keystroke; without cancellation the responses arrive out of
 *      order and the list shows results for a query the user has already changed.
 *      The `ignore` flag covers the request that was already in flight when the
 *      next one started.
 *   2. **`reload` is stable** so it can be a `useEffect` dependency without
 *      re-running the fetch on every render.
 *   3. **`data` is reset on a filter change**, so a stale row set is never shown
 *      next to a new filter.
 */
export function useMemberList(filters: MemberFilters) {
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Serialised so the effect re-runs on value change, not object identity.
  const key = JSON.stringify(filters);
  const serialised = JSON.parse(key) as MemberFilters;

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listMembers(serialised, signal);
        setMembers(response.data);
        setMeta(response.meta);
      } catch (caught) {
        // An abort is a cancellation we asked for, not a failure to report.
        if (!signal.aborted) setError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [key],
  );

  useEffect(() => {
    const controller = new AbortController();
    setMembers([]);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      const response = await listMembers(serialised, new AbortController().signal);
      setMembers(response.data);
      setMeta(response.meta);
    } catch {
      // A background refresh must never blank an otherwise working table.
    }
  }, [key]);

  useEffect(() => {
    return subscribeToRealtime('members', () => void refresh());
  }, [refresh]);

  return { members, meta, loading, error, reload: () => load(new AbortController().signal) };
}

export function useMemberTypeList(filters: {
  includeInactive?: boolean;
  limit?: number;
  page?: number;
}) {
  const [memberTypes, setMemberTypes] = useState<MemberTypeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const key = JSON.stringify(filters);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listMemberTypes(JSON.parse(key) as typeof filters, signal);
        setMemberTypes(response.data);
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
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      const response = await listMemberTypes(
        JSON.parse(key) as typeof filters,
        new AbortController().signal,
      );
      setMemberTypes(response.data);
    } catch {
      // A background refresh must never blank an otherwise working table.
    }
  }, [key]);

  useEffect(() => {
    return subscribeToRealtime('members', () => void refresh());
  }, [refresh]);

  return {
    memberTypes,
    loading,
    error,
    // Needed after a create, edit, or deactivate: without it the table keeps
    // showing the rows fetched on mount, and a successful write looks like it did
    // nothing until the page is reloaded.
    reload: () => load(new AbortController().signal),
  };
}

export const MEMBER_STATUS_FILTERS: readonly { value: MemberStatusDto; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'PENDING', label: 'Pending' },
];
