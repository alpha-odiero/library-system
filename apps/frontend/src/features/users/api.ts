import type { RoleCode, UserStatusDto } from '@lms/shared';
import type { Paginated } from '../../lib/api';
import { api } from '../../lib/api';

/**
 * Staff accounts — the directory an administrator provisions LIBRARIAN logins
 * through.
 *
 * Response shapes are declared here rather than imported: the backend builds the
 * DTO inline in `users.service.ts` (`toUserDto`) and exposes no shared schema for
 * it yet. These types are the contract — when the backend grows one, this file is
 * what gets deleted.
 *
 * The absence of a role field on `UserCreateInput` is the module's central rule,
 * not an oversight. `POST /users` provisions LIBRARIAN every time, the role row is
 * resolved server-side from a constant, and `userCreateSchema` is `.strict()`, so
 * a body carrying `role` fails validation rather than being silently dropped. A
 * form that offered the choice would be promising the administrator something the
 * server will not do, and a client that could send one would be a mass-assignment
 * hole shaped like a select box. Filtering the *list* by `roleCode` is a
 * different question — it reads a role the account already has.
 */

/** The projection the directory renders. It never carries a credential. */
export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  status: UserStatusDto;
  roleCode: RoleCode;
  roleName: string;
  /** Staff number issued by the library, or null when none was recorded. */
  employeeId: string | null;
  profileImageUrl: string | null;
  emailVerified: boolean;
  /** Always true on creation: the credential was chosen for, not by, its owner. */
  mustChangePassword: boolean;
  /** Null for an account with no desk assigned. */
  primaryBranch: { id: string; code: string; name: string } | null;
  /** Instants, ISO-8601 with offset. Null until the account first signs in. */
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Query filters are declared as `type`, not `interface`, on purpose: TypeScript
 * gives a type alias an implicit index signature and an interface none, so an
 * interface is not assignable to the client's `Record<string, string | number |
 * boolean | null | undefined>` query type. An interface here fails to compile at
 * the call site, which is a confusing error for what is really a shape rule.
 *
 * `| undefined` on every optional key, so a filter object may carry an explicit
 * `undefined` for "not filtering" without `exactOptionalPropertyTypes` rejecting
 * the spread.
 */
export type UserFilters = {
  page?: number | undefined;
  limit?: number | undefined;
  sort?: string | undefined;
  direction?: 'asc' | 'desc' | undefined;
  roleCode?: RoleCode | undefined;
  status?: UserStatusDto | undefined;
  q?: string | undefined;
};

/**
 * `| undefined` on every optional key.
 *
 * With `exactOptionalPropertyTypes`, `phone?: string` forbids passing
 * `phone: undefined` explicitly — and building a body by spreading conditional
 * fields (`...(value ? { phone: value } : {})`) produces exactly that in the
 * general case, so the key type has to admit it.
 *
 * There is deliberately no `role`: see the note at the top of this file.
 */
export type UserCreateInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | undefined;
  employeeId?: string | undefined;
  branchId?: string | undefined;
  profileImageUrl?: string | undefined;
  temporaryPassword?: string | undefined;
};

/* ── Accounts ───────────────────────────────────────────────────────────────── */

export function listUsers(filters: UserFilters, signal?: AbortSignal): Promise<Paginated<UserDto>> {
  return api.get<UserDto[]>('/users', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<UserDto>>;
}

/**
 * Provisions a LIBRARIAN account.
 *
 * `temporaryPassword` in the response exists exactly once, in this response. The
 * server keeps only an Argon2 hash, so the plaintext cannot be read back, which
 * is also why there is no "resend password": a credential that could be fetched
 * again would be a stored secret the whole module is built to avoid. It is `null`
 * when the administrator supplied their own — repeating that back would put a
 * second copy of a known secret into a response log.
 */
export function createUser(input: UserCreateInput) {
  return api.post<{ user: UserDto; temporaryPassword: string | null }>('/users', input);
}
