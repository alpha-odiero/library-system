import cors, { type CorsOptions } from 'cors';
import type { RequestHandler } from 'express';
import { corsAllowedOrigins, isProduction } from '../config/env.js';

/**
 * CORS.
 *
 * An explicit allowlist, never `origin: true` (which reflects any origin) and
 * never a wildcard together with credentials (which browsers reject anyway, but
 * its presence signals a misconfiguration). `Vary: Origin` prevents a shared
 * cache from serving one origin's response to another.
 */
export function corsPolicy(): RequestHandler {
  const options: CorsOptions = {
    origin(origin, callback) {
      // Same-origin, curl, and server-to-server calls carry no Origin header.
      // They are not subject to CORS at all, so allow them through — the
      // authentication and authorization gates still apply.
      if (!origin) return callback(null, true);

      if (corsAllowedOrigins.includes(origin)) return callback(null, true);

      callback(new Error(`Origin ${origin} is not allowed by CORS policy`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'Idempotency-Key',
      'If-Match',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: isProduction ? 86_400 : 600,
    optionsSuccessStatus: 204,
  };

  return cors(options);
}
