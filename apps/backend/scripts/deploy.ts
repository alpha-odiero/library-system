/**
 * Deployment gate for database migrations.
 *
 * `prisma migrate deploy` is the only command allowed to touch a deployed
 * database, and on its own it is a weak guarantee: it exits 0 after applying
 * whatever SQL it was given, including SQL that silently did nothing. A dropped
 * partial index, a missing extension, or an index created outside a transaction
 * all "succeed" while leaving the concurrency guarantees unenforced.
 *
 * So this runs the deploy and then proves the invariants are actually present in
 * the target database. A missing object is a hard failure with the migration
 * named, because the alternative is discovering it in production during a
 * double-borrowing race.
 *
 * Usage:
 *   npm run db:deploy              # deploy, then verify
 *   npm run db:deploy -- --skip-verify   # deploy only (not recommended)
 *
 * Exit codes: 0 = applied and verified, 1 = precondition, deploy, or
 * verification failure. Nothing is rolled back automatically: migrations are
 * forward-only, and the script will not invent a compensating down-migration.
 */
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { BACKEND_ROOT } from '../src/config/dotenv.js';

/**
 * Objects that 20260101000100_invariants creates and that carry the business
 * and concurrency guarantees. Every one is asserted after a deploy.
 */
const REQUIRED_INDEXES = [
  'uq_loan_one_open_per_copy',
  'uq_reservation_one_open_per_member_book',
  'uq_digital_loan_one_open_per_member_resource',
  'uq_fine_one_overdue_per_loan',
  'uq_book_one_primary_category',
  'uq_reservation_position_live',
  'idx_book_copies_barcode_trgm',
  'idx_book_copies_accession_trgm',
  'idx_books_title_trgm',
  'idx_books_subtitle_trgm',
  'idx_books_fulltext',
  'idx_authors_fulltext',
  'idx_books_subjects_gin',
  'idx_books_title_lower',
  'idx_fines_member_status_assessed',
  'idx_loans_open_due_date',
  'idx_reservations_ready_hold',
] as const;

/** §0 of the same migration. The trigram indexes fail without pg_trgm. */
const REQUIRED_EXTENSIONS = ['pg_trgm', 'unaccent'] as const;

const INVARIANTS_MIGRATION = '20260101000100_invariants';

function fail(message: string, detail?: string): never {
  process.stderr.write(`\n[deploy] FAILED: ${message}\n`);
  if (detail !== undefined && detail.length > 0) {
    process.stderr.write(`${detail}\n`);
  }
  process.exit(1);
}

function runPrisma(args: readonly string[]): { status: number | null; output: string } {
  const result = spawnSync('npx', ['--no-install', 'prisma', ...args], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  if (result.error !== undefined) {
    fail('could not execute the Prisma CLI.', result.error.message);
  }

  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function assertPreconditions(): void {
  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    fail(
      'DATABASE_URL is not set, so there is no target.',
      'Expected it from the repository-root .env.',
    );
  }

  // A shadow/scratch database is a different shape and verifying it proves
  // nothing about the deployed one. The drift script derives one from DIRECT_URL;
  // catching that mistake here beats a green deploy against the wrong database.
  if (databaseUrl.includes('lms_shadow')) {
    fail(
      'DATABASE_URL points at a shadow database. Refusing to deploy against it.',
      'Point DIRECT_URL at the database being deployed to.',
    );
  }

  const validate = runPrisma(['validate']);
  if (validate.status !== 0) {
    fail(
      'prisma/schema.prisma does not validate, so there is nothing safe to deploy.',
      validate.output,
    );
  }
}

function deploy(): void {
  process.stdout.write('[deploy] Applying migrations...\n');

  // `deploy`, never `dev`: `dev` may reset the database to match the schema,
  // which on a deployed database is data loss.
  const result = runPrisma(['migrate', 'deploy']);
  if (result.status !== 0) {
    fail('prisma migrate deploy did not succeed.', result.output);
  }

  process.stdout.write(`${result.output}\n`);
}

/** Confirms no migration is left pending or failed after the deploy. */
function assertNoPendingMigrations(): void {
  const status = runPrisma(['migrate', 'status']);
  const output = status.output.toLowerCase();

  if (status.status !== 0 || output.includes('failed')) {
    fail('prisma migrate status reports a failed or incomplete migration.', status.output);
  }

  // Prisma reports queued-but-unapplied migrations as "pending".
  if (output.includes('pending')) {
    fail('migrations are still pending after deploy, so the schema is incomplete.', status.output);
  }
}

type IndexRow = { indexname: string };
type ExtensionRow = { extname: string };
type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

async function verifyInvariants(prisma: PrismaClient): Promise<void> {
  const indexes = await prisma.$queryRaw<IndexRow[]>`
    SELECT indexname FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname = ANY(${[...REQUIRED_INDEXES]}::text[])`;

  const found = new Set(indexes.map((row) => row.indexname));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !found.has(name));

  if (missingIndexes.length > 0) {
    fail(
      'invariant indexes are missing from the database. The concurrency ' +
        'guarantees are NOT enforced.',
      `${missingIndexes.join('\n')}\n\n` +
        `Check that ${INVARIANTS_MIGRATION} was applied, and that it was not ` +
        'edited after being applied to a live database.',
    );
  }

  const extensions = await prisma.$queryRaw<ExtensionRow[]>`
    SELECT extname FROM pg_extension
     WHERE extname = ANY(${[...REQUIRED_EXTENSIONS]}::text[])`;

  const foundExtensions = new Set(extensions.map((row) => row.extname));
  const missingExtensions = REQUIRED_EXTENSIONS.filter((name) => !foundExtensions.has(name));

  if (missingExtensions.length > 0) {
    fail(
      'required PostgreSQL extensions are missing, so search indexes and ' +
        'unaccent-based lookup cannot work.',
      missingExtensions.join('\n'),
    );
  }

  const migration = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
     WHERE migration_name = ${INVARIANTS_MIGRATION}`;

  const applied = migration[0];
  if (applied === undefined) {
    fail(
      `${INVARIANTS_MIGRATION} is not recorded in _prisma_migrations, so it ` +
        'never ran against this database.',
      'Deploy every migration, not a subset.',
    );
  }

  if (applied.finished_at === null || applied.rolled_back_at !== null) {
    fail(
      `${INVARIANTS_MIGRATION} did not finish successfully.`,
      `finished_at=${String(applied.finished_at)} rolled_back_at=${String(applied.rolled_back_at)}`,
    );
  }

  process.stdout.write(
    `[deploy] Verified ${REQUIRED_INDEXES.length} invariant indexes, ` +
      `${REQUIRED_EXTENSIONS.length} extensions, and ${INVARIANTS_MIGRATION}.\n`,
  );
}

async function main(): Promise<void> {
  const skipVerify = process.argv.includes('--skip-verify');

  assertPreconditions();
  deploy();
  assertNoPendingMigrations();

  if (skipVerify) {
    process.stdout.write(
      '[deploy] Verification skipped. Invariants are unproven — treat this as a ' +
        'partial deploy.\n',
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    await verifyInvariants(prisma);
  } finally {
    await prisma.$disconnect();
  }

  process.stdout.write('[deploy] Migrations applied and verified.\n');
}

await main();
