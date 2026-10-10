import express, { type Express } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { initObservability } from './config/observability.js';
import { logger } from './config/logger.js';
import { securityHeaders } from './middleware/helmet.js';
import { corsPolicy } from './middleware/cors.js';
import { requestId } from './middleware/request-id.js';
import { requestLogging } from './middleware/request-logger.js';
import { globalRateLimit } from './middleware/rate-limit.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { systemRouter } from './routes/system.routes.js';
import { v1Router } from './routes/v1/index.js';
import { LIMITS } from './config/constants.js';

/**
 * Express application assembly.
 *
 * MIDDLEWARE ORDER IS A SECURITY CONTRACT — do not reorder casually:
 *
 *   1. requestId        correlation, before anything can log
 *   2. securityHeaders  reject/annotate before any body is parsed
 *   3. cors             answer preflights; refuse unknown origins
 *   4. requestLogging   captures method/path/status for the whole chain
 *   5. compression      after logging so timings are of the real payload
 *   6. body/cookie      parse LAST among the global middleware, with a size cap
 *   7. rate limiting    after parsing, because per-account keys need the body
 *   8. routes           system probes, then the versioned API
 *   9. notFoundHandler  standard envelope for unmatched paths
 *  10. errorHandler     the only writer of a failure response
 *
 * Note that the global rate limiter runs before authentication: it is keyed by
 * IP, so it does not need a principal, and running it first shields the auth
 * and database code from volumetric traffic.
 */
export function createApp(): Express {
  initObservability();

  const app = express();

  // Behind a load balancer, `req.ip` must come from the proxy's forwarded
  // header — otherwise every client shares one IP and the rate limiter becomes
  // a global throttle. `1` trusts exactly one hop, which is the CDN/ALB.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(requestId);
  app.use(securityHeaders());
  app.use(corsPolicy());
  app.use(requestLogging);

  app.use(
    compression({
      // BREACH mitigation: compressing a response that mixes secrets with
      // attacker-controlled input weakens TLS. No compression when auth is on.
      filter: (req, res) => {
        const hasAuth = Boolean(req.headers.authorization) || Boolean(req.headers.cookie);
        if (hasAuth && req.path.startsWith('/api')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  app.use(express.json({ limit: LIMITS.MAX_JSON_BODY_BYTES }));
  app.use(express.urlencoded({ extended: false, limit: LIMITS.MAX_JSON_BODY_BYTES }));
  app.use(cookieParser());

  app.use(globalRateLimit);

  // Health and readiness sit outside the versioned surface so a probe never
  // has to know the API version.
  app.use(systemRouter);

  app.use('/api/v1', v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.debug({ env: env.NODE_ENV }, 'Application assembled');

  return app;
}
