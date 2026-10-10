import type { MemberStatusDto } from '@lms/shared';
import type { Paginated } from '../../lib/api';
import { api } from '../../lib/api';

/**
 * Members and member types.
 *
 * Response shapes are declared here rather than imported: the backend builds each
 * DTO inline in `members.service.ts` and exposes no shared schema for them yet.
 * These types are the contract — when the backend grows Zod schemas, this file is
 * what gets deleted.
 *
 * `branchScope` is not requested. There is no branch picker in this build: the
 * server filters by the caller's scope, and a client that could send an arbitrary
 * `branchId` would be asking a question the answer to is already enforced. The
 * filter parameter exists for a future multi-branch admin, not for this page.
 */

export interface BranchRef {
  id: string;
  code: string;
  name: string;
}

export interface MemberTypeSummary {
  id: string;
  code: string;
  name: string;
  maxActiveLoans: number;
  loanDurationDays: number;
  maxRenewals: number;
  finePerDay: string;
  gracePeriodDays: number;
}

export interface MemberDto {
  id: string;
  membershipNumber: string;
  status: MemberStatusDto;
  /** Instants, ISO-8601 with offset. */
  joinedAt: string;
  /** A calendar date, `YYYY-MM-DD`, or null. */
  expiresAt: string | null;
  /** A calendar date. Never an instant — see `formatCalendarDate`. */
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  occupation: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  memberType: MemberTypeSummary;
  homeBranch: BranchRef;
  /** Null for a desk-registered member with no login. */
  account: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    emailVerified: boolean;
  } | null;
}

export interface MemberTypeDto {
  id: string;
  code: string;
  name: string;
  maxActiveLoans: number;
  loanDurationDays: number;
  maxRenewals: number;
  renewalDurationDays: number;
  gracePeriodDays: number;
  /** Decimal strings. Never numbers — see `formatMoney`. */
  finePerDay: string;
  maxFineCap: string | null;
  reservationLimit: number;
  holdDurationDays: number;
  requiresApproval: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Query filters are declared as `type`, not `interface`, on purpose: TypeScript
 * gives a type alias an implicit index signature and an interface none, so an
 * interface is not assignable to the client's `Record<string, string | number |
 * boolean | null | undefined>` query type. An interface here fails to compile at
 * the call site, which is a confusing error for what is really a shape rule.
 */
export type MemberFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  status?: MemberStatusDto;
  memberTypeId?: string;
  /** Restrict to one branch. Omit for every branch in the caller's scope. */
  branchId?: string;
  q?: string;
};

export type MemberListResult = Paginated<MemberDto>;

/**
 * `| undefined` on every optional key.
 *
 * With `exactOptionalPropertyTypes`, `phone?: string | null` forbids passing
 * `phone: undefined` explicitly — and building a body by spreading conditional
 * fields produces exactly that. Allowing `undefined` keeps "omit the key" and
 * "send null" distinguishable, which the update schema depends on.
 */
export type MemberCreateInput = {
  firstName: string;
  lastName: string;
  email: string;
  memberTypeId: string;
  /**
   * The member's home branch. Omitted for a single-branch library — the server
   * defaults to the caller's branch (or the library's active branch) rather than
   * making the desk state the obvious.
   */
  homeBranchId?: string | undefined;
  phone?: string | null | undefined;
  membershipNumber?: string | undefined;
  dateOfBirth?: string | undefined;
  gender?: string | null | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  occupation?: string | null | undefined;
  notes?: string | null | undefined;
  expiresAt?: string | undefined;
  createAccount?: boolean | undefined;
  password?: string | undefined;
};

export type MemberUpdateInput = Partial<Omit<MemberCreateInput, 'createAccount'>> & {
  status?: MemberStatusDto | undefined;
};

/* ── Members ────────────────────────────────────────────────────────────────── */

export function listMembers(
  filters: MemberFilters,
  signal?: AbortSignal,
): Promise<MemberListResult> {
  return api.get<MemberDto[]>('/members', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<MemberListResult>;
}

export function getOwnMember(signal?: AbortSignal) {
  // 404 is the normal answer for STAFF: they have a credential but no member
  // record, and the route returns `{ member: null }` rather than failing.
  return api.get<{ member: MemberDto | null }>('/members/me', signal ? { signal } : {});
}

export function getMember(id: string, signal?: AbortSignal) {
  return api.get<{ member: MemberDto }>(`/members/${id}`, signal ? { signal } : {});
}

export function createMember(input: MemberCreateInput) {
  return api.post<{ member: MemberDto }>('/members', input);
}

/**
 * Partial update.
 *
 * Only keys the user actually changed are sent. The schema distinguishes an absent
 * key from `null`, and sending every field with `null` for the blank ones would
 * erase the address and city of a member whose form was only correcting a typo.
 */
export function updateMember(id: string, input: MemberUpdateInput) {
  return api.patch<{ member: MemberDto }>(`/members/${id}`, input);
}

/** Soft delete: the row stays for audit and history, and disappears from lists. */
export function archiveMember(id: string) {
  return api.delete<void>(`/members/${id}`);
}

/* ── Member types ───────────────────────────────────────────────────────────── */

export type MemberTypeFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  includeInactive?: boolean;
};

export function listMemberTypes(
  filters: MemberTypeFilters,
  signal?: AbortSignal,
): Promise<Paginated<MemberTypeDto>> {
  return api.get<MemberTypeDto[]>('/member-types', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<MemberTypeDto>>;
}

export function getMemberType(id: string, signal?: AbortSignal) {
  return api.get<{ memberType: MemberTypeDto }>(`/member-types/${id}`, signal ? { signal } : {});
}

export interface MemberTypeInput {
  code: string;
  name: string;
  maxActiveLoans?: number;
  loanDurationDays?: number;
  maxRenewals?: number;
  renewalDurationDays?: number;
  gracePeriodDays?: number;
  /** Decimal string, at most 2 places. */
  finePerDay: string;
  /** Null means uncapped, which is a policy choice rather than an omission. */
  maxFineCap?: string | null;
  reservationLimit?: number;
  holdDurationDays?: number;
  requiresApproval?: boolean;
  isActive?: boolean;
}

export function createMemberType(input: MemberTypeInput) {
  return api.post<{ memberType: MemberTypeDto }>('/member-types', input);
}

export function updateMemberType(id: string, input: Partial<MemberTypeInput>) {
  return api.patch<{ memberType: MemberTypeDto }>(`/member-types/${id}`, input);
}

/** POST, not DELETE: the record is retained because members and loans reference it. */
export function deactivateMemberType(id: string) {
  return api.post<void>(`/member-types/${id}/deactivate`, {});
}
