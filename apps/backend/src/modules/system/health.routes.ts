import { Router } from 'express';
import { sendOk } from '../../lib/response.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { env } from '../../config/env.js';
import { prisma } from '../../config/database.js';

/**
 * Health endpoints.
 *
 * Deliberately OUTSIDE /api/v1 and outside the auth/CSRF/rate-limit chain — an
 * orchestrator must be able to reach them without credentials.
 *
 *   /health  liveness  — "is this process running?" Never touches the database.
 *   /ready   readiness — "can this process serve traffic?" Verifies PostgreSQL
 *                        and that migrations have been applied.
 *
 * Conflating the two causes a real outage: a transient database blip would
 * otherwise restart every container instead of merely draining it.
 */

const startedAt = Date.now();

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  sendOk(res, {
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    environment: env.NODE_ENV,
    version: process.env.npm_package_version ?? '1.0.0',
  });
});

// Wrapped: Express 4 does not catch rejected promises from async handlers.
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    let ready = true;

    // Database connectivity — the only hard dependency.
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (error) {
      ready = false;
      checks.database = {
        ok: false,
        detail: error instanceof Error ? error.name : 'unknown error',
      };
    }

    // Migration drift: an unapplied migration means the binary does not match the
    // schema, so the process must not receive traffic even though it can connect.
    if (ready) {
      try {
        const applied = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
        `;
        const count = Number(applied[0]?.count ?? 0);
        checks.migrations = { ok: count > 0, detail: `${count} applied` };
        if (count === 0) ready = false;
      } catch {
        // _prisma_migrations absent means the database has never been migrated.
        checks.migrations = { ok: false, detail: 'no migration history found' };
        ready = false;
      }
    }

    res.status(ready ? 200 : 503).json({
      success: ready,
      data: { ready, checks },
    });
  }),
);
