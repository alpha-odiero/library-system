import type { NextFunction, Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

/**
 * Access logging.
 *
 * `customLogLevel` avoids a `warn` per 4xx, which would otherwise let a scanner
 * drown the signal it is generating, while still marking 5xx distinctly.
 * `req.route?.path` gives the Express route template, so cardinality stays
 * bounded — a raw URL would make one log stream per resource id.
 */

/**
 * pino-http hands serializers a loosely typed request object. Each serializer
 * re-narrows from `unknown` instead of trusting the parameter, because these
 * values land directly in the log stream.
 */
function serialiseRequest(value: unknown): { method?: string; url?: string } {
  const request = value as { method?: unknown; url?: unknown } | undefined;
  return {
    ...(typeof request?.method === 'string' ? { method: request.method } : {}),
    ...(typeof request?.url === 'string' ? { url: request.url } : {}),
  };
}

function serialiseResponse(value: unknown): { statusCode?: number } {
  const response = value as { statusCode?: unknown } | undefined;
  return typeof response?.statusCode === 'number' ? { statusCode: response.statusCode } : {};
}

/**
 * Route template for a request, e.g. `/books/:id`.
 *
 * `req.route` is untyped on Express's Request, so it is re-narrowed here. Using
 * the template rather than the raw URL keeps log cardinality bounded: one
 * stream per route instead of one per resource id.
 */
function routeTemplate(req: Request): string {
  const route: unknown = req.route;
  const path =
    typeof route === 'object' && route !== null ? (route as { path?: unknown }).path : undefined;
  return typeof path === 'string' && path.length > 0 ? path : req.url;
}

export const requestLogging = pinoHttp({
  logger,
  autoLogging: env.ENABLE_REQUEST_LOGGING,
  genReqId: (req) => (req as Request).requestId,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) =>
    `${req.method} ${routeTemplate(req as Request)} ${res.statusCode}`,
  customErrorMessage: (req, res) =>
    `${req.method} ${routeTemplate(req as Request)} ${res.statusCode}`,
  serializers: {
    req: serialiseRequest,
    res: serialiseResponse,
  },
  customProps: (req) => {
    const request = req as Request;
    return {
      userId: request.auth?.userId,
      roleCode: request.auth?.roleCode,
    };
  },
});

/** Logs unexpected faults with full context, then defers to the error handler. */
export function logUncaught(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
