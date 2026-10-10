import { PrismaClient } from '@prisma/client';
import { env, isDevelopment } from './env.js';

/**
 * Prisma client lifecycle.
 *
 * A single instance is shared across the process. In development the module is
 * cached on `globalThis` so `tsx watch` reloads do not leak a connection pool
 * per save (which would exhaust PostgreSQL's `max_connections` within minutes).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDevelopment
      ? [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : ['error'],
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
  });

if (isDevelopment) globalForPrisma.prisma = prisma;

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Runs `fn` inside a transaction.
 *
 * Services own transaction boundaries — repositories never open their own.
 * `maxWait`/`timeout` are set explicitly so a contended row lock surfaces as a
 * clear P2028 rather than a hung request.
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  },
): Promise<T> {
  return prisma.$transaction(fn, {
    maxWait: options?.maxWait ?? 10_000,
    timeout: options?.timeout ?? 20_000,
    isolationLevel: options?.isolationLevel,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
