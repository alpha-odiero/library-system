import {
  hash as argon2Hash,
  verify as argon2Verify,
  needsRehash as argon2NeedsRehash,
} from 'argon2';
import { PASSWORD_POLICY } from '../../config/constants.js';
import { argon2Options } from '../../config/env.js';
import { badRequest, unauthenticated } from '../../lib/errors.js';

/**
 * Password hashing and policy.
 *
 * Argon2id with OWASP baseline parameters (19 MiB memory, 2 iterations,
 * parallelism 1) sourced from config so each environment can tune cost without
 * a code change.
 *
 * Note the library's shape, which the docblock in `config/env.ts` also calls
 * out: `hash`/`verify`/`needsRehash` are top-level exports and `argon2id` is a
 * NUMBER identifying the algorithm inside the options object. There is no
 * `argon2` namespace to import, and passing `argon2id` where a function is
 * expected type-checks against nothing and fails only at runtime.
 */

/**
 * Hashes a password for storage.
 *
 * Argon2id salts internally, so there is no salt to generate or store. The
 * returned string is a PHC string that embeds the algorithm, parameters and salt,
 * which is what makes the parameters re-tunable later: verifying against the
 * parameters the hash was created with, not the ones configured today.
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, argon2Options);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing for every failure mode. The caller maps
 * false to one generic 401; distinguishing "no such user" from "wrong password"
 * here would turn the login endpoint into an account-enumeration oracle, because
 * the timings differ even when the message does not.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    // No options object: `verify` accepts only a `secret`, and it reads the
    // algorithm and cost parameters from the digest itself. Passing the
    // configured cost here would be meaningless — and would make verification
    // fail for any hash created under different settings.
    return await argon2Verify(hash, plain);
  } catch {
    // A malformed or missing hash is an authentication failure, not a crash.
    return false;
  }
}

/**
 * A dummy verification, run when the account does not exist.
 *
 * Without it, a request for an unknown email returns in ~1 ms while a real
 * account costs a 19 MiB Argon2 allocation, and the timing difference is enough
 * to enumerate registered members remotely. Spending the same work on both paths
 * removes the signal.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmE';

export async function burnVerificationCycles(): Promise<void> {
  try {
    await argon2Verify(DUMMY_HASH, 'not-the-password');
  } catch {
    // The point is the elapsed work, not the result.
  }
}

/**
 * Whether a password is on the denylist, in any of the forms attackers actually
 * try.
 *
 * An exact-match check is nearly useless here, and the reason is specific to
 * this policy: `PASSWORD_POLICY.MIN_LENGTH` is 12, so almost every entry in a
 * conventional denylist (`password123`, `trustno1`, `qwerty123`) is already
 * rejected by the length rule and never reaches the list. The check that matters
 * is the SECOND one below — the stem.
 *
 * The dominant real-world pattern is a dictionary word with digits and/or
 * symbols appended, because that is what every "add a special character" rule
 * teaches users to produce: `password123456!`, `Dragon1`, `qwerty2024`.
 * Comparing the letters alone catches the whole family in one lookup.
 *
 * The cost is a false positive or two — `Sunshine#2026` reduces to `sunshine`
 * and is refused. That is the intended trade: the user picks another passphrase,
 * and the alternative is accepting every word-plus-digits mutation of a known
 * leaked password.
 *
 * A production deployment should replace this 23-entry set with a breach corpus
 * (e.g. HIBP's top-passwords, loaded at boot) and additionally reject any value
 * that appears in a breach database — which this function has no access to by
 * design, since it must stay synchronous and offline-testable.
 */
function isCommonPassword(plain: string): boolean {
  const lower = plain.toLowerCase();
  if (PASSWORD_POLICY.COMMON_DENYLIST.has(lower)) return true;

  // Strip everything that is not a letter, collapsing `P@ssw0rd` to `psswrd`
  // and `password123456!` to `password`.
  const stem = lower.replace(/[^a-z]/g, '');
  return stem.length > 0 && PASSWORD_POLICY.COMMON_DENYLIST.has(stem);
}

/**
 * Enforces the password policy.
 *
 * Returns the list of failures so the client can show every problem at once
 * rather than one per round trip. Password STRENGTH feedback is only safe
 * because it is computed entirely server-side: a client-side strength meter is
 * trivially bypassed and would give the false impression the check exists.
 */
export function validatePasswordStrength(plain: string): void {
  const issues: Array<{ path: string; message: string }> = [];

  if (plain.length < PASSWORD_POLICY.MIN_LENGTH) {
    issues.push({
      path: 'password',
      message: `Must be at least ${PASSWORD_POLICY.MIN_LENGTH} characters`,
    });
  }

  // Argon2 itself has no length ceiling, but an unbounded input is a denial-of-
  // service primitive: hashing a 10 MB "password" costs the server ~10 MB of
  // memory per attempt. 128 characters is far beyond any real passphrase.
  if (plain.length > PASSWORD_POLICY.MAX_LENGTH) {
    issues.push({
      path: 'password',
      message: `Must be at most ${PASSWORD_POLICY.MAX_LENGTH} characters`,
    });
  }

  if (isCommonPassword(plain)) {
    issues.push({ path: 'password', message: 'This password is too common' });
  }

  // Character-class rules. NIST SP 800-63B advises against composition rules and
  // recommends length plus a breached-corpus check; this is a middle path —
  // classes plus length, no "must look like a password" regex.
  if (!/[a-z]/.test(plain)) {
    issues.push({ path: 'password', message: 'Must contain a lowercase letter' });
  }
  if (!/[A-Z]/.test(plain)) {
    issues.push({ path: 'password', message: 'Must contain an uppercase letter' });
  }
  if (!/\d/.test(plain)) {
    issues.push({ path: 'password', message: 'Must contain a digit' });
  }

  if (issues.length > 0) {
    throw badRequest('Password does not meet the security policy', issues);
  }
}

/**
 * Compares a new password against the current one during a change.
 *
 * Refusing a reuse of the same password is not something the strength check can
 * do, and is the single most effective defence after a credential stuffing
 * attempt has already succeeded once.
 */
export async function assertDifferentFromCurrent(currentHash: string, next: string): Promise<void> {
  if (await verifyPassword(currentHash, next)) {
    throw badRequest('Choose a password you have not used before', [
      { path: 'newPassword', message: 'Must differ from the current password' },
    ]);
  }
}

/**
 * True when the stored hash was produced with weaker parameters than configured.
 *
 * Synchronous, matching the library: it only reads fields out of the encoded
 * digest string, so there is nothing to await.
 */
export function needsRehash(hash: string): boolean {
  try {
    return argon2NeedsRehash(hash, argon2Options);
  } catch {
    // An unparseable digest cannot be verified either; treat it as needing a
    // rehash rather than letting a stale parameter set survive.
    return true;
  }
}

/**
 * Generic authentication failure.
 *
 * Every path that cannot authenticate a caller — unknown email, wrong password,
 * deleted account, unverified email — throws exactly this. One message, one code,
 * one status. Anything more specific is an enumeration oracle.
 */
export function invalidCredentials(): ReturnType<typeof unauthenticated> {
  return unauthenticated('Invalid email or password', 'INVALID_CREDENTIALS');
}
