import { useEffect, useState } from 'react';
import { listBranches, type BranchDto } from './api';

/**
 * Loads the caller's in-scope branches for a picker.
 *
 * The server already filters by branch scope, so this list is exactly the set of
 * branches the signed-in user may register someone into. That is why the form has
 * no "all branches" option: offering one would only produce a 403 from
 * `createMember`.
 *
 * A failure is captured rather than thrown. A branch picker that fails to load
 * must not take the whole registration form down with it — the error renders next
 * to the select, where the user can retry, and the rest of the form still works.
 */
export function useBranchOptions(includeInactive = false) {
  const [branches, setBranches] = useState<BranchDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    void listBranches(
      { limit: 100, ...(includeInactive ? { includeInactive: true } : {}) },
      controller.signal,
    )
      .then((response) => setBranches(response.data))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [includeInactive]);

  return { branches, loading, error };
}
