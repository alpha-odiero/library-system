import { useCallback, useEffect, useState } from 'react';
import type { PaginationMeta } from '@lms/shared';
import { subscribeToRealtime, type RealtimeChannel } from '../../lib/realtime';
import {
  listAuthors,
  listBooks,
  listCategories,
  listCopies,
  listPublishers,
  type AuthorDto,
  type BookDto,
  type CategoryDto,
  type CopyDto,
  type PublisherDto,
} from './api';

/**
 * Data fetching for the catalogue's list pages.
 *
 * Same three rules as `useMemberQueries`, for the same reasons — the abort signal
 * is threaded so typing cannot deliver results for a query the user has already
 * changed, `reload` is stable so it can be an effect dependency, and rows are reset
 * on a filter change so a stale row set is never shown beside a new filter.
 *
 * A shared factory rather than six near-identical hooks: the only difference between
 * these lists is which endpoint is called and what shape comes back, and six copies
 * of the same effect are six places for the next fix to be missed.
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

  // Serialised so the effect re-runs on value change, not object identity.
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
        // An abort is a cancellation we asked for, not a failure to report.
        if (!signal.aborted) setError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [key],
  );

  /**
   * Background refresh for a realtime event. Same fetch as `load` without the
   * loading flash: a table that already has rows must not blank itself to a
   * skeleton just because somebody else on the desk issued a loan.
   */
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
    // Needed after a write: without it the table keeps showing the rows fetched on
    // mount, and a successful write looks like it did nothing.
    reload: () => load(new AbortController().signal),
  };
}

export function useBookList(filters: Parameters<typeof listBooks>[0]) {
  const result = useList<BookDto, Parameters<typeof listBooks>[0]>(listBooks, filters, 'catalogue');
  return { ...result, books: result.items };
}

export function useCopyList(filters: Parameters<typeof listCopies>[0]) {
  const result = useList<CopyDto, Parameters<typeof listCopies>[0]>(
    listCopies,
    filters,
    'catalogue',
  );
  return { ...result, copies: result.items };
}

export function useAuthorList(filters: Parameters<typeof listAuthors>[0]) {
  const result = useList<AuthorDto, Parameters<typeof listAuthors>[0]>(
    listAuthors,
    filters,
    'catalogue',
  );
  return { ...result, authors: result.items };
}

export function usePublisherList(filters: Parameters<typeof listPublishers>[0]) {
  const result = useList<PublisherDto, Parameters<typeof listPublishers>[0]>(
    listPublishers,
    filters,
    'catalogue',
  );
  return { ...result, publishers: result.items };
}

export function useCategoryList(filters: Parameters<typeof listCategories>[0]) {
  const result = useList<CategoryDto, Parameters<typeof listCategories>[0]>(
    listCategories,
    filters,
    'catalogue',
  );
  return { ...result, categories: result.items };
}
