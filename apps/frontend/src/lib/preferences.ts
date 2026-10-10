import { useCallback, useEffect, useState } from 'react';

/**
 * Per-user preferences that the server does not model.
 *
 * Theme, "confirm before issuing" and similar choices belong to a person and a
 * device, not to an organization record, and the API has no column for them.
 * They live in `localStorage` under the account's id so two people sharing a
 * browser do not inherit each other's settings.
 *
 * Two rules keep this honest:
 *
 *   1. Nothing here may be presented as library policy. The UI that reads these
 *      says so; policy is `/settings`, which is audited and server-enforced.
 *   2. Every write is best-effort. Private mode, a disabled storage quota and a
 *      full disk all make persistence fail, and a preference that fails to save
 *      must not throw inside a click handler.
 */

const PREFIX = 'soma360.prefs.';

function keyFor(userId: string, name: string): string {
  return `${PREFIX}${userId}.${name}`;
}

/** Key → components holding a copy of the value, for cross-component sync. */
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string): void {
  for (const listener of subscribers.get(key) ?? []) listener();
}

export function readPreference<T>(userId: string, name: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(keyFor(userId, name));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Unreadable or absent: the fallback IS the preference until one is saved.
    return fallback;
  }
}

export function writePreference<T>(userId: string, name: string, value: T): void {
  try {
    window.localStorage.setItem(keyFor(userId, name), JSON.stringify(value));
  } catch {
    // Storage unavailable: the value still applies to this component tree, which
    // is why the subscriber set is notified either way.
  }
  notify(keyFor(userId, name));
}

/**
 * A preference, kept in sync across every component that reads it.
 *
 * `fallback` must be a stable value (a module constant, not an object literal
 * rebuilt each render) — it is part of the effect's inputs.
 */
export function usePreference<T>(
  userId: string,
  name: string,
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPreference(userId, name, fallback));

  useEffect(() => {
    const key = keyFor(userId, name);
    const sync = () => setValue(readPreference(userId, name, fallback));

    const listeners = subscribers.get(key) ?? new Set<() => void>();
    listeners.add(sync);
    subscribers.set(key, listeners);
    // Re-read on mount: another component may have written while this one was
    // not yet rendered.
    sync();

    return () => {
      listeners.delete(sync);
    };
  }, [userId, name, fallback]);

  const update = useCallback((next: T) => writePreference(userId, name, next), [userId, name]);

  return [value, update];
}
