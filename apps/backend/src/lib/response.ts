import type { Response } from 'express';
import {
  buildPaginationMeta,
  type ErrorEnvelope,
  type PaginationMeta,
  type SuccessEnvelope,
} from '@lms/shared';
import type { FieldIssue } from './errors.js';

/**
 * The response envelope.
 *
 * Success: `{ success: true, data, message?, meta?, requestId? }`
 * Failure: `{ success: false, error: { code, message, details? }, requestId? }`
 *
 * Controllers call `sendOk`/`sendCreated` and nothing else; the error handler
 * is the only writer of the failure shape.
 */

export function sendOk<T>(
  res: Response,
  data: T,
  options?: { message?: string; meta?: PaginationMeta; status?: number },
): Response {
  const body: SuccessEnvelope<T> = {
    success: true,
    data,
    ...(options?.message ? { message: options.message } : {}),
    ...(options?.meta ? { meta: options.meta } : {}),
  };

  return res.status(options?.status ?? 200).json(body);
}

export function sendCreated<T>(res: Response, data: T, message?: string): Response {
  return sendOk(res, data, { message, status: 201 });
}

export function sendNoContent(res: Response): Response {
  return res.status(204).send();
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  pagination: { page: number; limit: number; total: number },
  message?: string,
): Response {
  return res.status(200).json({
    success: true,
    data,
    ...(message ? { message } : {}),
    meta: buildPaginationMeta(pagination),
  } satisfies SuccessEnvelope<T[]>);
}

/** Builds the failure body. Called only by the error handler. */
export function buildErrorBody(
  code: string,
  message: string,
  options?: { details?: FieldIssue[] | Record<string, unknown>; requestId?: string },
): ErrorEnvelope {
  return {
    success: false,
    error: {
      code,
      message,
      ...(options?.details ? { details: options.details } : {}),
    },
    ...(options?.requestId ? { requestId: options.requestId } : {}),
  };
}
