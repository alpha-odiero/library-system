/**
 * In-process realtime event bus.
 *
 * Mutation services publish a coarse "something changed in this channel" event
 * after a write commits. The Server-Sent-Events route in `modules/realtime`
 * fans the events out to every connected session, and the frontend treats a
 * channel event as "refetch whatever lists you are showing for that channel".
 *
 * The payload is a signal, never data. A client always refetches the records it
 * is entitled to see from the API, so a permission still holds at the read —
 * the bus just tells it to stop showing a stale page.
 */

export type RealtimeChannel =
  | 'catalogue'
  | 'circulation'
  | 'finance'
  | 'members'
  | 'settings'
  | 'notifications';

export interface RealtimeEvent {
  channel: RealtimeChannel;
  /** Stable machine-readable label, e.g. `Book.created`. */
  action: string;
  /** The id of the record that changed, when the publishing service has it. */
  entityId?: string;
  occurredAt: string;
}

type RealtimeListener = (event: RealtimeEvent) => void;

const listeners = new Set<RealtimeListener>();

/**
 * Publishes a change event after a write commits.
 *
 * A broken subscriber must never take a mutation down with it: the write has
 * already committed and the event is advisory, so each listener is isolated.
 */
export function publishRealtime(event: RealtimeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // The event is advisory; a listener failing must not fail the write.
    }
  }
}

/** Registers a listener and returns an unsubscribe function. */
export function subscribeRealtime(listener: RealtimeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
