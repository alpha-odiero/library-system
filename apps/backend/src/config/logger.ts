import pino, { type Logger } from 'pino';
import { env, isDevelopment, isProduction } from './env.js';
import { REDACT_PATHS } from '../lib/redact.js';

/**
 * Structured logging.
 *
 * Redaction happens in the serializer, not at call sites: a developer must not
 * have to remember that `password` is sensitive. `req.headers.authorization`
 * and `req.headers.cookie` are redacted wholesale.
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'lms-api', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      ...REDACT_PATHS,
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'req.headers["set-cookie"]',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
      '*.token',
      '*.tokenHash',
      '*.secret',
      '*.pin',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,service,env',
      },
    },
  }),
});

/** A logger bound to a requestId, so every line of a request correlates. */
export function requestLogger(requestId: string, base?: Record<string, unknown>): Logger {
  return logger.child({ requestId, ...base });
}

/**
 * Stderr only. Used by the bootstrap path, before a request exists and outside
 * the request/response cycle (startup failures, crash handlers).
 */
export const stdoutLogger: Logger = logger;

export const logLevels = {
  logStartup: (info: Record<string, unknown>) => logger.info({ ...info, event: 'server.startup' }),
  logShutdown: (signal: string) => logger.warn({ signal, event: 'server.shutdown' }),
};

/** Never let a stray rejection take the process down silently. */
export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    logger.fatal(
      { err: reason, event: 'process.unhandled_rejection' },
      'Unhandled promise rejection',
    );
    if (isProduction) process.exitCode = 1;
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error, event: 'process.uncaught_exception' }, 'Uncaught exception');
    // An uncaught exception leaves the process in an undefined state.
    process.exit(1);
  });
}

export { isDevelopment, isProduction };
