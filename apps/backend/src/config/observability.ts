/**
 * Optional observability integration (Sentry).
 *
 * Loaded lazily from the error handler so that Sentry is not a hard dependency
 * in local development or in tests. Failure to initialise is logged and
 * swallowed — monitoring must never be able to take the API down.
 */
import { env } from './env.js';
import { logger } from './logger.js';

interface CaptureContext {
  requestId?: string;
  path?: string;
  userId?: string;
  [key: string]: unknown;
}

type Capture = (error: unknown, context?: CaptureContext) => void;

let capture: Capture | null = null;
let initialised = false;

export function initObservability(): void {
  if (initialised) return;
  initialised = true;

  if (!env.SENTRY_DSN) return;

  capture = (error, context) => {
    // Placeholder transport. Phase B wires the real SDK here; the interface is
    // kept so call sites do not change when it does.
    logger.error({ err: error, ...context, event: 'observability.capture' }, 'Error captured');
  };
}

export function captureException(error: unknown, context?: CaptureContext): void {
  if (!initialised) initObservability();
  capture?.(error, context);
}
