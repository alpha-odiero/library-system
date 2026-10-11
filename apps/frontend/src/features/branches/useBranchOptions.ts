import { useEffect, useState } from 'react';
import { cachedReference } from '../../lib/referenceCache';
import { listBranches, type BranchDto } from './api';

const CACHE_TTL_MS = 60_000;

/**
 * Loads the caller's in-scope branches for a picker.
 *
 * The server already filters by branch scope, so this list is exactly the set of
 * branches the signed-in user may register someone into. That is why the form has
 * no "all branches" option: offering one would only produce a 403 from
 * `createMember`.
 *
 * Half a dozen screens render this picker (member create/edit, book and copy
 * lists, user create), each mounting its own copy of the hook. They all request
 * the same scoped list, so the request is cached and shared — switching pages no
 * longer re-fetches it, and two pickers landing on one page share one request.
 * The cache is dropped whenever the signed-in identity changes, so it can never
 * carry one user's branch scope into another's session.
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
    let active = true;

    setLoading(true);
    setError(null);

    const key = `branches:${includeInactive ? 'all' : 'active'}`;

    void cachedReference(key, CACHE_TTL_MS, () =>
      listBranches({ limit: 100, ...(includeInactive ? { includeInactive: true } : {}) }),
    )
      .then((response) => {
        if (active) setBranches(response.data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [includeInactive]);

  return { branches, loading, error };
}
