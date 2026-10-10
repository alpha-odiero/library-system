#!/usr/bin/env node
/**
 * Fails the build unless the dependency audit matches the accepted set.
 *
 * ## Why this exists instead of `npm audit --audit-level=high`
 *
 * Two things are true at once on this repository:
 *
 *   1. `argon2` and `express` parse untrusted input, so a high-severity advisory
 *      in either is a genuine release blocker.
 *   2. Prisma's CLI internals carry four high-severity advisories with no patched
 *      stable release. npm's only remedy is a downgrade to 6.12.0, which trades a
 *      known, understood, unreachable advisory for an older set of unknown ones.
 *
 * `npm audit` cannot express "high, except these". The available workarounds are
 * both bad: `--audit-level=critical` silently stops catching (1), and `|| true`
 * stops catching everything. This script asserts the invariant that is actually
 * held — no critical advisories, and the high-severity set is exactly the accepted
 * list — so a *new* high-severity advisory still fails the build while the four
 * reviewed ones do not block every merge until Prisma publishes a fix.
 *
 * ## Usage
 *
 *   node scripts/check-audit.mjs          # human-readable report
 *   node scripts/check-audit.mjs --json   # machine-readable, for other tooling
 *
 * Exit codes: 0 audit matches the accepted set; 1 it does not; 2 the audit itself
 * could not be read (which is treated as a failure, never as a pass).
 */

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

/** `npm audit --json` exits non-zero whenever it finds anything; the report is still valid. */
async function readAudit() {
  // Windows resolves `npm` to a `.cmd` shim, and Node refuses to spawn a `.cmd`
  // without a shell. The shell is therefore used on Windows only — on POSIX
  // `execFile` is kept, since it does no argument re-parsing at all. The command
  // is one fully-controlled literal with no interpolation, which is what makes the
  // Windows path safe as well as working.
  const windows = process.platform === 'win32';
  const command = windows ? 'npm audit --json' : 'npm';
  const args = windows ? [] : ['audit', '--json'];

  try {
    const { stdout } = await run(command, args, {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
      ...(windows ? { shell: true } : {}),
    });
    return JSON.parse(stdout);
  } catch (error) {
    // A non-zero exit is the normal case. Only an unreadable report is a failure.
    if (typeof error.stdout === 'string' && error.stdout.trim() !== '') {
      return JSON.parse(error.stdout);
    }
    throw new Error(`Could not read the audit report: ${error.message}`);
  }
}

async function readAccepted() {
  const raw = await readFile(join(root, 'security', 'accepted-advisories.json'), 'utf8');
  return JSON.parse(raw).acceptedHigh ?? [];
}

/** `@prisma/client > prisma > effect` reports as `prisma`; only top-level names are comparable. */
function names(advisories) {
  return new Set(Object.keys(advisories));
}

function difference(left, right) {
  return [...left].filter((item) => !right.has(item)).sort();
}

async function main() {
  const report = await readAudit();
  const accepted = await readAccepted();
  const vulnerabilities = report.vulnerabilities ?? {};

  const actualHigh = names(
    Object.fromEntries(Object.entries(vulnerabilities).filter(([, v]) => v.severity === 'high')),
  );
  const critical = names(
    Object.fromEntries(Object.entries(vulnerabilities).filter(([, v]) => v.severity === 'critical')),
  );
  const expectedHigh = names(
    Object.fromEntries(accepted.flatMap((entry) => entry.packages.map((p) => [p, true]))),
  );

  const failures = [];

  if (critical.size > 0) {
    failures.push(
      `Critical advisories are never accepted: ${[...critical].sort().join(', ')}. ` +
        'Fix these, or remove the feature that pulls them in.',
    );
  }

  const unexpected = difference(actualHigh, expectedHigh);
  if (unexpected.length > 0) {
    failures.push(
      `Unexpected high-severity advisories: ${unexpected.join(', ')}. ` +
        'Either upgrade the dependency, or — if it is genuinely unreachable — add it to ' +
        'security/accepted-advisories.json with a reason and a review date.',
    );
  }

  const resolved = difference(expectedHigh, actualHigh);
  if (resolved.length > 0) {
    failures.push(
      `Accepted advisories that no longer apply: ${resolved.join(', ')}. ` +
        'Remove them from security/accepted-advisories.json — an allowance for a fixed ' +
        'advisory is dead weight that hides the next one.',
    );
  }

  const result = {
    ok: failures.length === 0,
    critical: [...critical].sort(),
    high: [...actualHigh].sort(),
    accepted: [...expectedHigh].sort(),
    failures,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `Audit matches the accepted set. 0 critical; high: ${result.high.join(', ') || 'none'} (accepted).\n`,
    );
  } else {
    for (const failure of failures) process.stderr.write(`  ✗ ${failure}\n`);
  }

  process.exitCode = result.ok ? 0 : 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`  ✗ ${error.message}\n`);
  process.exitCode = 2;
}