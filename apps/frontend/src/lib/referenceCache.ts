/**
 * A tiny in-memory cache for reference data.
 *
 * Scope is deliberately narrow: org settings, the branch picker, member types —
 * short, shared lists that several screens request independently and that change
 * only when an administrator edits them. Nothing here is per-user private data:
 * the entries are keyed by request, and the whole store is dropped whenever the
 * signed-in identity changes (see `AuthContext`), so a librarian who signs out
 * cannot leave a branch list behind for the next account on the same tab.
 *
 * Two behaviours worth stating:
 *
 *   • In-flight de-duplication. Concurrent callers for the same key share one
 *     promise, so mounting three components that each want the branch list
 *     issues one request, not three.
 *   • Stale-while-revalidating is *not* implemented. A cached value is served
 *     only until its TTL elapses; after that the next caller refetches. These
 *     lists are not hot enough for a revalidation strategy to pay for itself.
 */

interface Entry<T> {
  /** Present once resolved; absent while the request is in flight. */
  value: T | undefined;
  expiresAt: number;
  /** Shared by every caller that arrives while the request is in flight. */
  promise: Promise<T> | undefined;
}

const entries = new Map<string, Entry<unknown>>();

/** Drops every cached reference value. Call on sign-in, sign-out, and expiry. */
export function clearReferenceCache(): void {
  entries.clear();
}

export async function cachedReference<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = entries.get(key) as Entry<T> | undefined;

  if (existing) {
    if (existing.promise) return existing.promise;
    if (existing.value !== undefined && existing.expiresAt > now) return existing.value;
  }

  const promise = load().then(
    (value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs, promise: undefined });
      return value;
    },
    (error: unknown) => {
      // A failure is not cached: the next caller retries instead of inheriting
      // the rejection for the length of the TTL.
      entries.delete(key);
      throw error;
    },
  );

  entries.set(key, { value: undefined, expiresAt: now + ttlMs, promise });
  return promise;
}
