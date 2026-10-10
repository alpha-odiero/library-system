import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';
import { env, isTest } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Rate limiting.
 *
 * Four tiers, because one global limit is either too tight for the catalogue or
 * too loose for authentication:
 *   global   — protects the process from volumetric abuse
 *   strict   — authentication and password reset
 *   write    — mutations, so a compromised session cannot bulk-publish
 *   export   — expensive report generation
 *
 * Key generation uses `ipKeyGenerator`, which normalises IPv6 into a /64
 * subnet. Using the raw IP as a key would let a single host rotate through its
 * own address space to reset the counter.
 */

/** Disabled in tests so suites are never throttled by their own volume. */
const UNLIMITED = Number.MAX_SAFE_INTEGER;

function limited(tier: string) {
  return (req: Request, res: Response, _next: unknown, options: Options): void => {
    const retryAfter = Math.max(1, Math.ceil(options.windowMs / 1000));
    res.setHeader('Retry-After', String(retryAfter));

    logger.warn({ tier, event: 'ratelimit.exceeded', path: req.path }, 'Rate limit exceeded');

    res.status(429).json({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: `Too many requests. Please retry in ${retryAfter} seconds.`,
      },
      requestId: req.requestId,
    });
  };
}

export const globalRateLimit: RequestHandler = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: isTest ? UNLIMITED : env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/ready',
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  handler: limited('global'),
});

/**
 * Authentication limiter.
 *
 * Keyed by IP **and** by submitted email, so neither a single host spraying many
 * accounts nor many hosts targeting one account escapes the limit.
 */
export const authRateLimit: RequestHandler = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: isTest ? UNLIMITED : env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Only failures consume budget, so a legitimate user is never penalised.
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // `req.body` is `any` in Express's types, so the submitted address is
    // re-narrowed from `unknown` before use — an unvalidated body must never
    // flow straight into a call.
    const body: unknown = req.body;
    const submitted: unknown =
      typeof body === 'object' && body !== null ? (body as { email?: unknown }).email : undefined;

    // Lower-cased and length-capped so `A@x.com` and `a@x.com` share one budget,
    // and a 10 MB string cannot be used to inflate the key store.
    const email = typeof submitted === 'string' ? submitted.toLowerCase().trim().slice(0, 120) : '';
    return `${ipKeyGenerator(req.ip ?? 'unknown')}:${email}`;
  },
  handler: limited('auth'),
});

/** Keyed by authenticated user when available, so shared NAT egress is fair. */
export const writeRateLimit: RequestHandler = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: isTest ? UNLIMITED : Math.max(30, Math.floor(env.RATE_LIMIT_MAX / 5)),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
  handler: limited('write'),
});

/** Report/export generation is the most expensive read path in the system. */
export const exportRateLimit: RequestHandler = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: isTest ? UNLIMITED : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
  handler: limited('export'),
});

/**
 * Destructive actions (audit-log purge).
 *
 * The operation is intentionally not bundled under `writeRateLimit`: a
 * compromised administrator session could otherwise purge the log repeatedly in
 * one window. Five attempts per window caps that while leaving room for a
 * legitimate admin to confirm once. Keyed by authenticated user so a shared
 * NAT egress does not consume everyone's budget.
 */
export const sensitiveRateLimit: RequestHandler = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: isTest ? UNLIMITED : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
  handler: limited('sensitive'),
});
