/**
 * Migration drift detection.
 *
 * Answers one question: does the database that the migrations in
 * `prisma/migrations` would produce match `prisma/schema.prisma`?
 *
 * When they disagree, someone has edited the schema without writing a migration,
 * or edited a migration by hand. Either way `prisma migrate deploy` in production
 * will not produce the database that the application expects, and the first
 * symptom is a runtime error rather than a failed deploy. This turns that into a
 * CI failure.
 *
 * How it works: `prisma migrate diff` replays every migration into a throwaway
 * *shadow* database, then compares that result to the datamodel. It never touches
 * the real database.
 *
 * Scope note, and it is important: this compares only what Prisma models —
 * tables, columns, types, relations, and ordinary indexes. Prisma has no concept
 * of CHECK constraints, partial/filtered indexes, triggers, or the generated
 * columns in 20260101000100_invariants, so those are invisible here and cannot be
 * flagged. The invariants migration is therefore reviewed by hand and enforced by
 * the database tests; it is not covered by this script.
 *
 * Required environment:
 *   SHADOW_DATABASE_URL  Optional. A disposable database that may be dropped and
 *                        recreated. Falls back to DIRECT_URL with the database
 *                        name replaced by `lms_shadow`. The role needs CREATEDB.
 *   DIRECT_URL           Used for the fallback. Not used to write anything.
 *
 * Usage: npm run db:drift
 * Exit codes: 0 = in sync, 1 = drift (or an unusable environment, with a reason).
 */
import { spawnSync } from 'node:child_process';
import { URL } from 'node:url';
import { BACKEND_ROOT } from '../src/config/dotenv.js';

const MIGRATIONS_DIR = 'prisma/migrations';
const SCHEMA_PATH = 'prisma/schema.prisma';
const SHADOW_DB_NAME = 'lms_shadow';

/** Prisma's documented exit code for "there is a difference". */
const EXIT_CODE_DRIFT = 2;

type RunResult = ReturnType<typeof spawnSync>;

function fail(message: string, detail?: string): never {
  process.stderr.write(`\n[drift] FAILED: ${message}\n`);
  if (detail !== undefined && detail.length > 0) {
    process.stderr.write(`${detail}\n`);
  }
  process.exit(1);
}

function runPrisma(args: readonly string[]): RunResult {
  // --no-install keeps this offline: it uses the workspace's Prisma and fails
  // loudly instead of silently downloading a different version.
  return spawnSync('npx', ['--no-install', 'prisma', ...args], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    // Prisma writes progress to stderr, so both streams are captured together.
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
}

function combinedOutput(result: RunResult): string {
  // `spawnSync` types stdout/stderr as Buffer| string because `shell` may be
  // enabled; encoding: 'utf8' guarantees a string at runtime.
  const toText = (value: string | Buffer | null): string => (value === null ? '' : String(value));

  return `${toText(result.stdout)}${toText(result.stderr)}`.trim();
}

/** `postgresql://u:p@h:5432/lms?schema=public` -> `postgresql://u:p@h:5432/lms_shadow`. */
function shadowUrlFromDirectUrl(directUrl: string): string {
  let url: URL;
  try {
    url = new URL(directUrl);
  } catch {
    fail(
      'DIRECT_URL is not a valid URL, so no shadow database can be derived.',
      `Parse failed for: ${directUrl}`,
    );
  }

  if (url.pathname === '' || url.pathname === '/') {
    fail('DIRECT_URL does not name a database, so no shadow database can be derived.');
  }

  url.pathname = `/${SHADOW_DB_NAME}`;
  return url.toString();
}

function resolveShadowDatabaseUrl(): string {
  const explicit = process.env.SHADOW_DATABASE_URL?.trim();
  if (explicit !== undefined && explicit !== '') {
    return explicit;
  }

  const directUrl = process.env.DIRECT_URL?.trim();
  if (directUrl === undefined || directUrl === '') {
    fail(
      'Neither SHADOW_DATABASE_URL nor DIRECT_URL is set, so there is nowhere to ' +
        'build the shadow database.',
      'Both are expected to come from the repository-root .env. ' + 'Confirm that file exists.',
    );
  }

  return shadowUrlFromDirectUrl(directUrl);
}

/**
 * The shadow database must exist and must be empty; the engine creates tables
 * inside it. A stale leftover from an interrupted run makes the comparison
 * meaningless, so this checks for the usual `relation already exists` symptom.
 */
function looksLikeLeftoverShadowDatabase(output: string): boolean {
  return output.includes('already exists') && output.includes(SHADOW_DB_NAME.toLowerCase());
}

function main(): void {
  const shadowDatabaseUrl = resolveShadowDatabaseUrl();

  const result = runPrisma([
    'migrate',
    'diff',
    '--from-migrations',
    MIGRATIONS_DIR,
    '--to-schema-datamodel',
    SCHEMA_PATH,
    '--shadow-database-url',
    shadowDatabaseUrl,
    '--exit-code',
  ]);

  const output = combinedOutput(result);

  if (result.error !== undefined) {
    fail('could not execute the Prisma CLI.', result.error.message);
  }

  // Exit code 2 is the documented "drift detected" signal and is not an error
  // path, so it is handled before the generic non-zero check.
  if (result.status === EXIT_CODE_DRIFT) {
    process.stderr.write(
      '\n[drift] The migrations and prisma/schema.prisma disagree.\n' +
        'The SQL below is what the schema needs and the migrations do not contain.\n' +
        'Write a migration for it — do not edit an already-applied one.\n\n' +
        `${output}\n\n` +
        'Prisma cannot see CHECK constraints, partial indexes, triggers, or\n' +
        'generated columns, so review any hand-written SQL yourself.\n',
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    if (looksLikeLeftoverShadowDatabase(output)) {
      fail(
        `the shadow database "${SHADOW_DB_NAME}" still holds tables from an ` +
          'interrupted run, so the comparison cannot be trusted.',
        'Drop it and re-run:\n' + `  psql -d ${SHADOW_DB_NAME} -c 'DROP SCHEMA public CASCADE'`,
      );
    }

    fail(
      'the Prisma migration diff could not be completed.',
      `${output}\n\n` +
        'This is usually one of:\n' +
        '  - PostgreSQL is not running on the configured host/port\n' +
        '  - the connection string points somewhere unreachable\n' +
        '  - the role may not create a database (needs CREATEDB)\n' +
        '  - the extensions in §0 of the invariants migration are unavailable',
    );
  }

  // Prisma prints "No difference detected." on success.
  process.stdout.write('[drift] Migrations and schema are in sync.\n');
  if (output !== '') {
    process.stdout.write(`${output}\n`);
  }
}

main();
