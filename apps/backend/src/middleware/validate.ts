import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { fromZodError } from '../lib/errors.js';

/**
 * Request validation.
 *
 * Validation replaces the raw container with the PARSED value, so a handler
 * physically cannot read an unvalidated string: `req.body` holds the output of
 * the schema, with defaults applied and unknown keys stripped by `.strict()`.
 *
 * This is also the mass-assignment defence. A body containing `roleId` against a
 * member schema fails validation instead of silently reaching Prisma.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

interface ValidationTargets {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(targets: ValidationTargets): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.validated ??= {};

      if (targets.params) {
        // The schema is the authority on shape, but its output is only `any` at
        // this level. Parsed into `unknown` first, then asserted once — rather
        // than letting an `any` reach a typed destination unchecked.
        const parsed: unknown = targets.params.parse(req.params);
        req.params = parsed as Request['params'];
      }
      if (targets.query) {
        // Express 5 makes req.query a getter-only property; assigning to a
        // dedicated field keeps this working across both major versions.
        const parsed: unknown = targets.query.parse(req.query);
        req.validated.query = parsed;
      }
      if (targets.body) {
        const parsed: unknown = targets.body.parse(req.body);
        req.validated.body = parsed;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(fromZodError(error));
        return;
      }
      next(error);
    }
  };
}

/**
 * Typed accessors for validated data.
 *
 * Callers pass the schema they validated with, so inference at the call site is
 * exact. The assertions themselves are unverifiable by the compiler because
 * `ZodTypeAny` carries an `any` output — see the scoped rule override in
 * `eslint.config.mjs`, which documents the same trade-off.
 */
export const validated = {
  body<T extends ZodTypeAny>(req: Request, _schema?: T): T['_output'] {
    if (req.validated?.body === undefined) {
      throw new Error('validate({ body }) was not applied to this route');
    }
    return req.validated.body as unknown as T['_output'];
  },
  query<T extends ZodTypeAny>(req: Request, _schema?: T): T['_output'] {
    if (req.validated?.query === undefined) {
      throw new Error('validate({ query }) was not applied to this route');
    }
    return req.validated.query as unknown as T['_output'];
  },
  params<T extends ZodTypeAny>(req: Request, _schema?: T): T['_output'] {
    return req.params as unknown as T['_output'];
  },
};

/**
 * Rejects any request body key that is not explicitly allowed.
 *
 * A belt-and-braces guard for endpoints where validation was intentionally kept
 * permissive: an unexpected key means the caller is sending fields we do not
 * model, and rejecting is safer than ignoring.
 */
export function rejectUnknownBodyKeys(allowed: readonly string[]): RequestHandler {
  const allowSet = new Set(allowed.map((k) => k.toLowerCase()));

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      const unexpected = Object.keys(req.body as Record<string, unknown>).filter(
        (key) => !allowSet.has(key.toLowerCase()),
      );

      if (unexpected.length > 0) {
        next(
          fromZodError({
            issues: unexpected.map((key) => ({ path: [key], message: 'Unrecognised field' })),
          }),
        );
        return;
      }
    }
    next();
  };
}
