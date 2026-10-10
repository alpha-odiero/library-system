import type { PermissionCode, RoleCode } from '@lms/shared';

/**
 * The session contract, mirroring `GET /api/v1/auth/me` exactly.
 *
 * Duplicated rather than imported because the backend builds this object inline
 * in its route handler; there is no shared Zod schema for it. The moment the
 * backend grows one, this type is replaced by `z.infer` of it — the field names
 * below are the contract, and a rename breaks the compiler here rather than
 * silently blanking a permission list in the UI.
 */
export interface MeResponse {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Contact number on file; `null` when the account has none. */
  phone: string | null;
  roleCode: RoleCode;
  /** Null for staff, who have no member record. */
  memberId: string | null;
  permissions: PermissionCode[];
  /** Null means every branch; `[]` would mean none. */
  branchScope: string[] | null;
  /**
   * The user's library. `null` means NO library scope — the account may
   * authenticate but must not perform library-scoped operations.
   *
   * It does NOT mean "every library". The UI must never read this as a licence to
   * show tenant data: the API refuses those requests regardless of what the client
   * displays, and this field exists only so the app can explain WHY a screen is
   * empty instead of looking broken.
   */
  libraryScope: string | null;
  /** The user's home branch, for the header's `Role • Branch` line. */
  primaryBranchName: string | null;
  /** The user's home library, shown beside the branch. Null when unresolved. */
  libraryName: string | null;
  sessionId: string;
}

/**
 * `Grace Wanjiru`, falling back to the email local part for an account whose name
 * fields are blank. Never the raw address: an email address in a greeting reads
 * like a support ticket number.
 */
export function displayName(session: MeResponse | null): string {
  if (!session) return '';
  const name = `${session.firstName} ${session.lastName}`.trim();
  if (name) return name;
  return session.email.split('@')[0]?.replace(/[._-]+/g, ' ') || session.email;
}

/** `GW` — the header avatar. Falls back to a single glyph, never empty. */
export function displayInitials(session: MeResponse | null): string {
  const first = session?.firstName.trim().charAt(0) ?? '';
  const last = session?.lastName.trim().charAt(0) ?? '';
  const initials = `${first}${last}`.toUpperCase();
  if (initials) return initials;
  return session?.email.trim().charAt(0).toUpperCase() || 'U';
}

/** `POST /auth/login` → the identity the UI renders, minus the tokens. */
export interface LoginResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    fullName: string;
    status: string;
    roleCode: RoleCode;
    mustChangePassword: boolean;
    emailVerified: boolean;
  };
  expiresInSeconds: number;
  refreshExpiresAt: string;
}

export interface RegisterResult {
  requiresEmailVerification: boolean;
  /** Public registration always creates an administrator; echoed so the client can say so. */
  roleCode: RoleCode;
}

export interface FieldIssue {
  path?: string;
  message: string;
  code?: string;
}

/**
 * Turns an error payload's `details` into a field → message map for forms.
 *
 * The backend sends `details` as `FieldIssue[]` for validation failures and as a
 * plain record for some domain errors. Both shapes appear, so both are handled
 * rather than assuming the array.
 */
export function fieldErrors(details: unknown): Record<string, string> {
  if (!details) return {};

  if (Array.isArray(details)) {
    const map: Record<string, string> = {};
    for (const issue of details as FieldIssue[]) {
      const path = issue.path ?? 'form';
      // First message wins: the server sends the most specific issue first, and a
      // later generic one must not overwrite it.
      map[path] ??= issue.message;
    }
    return map;
  }

  if (typeof details === 'object') {
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
      if (typeof value === 'string') map[key] = value;
    }
    return map;
  }

  return {};
}
