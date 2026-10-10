import { ROLE_CODES, type RoleCode } from '@lms/shared';
import { unprocessable } from '../../lib/errors.js';

/**
 * The account-type check behind the login screen's role selector.
 *
 * `loginAs` is what the user CLAIMS to be signing in as; `roleCode` is what the
 * account actually holds. The password decides nothing about role — the account's
 * stored role is the only authority, and the selector can only make a mismatch an
 * error rather than a silent wrong-door sign-in (a member who signs in on the
 * staff tab would otherwise land on a dashboard their permissions cannot fill).
 *
 * Deliberately NOT an authentication failure: the caller has proven the password,
 * so a 401 here would say "wrong credentials" about a request that had the right
 * ones. 422 keeps the generic 401 surface intact and names the problem instead.
 *
 * Kept in its own module (no Prisma, no env) so the rule is unit-testable as a
 * pure function — this is the check the RBAC acceptance tests exercise directly.
 */

/** Human labels for each account type, for the mismatch message. */
const ACCOUNT_TYPE_LABELS: Record<RoleCode, string> = {
  ADMIN: 'library administrator',
  LIBRARIAN: 'librarian',
  MEMBER: 'member',
};

/** Label for a role code, falling back to a generic term for an unknown code. */
export function accountTypeLabel(roleCode: string): string {
  return ACCOUNT_TYPE_LABELS[roleCode as RoleCode] ?? 'staff';
}

/**
 * Throws 422 when the selected account type does not match the account's role.
 *
 * No selection (`loginAs` absent) is accepted: non-browser clients and older
 * callers do not send one, and their sign-ins must not break. The check only
 * ever narrows a wrong choice; it never grants one.
 */
export function assertRoleSelection(actualRoleCode: string, loginAs?: RoleCode): void {
  if (!loginAs || loginAs === actualRoleCode) return;

  throw unprocessable(
    `These credentials belong to a ${accountTypeLabel(actualRoleCode)} account. ` +
      'Choose the matching account type and try again.',
  );
}

/** True when `value` is one of the selectable account types. */
export function isSelectableRole(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value);
}
