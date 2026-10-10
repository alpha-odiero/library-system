import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError, notFound, type FieldIssue } from '../lib/errors.js';
import { buildErrorBody } from '../lib/response.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

/**
 * Centralised error handling — the only writer of the failure envelope.
 *
 * Defence in depth: three independent reasons nothing internal can leak.
 *   1. Only `AppError` reaches the client with its own message. Anything else
 *      becomes a bare INTERNAL_ERROR.
 *   2. Prisma errors are translated into safe domain codes; the original never
 *      reaches the response.
 *   3. Unknown errors are logged in full server-side and correlated by
 *      `requestId`, which the client *is* told — so a support ticket carries
 *      enough to find the exact failure without exposing it.
 */

interface NormalisedError {
  status: number;
  code: string;
  message: string;
  details?: FieldIssue[] | Record<string, unknown>;
  /** Log at error level (unexpected) rather than warn (client's fault). */
  unexpected: boolean;
  logPayload: Record<string, unknown>;
}

function normalise(error: unknown, req: Request): NormalisedError {
  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      unexpected: error.status >= 500,
      logPayload: { ...(error.logContext ?? {}) },
    };
  }

  // Zod can escape if thrown outside the validate() middleware.
  if (error instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      unexpected: false,
      logPayload: {},
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return normalisePrisma(error, req);
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    logger.error({ err: error, requestId: req.requestId }, 'Prisma query validation failed');
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'The request could not be processed',
      unexpected: false,
      logPayload: {},
    };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    logger.fatal({ err: error, requestId: req.requestId }, 'Database connection failure');
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable',
      unexpected: true,
      logPayload: {},
    };
  }

  // Malformed JSON from body-parser, or a body over the size limit.
  if (isBodyParserError(error)) {
    const tooLarge = (error as { type?: string }).type === 'entity.too.large';
    return {
      status: tooLarge ? 413 : 400,
      code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'MALFORMED_REQUEST',
      message: tooLarge ? 'Request body is too large' : 'Request body is not valid JSON',
      unexpected: false,
      logPayload: {},
    };
  }

  if (isCorsRejection(error)) {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: 'Origin not permitted',
      unexpected: false,
      logPayload: {},
    };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    unexpected: true,
    logPayload: {},
  };
}

/**
 * Prisma error translation.
 *
 * The important one is P2002 (unique violation) → 409 CONFLICT: this is what
 * surfaces the concurrency guards (duplicate reservation, duplicate email,
 * receipt collision) as a meaningful conflict instead of a 500.
 *
 * `target` is only logged, never returned — it can name columns and constraint
 * names, which is schema information an attacker should not receive.
 */
function normalisePrisma(
  error: Prisma.PrismaClientKnownRequestError,
  req: Request,
): NormalisedError {
  const target = Array.isArray(error.meta?.target)
    ? (error.meta.target as string[]).join(', ')
    : undefined;

  const base = { unexpected: false, logPayload: { prismaCode: error.code, target } };

  switch (error.code) {
    case 'P2002':
      return {
        ...base,
        status: 409,
        code: 'CONFLICT',
        // Names the conflict type without disclosing column names.
        message: describeUniqueViolation(target),
      };
    case 'P2003':
      return {
        ...base,
        status: 409,
        code: 'CONFLICT',
        message: 'The operation violates a data integrity constraint',
      };
    case 'P2025':
      return {
        ...base,
        status: 404,
        code: 'NOT_FOUND',
        message: 'The requested record was not found',
      };
    case 'P2034':
      logger.warn(
        { requestId: req.requestId, prismaCode: error.code },
        'Transaction write conflict',
      );
      return {
        ...base,
        status: 409,
        code: 'CONFLICT',
        message: 'The operation conflicted with a concurrent change. Please retry.',
      };
    case 'P2028':
      logger.error({ requestId: req.requestId, prismaCode: error.code }, 'Transaction timed out');
      return {
        ...base,
        status: 503,
        code: 'TIMEOUT',
        message: 'The operation took too long. Please retry.',
        unexpected: true,
      };
    default:
      logger.error({ err: error, requestId: req.requestId }, 'Unhandled Prisma error');
      return {
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        unexpected: true,
        logPayload: { prismaCode: error.code },
      };
  }
}

function describeUniqueViolation(target?: string): string {
  if (!target) return 'A record with these details already exists';
  if (target.includes('email')) return 'An account with this email address already exists';
  if (target.includes('membership_number')) return 'That membership number is already in use';
  if (target.includes('barcode')) return 'That barcode is already assigned to another copy';
  if (target.includes('accession_number')) return 'That accession number is already in use';
  if (target.includes('receipt_number')) return 'That receipt number has already been issued';
  if (target.includes('qr_token')) return 'That QR token is already in use';
  if (target.includes('loan_id')) return 'A fine already exists for this loan';
  return 'A record with these details already exists';
}

function isBodyParserError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { type?: string; status?: number };
  return (
    typeof candidate.type === 'string' &&
    (candidate.type.startsWith('entity.') || candidate.type === 'charset.unsupported')
  );
}

function isCorsRejection(error: unknown): boolean {
  return error instanceof Error && error.message.includes('not allowed by CORS policy');
}

export const errorHandler: ErrorRequestHandler = (
  error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    // The response already started; delegate to Express so it can destroy the
    // socket rather than trying to write a second set of headers.
    next(error);
    return;
  }

  const normalised = normalise(error, req);

  // Express types the handler's first parameter as `any`. Narrow it to a real
  // Error before it reaches pino, so the logger is not handed an untyped value
  // that later gets serialised blindly.
  const cause: unknown = error;
  const causeError: Error | undefined = cause instanceof Error ? cause : undefined;

  const log = normalised.unexpected ? logger.error.bind(logger) : logger.warn.bind(logger);
  log(
    {
      ...normalised.logPayload,
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: normalised.status,
      code: normalised.code,
      userId: req.auth?.userId,
      err: normalised.unexpected ? causeError : undefined,
    },
    normalised.unexpected ? 'Request failed unexpectedly' : 'Request rejected',
  );

  if (env.SENTRY_DSN && normalised.unexpected) {
    // Imported lazily so Sentry stays an optional dependency in local dev.
    void import('../config/observability.js')
      .then((m) => m.captureException(error, { requestId: req.requestId, path: req.path }))
      .catch(() => undefined);
  }

  res.status(normalised.status).json(
    buildErrorBody(normalised.code, normalised.message, {
      details: normalised.details,
      requestId: req.requestId,
    }),
  );
};

/** 404 for unmatched routes, so a typo yields the standard envelope. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(notFound('Endpoint', req.path));
}
