import { statusForApiCode, type ApiErrorCode, type DomainCode } from '@lms/shared';

export interface FieldIssue {
  path: string;
  message: string;
}

/**
 * The one error type the application throws.
 *
 * Everything the API can return as a failure is an AppError. Anything else that
 * reaches the error handler is treated as an unexpected fault: logged with full
 * detail server-side, reported to the client as a bare INTERNAL_ERROR.
 *
 * This is the single reason stack traces, SQL, and filesystem paths cannot leak
 * to a client — the handler has no way to express them.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: FieldIssue[] | Record<string, unknown>;
  /** Operator-facing context. Logged, never serialised to the client. */
  readonly logContext?: Record<string, unknown>;
  readonly expose = true;

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: {
      details?: FieldIssue[] | Record<string, unknown>;
      logContext?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = statusForApiCode(code);
    this.details = options?.details;
    this.logContext = options?.logContext;
    Error.captureStackTrace?.(this, AppError);
  }
}

/* ── Convenience constructors ─────────────────────────────────────────────── */

/** 400 — the request itself is malformed. */
export const badRequest = (message: string, details?: FieldIssue[]): AppError =>
  new AppError('VALIDATION_ERROR', message, { details });

/** 401 — no valid session. Deliberately never says *which* factor failed. */
export const unauthenticated = (
  message = 'Authentication required',
  code: ApiErrorCode = 'UNAUTHENTICATED',
) => new AppError(code, message);

/**
 * 403 — authenticated, but not permitted.
 *
 * `requiredPermission` is included only when the caller is already an
 * authenticated staff member, so it aids debugging without telling an anonymous
 * prober what the authorization model looks like.
 */
export const forbidden = (
  message = 'You do not have permission to perform this action',
  requiredPermission?: string,
): AppError =>
  new AppError('FORBIDDEN', message, {
    details: requiredPermission ? { requiredPermission } : undefined,
  });

/** 404 — resource does not exist, or must not be revealed that it exists. */
export const notFound = (resource = 'Resource', id?: string): AppError =>
  new AppError('NOT_FOUND', `${resource} not found`, { logContext: { resource, id } });

/** 409 — the world disagrees with the request. */
export const conflict = (
  code: DomainCode,
  message: string,
  logContext?: Record<string, unknown>,
): AppError => new AppError(code, message, { logContext });

/** 422 — well-formed but semantically invalid. */
export const unprocessable = (message: string, details?: FieldIssue[]): AppError =>
  new AppError('UNPROCESSABLE_ENTITY', message, { details });

/** 422 — a domain rule rejected the value (overpayment, invalid money, …). */
export const invalidOperation = (
  code: DomainCode,
  message: string,
  details?: FieldIssue[],
): AppError => new AppError(code, message, { details });

/**
 * Maps a Zod error into the standard 400 shape.
 *
 * Only the field path and message are surfaced — never the received value, so a
 * validation failure cannot echo a password or card number back to the client.
 */
export function fromZodError(error: {
  issues: readonly { path: (string | number)[]; message: string }[];
}): AppError {
  const details: FieldIssue[] = error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

  return new AppError('VALIDATION_ERROR', 'Request validation failed', { details });
}
