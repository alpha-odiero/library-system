import type { Response } from 'supertest';

/**
 * Supertest types `response.body` as `any`, because the shape depends on whatever
 * the handler produced. Reading members off that `any` silently accepts a
 * misspelled field and makes an assertion vacuous.
 *
 * These helpers force the body through `unknown` and then into a declared shape,
 * so a renamed envelope field becomes a type error rather than a test that passes
 * because `undefined !== undefined` is false.
 */
export function bodyOf<T>(response: Response): T {
  const raw: unknown = response.body;
  return raw as T;
}

export interface SuccessBody<T> {
  success: true;
  data: T;
  message?: string;
  requestId?: string;
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

/** Serialised body, for negative assertions about what is NOT leaked. */
export function rawBody(response: Response): string {
  const raw: unknown = response.body;
  return typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
}
