import { createApp } from './app.js';
import { env } from './config/env.js';
import { installProcessGuards, logger, logLevels } from './config/logger.js';
import { disconnectDatabase, prisma } from './config/database.js';

installProcessGuards();

const app = createApp();

const server = app.listen(env.PORT, () => {
  logLevels.logStartup({
    port: env.PORT,
    environment: env.NODE_ENV,
    apiUrl: `${env.API_URL}/api/v1`,
    timezone: env.TIMEZONE,
    currency: env.CURRENCY,
  });
});

/**
 * Graceful shutdown.
 *
 * Stop accepting connections, finish in-flight requests, then close the pool.
 * Exiting before `server.close()` would drop live responses mid-write; exiting
 * without draining the pool would leave PostgreSQL holding backends until the
 * TCP timeout expires.
 */
let shuttingDown = false;

async function shutdown(signal: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logLevels.logShutdown(signal);

  const forceExit = setTimeout(() => {
    logger.error({ event: 'server.shutdown_timeout' }, 'Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));

  try {
    await disconnectDatabase();
    logger.info({ event: 'server.shutdown_complete' }, 'Shutdown complete');
  } catch (error) {
    logger.error({ err: error, event: 'server.shutdown_db_error' }, 'Error closing database pool');
    code = 1;
  }

  clearTimeout(forceExit);
  process.exit(code);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A container orchestrator probes /ready; fail fast on startup if the database
// is unreachable rather than accepting traffic that cannot be served.
if (env.JOBS_ENABLED) {
  void prisma.$queryRaw`SELECT 1`
    .then(() => logger.info({ event: 'db.connected' }, 'Database connection established'))
    .catch((error: unknown) => {
      logger.fatal({ err: error, event: 'db.unreachable' }, 'Cannot reach the database at startup');
      void shutdown('startup-db-check', 1);
    });
}

export { server, app };
