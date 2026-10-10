import { API_BASE_URL } from './api';

/**
 * Shared realtime channel subscriptions.
 *
 * The backend broadcasts one named SSE event per domain (see
 * `apps/backend/src/modules/realtime/realtime.routes.ts`). This module keeps a
 * single EventSource per tab — never one per hook — and re-serves every event as a
 * window `CustomEvent` so any hook can subscribe with the same `window` listener
 * and unsubscribe without touching the connection.
 *
 * Events are signals, not state: the payload is a channel/action/entityId and the
 * subscriber refetches what it is allowed to read, so a permission change on the
 * server is a permission change in the UI without this module ever duplicating the
 * decision. A refresh feed on a personal dashboard is exactly the private data the
 * 401-guarded route is meant to protect.
 */

export type RealtimeChannel =
  | 'catalogue'
  | 'circulation'
  | 'finance'
  | 'members'
  | 'settings'
  | 'notifications';

export const REALTIME_CHANNELS: readonly RealtimeChannel[] = [
  'catalogue',
  'circulation',
  'finance',
  'members',
  'settings',
  'notifications',
];

export interface RealtimeMessage {
  channel: RealtimeChannel;
  action: string;
  entityId?: string;
  occurredAt: string;
}

const REALTIME_EVENT = 'lms:realtime';

let source: EventSource | null = null;
let started = false;

function open(): void {
  if (source && source.readyState !== EventSource.CLOSED) return;
  source = new EventSource(`${API_BASE_URL}/realtime/events`);

  for (const channel of REALTIME_CHANNELS) {
    // A named-event listener receives a MessageEvent typed after the event name,
    // but `addEventListener` spells it as a plain Event. The narrowed read that
    // follows is exactly what EventSource delivers for a named event.
    source.addEventListener(channel, (event: Event) => {
      const data = (event as MessageEvent<string>).data;
      const message = parse(data);
      if (!message) return;
      window.dispatchEvent(new CustomEvent<RealtimeMessage>(REALTIME_EVENT, { detail: message }));
    });
  }

  // The server sends a 15s heartbeat; onerror is how a dropped stream at least
  // lands. EventSource reconnects itself unless closed, so no manual retry is
  // needed here — the tab-visibility handler is what re-establishes a connection
  // that the browser throttled while the tab was hidden.
  source.onerror = () => {
    if (!started) close();
  };
}

/** Opens the stream. Idempotent, so it is safe to call on every boot/sign-in. */
export function startRealtime(): void {
  if (started) return;
  started = true;
  open();
}

/**
 * Closes the stream. Called when the session ends: an SSE connection holding no
 * session is a connection that is about to 401 on the next reconnect.
 */
export function stopRealtime(): void {
  started = false;
  close();
}

function close(): void {
  source?.close();
  source = null;
}

/** Reopens after the browser paused the tab, or after a network recovery. */
function onVisibilityChange(): void {
  if (started && document.visibilityState === 'visible') open();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', onVisibilityChange);
}

/**
 * Subscribes to one channel.
 *
 * Returns an unsubscribe function so a hook can pair the subscription with its own
 * cleanup without knowing anything about the underlying connection.
 */
export function subscribeToRealtime(
  channel: RealtimeChannel,
  callback: (message: RealtimeMessage) => void,
): () => void {
  const handler = (event: Event): void => {
    const message = (event as CustomEvent<RealtimeMessage>).detail;
    if (message.channel === channel) callback(message);
  };
  window.addEventListener(REALTIME_EVENT, handler);
  return () => window.removeEventListener(REALTIME_EVENT, handler);
}

/** True once the stream is being kept alive, e.g. to guard a settings reload. */
export function isRealtimeActive(): boolean {
  return started;
}

function parse(data: string): RealtimeMessage | null {
  try {
    const message = JSON.parse(data) as RealtimeMessage;
    if (!REALTIME_CHANNELS.includes(message.channel)) return null;
    if (typeof message.action !== 'string') return null;
    return message;
  } catch {
    return null;
  }
}
