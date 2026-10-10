import { randomBytes } from 'node:crypto';
import type { Prisma, MemberStatus } from '@prisma/client';
import { prisma, withTransaction } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { SORTABLE_FIELDS } from '../../config/constants.js';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { publishRealtime } from '../../lib/events.js';
import { orderBy, skipTake, type PaginationQuery } from '../../lib/pagination.js';
import { toMoneyString } from '../../lib/money.js';
import { assertBranchScope, branchScopeFilter } from '../../middleware/scope.js';
import { ownOrStaffFilter } from '../../middleware/ownership.js';
import { requireLibraryScope } from '../../middleware/library-scope.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';
import { getSetting, SETTING_KEYS } from '../settings/settings.service.js';
import { hashPassword, validatePasswordStrength } from '../auth/password.service.js';
import type { AuthPrincipal } from '@lms/shared';

/** Announces a members change so every connected client refetches. */
function announce(action: string, entityId?: string): void {
  publishRealtime({
    channel: 'members',
    action,
    entityId,
    occurredAt: new Date().toISOString(),
  });
}

/**
 * Members and member types.
 *
 * A `Member` is the person in the library system; a `User` is the credential that
 * signs in. They are separate because most members never sign in, and a few users
 * (staff) have no member record at all. Self-service member reads filter on the
 * member's primary key; owned circulation records filter on `memberId`.
 *
 * Reads compose TWO filters and the order matters:
 *
 *   1. Branch scope (Gate 3) — which branches this principal may see at all.
 *   2. Ownership (Gate 4) — a member without `MEMBER_VIEW_OTHERS` sees only
 *      themselves.
 *
 * Applying ownership first and scope second would leak nothing, but it would let
 * a librarian discover that a record exists outside their branch by observing an
 * empty result. Scope first is the cheaper and quieter answer.
 *
 * DELETION IS SOFT. `deletedAt` is set and the row stays: circulation history,
 * fines and audit rows reference it, and `onDelete: Restrict` on those relations
 * means a hard delete would either fail or cascade away the history that makes a
 * member record auditable.
 */

/** Fields every member response includes. Never includes anything from `User`. */
const MEMBER_SELECT = {
  id: true,
  membershipNumber: true,
  status: true,
  joinedAt: true,
  expiresAt: true,
  dateOfBirth: true,
  gender: true,
  address: true,
  city: true,
  occupation: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  memberType: {
    select: {
      id: true,
      code: true,
      name: true,
      maxActiveLoans: true,
      loanDurationDays: true,
      maxRenewals: true,
      finePerDay: true,
      gracePeriodDays: true,
    },
  },
  homeBranch: { select: { id: true, code: true, name: true } },
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      emailVerifiedAt: true,
    },
  },
} satisfies Prisma.MemberSelect;

type MemberWithRelations = Prisma.MemberGetPayload<{ select: typeof MEMBER_SELECT }>;

/**
 * Shapes a member for the wire.
 *
 * `dateOfBirth` is a `@db.Date`: Prisma returns it as `Date` at UTC midnight, and
 * `toISOString()` would be correct only because of that. Formatting the calendar
 * parts explicitly is not decoration — if the column type ever changes, this
 * cannot silently start shifting a birthday by a day.
 */
export function toMemberDto(member: MemberWithRelations) {
  return {
    id: member.id,
    membershipNumber: member.membershipNumber,
    status: member.status,
    joinedAt: member.joinedAt.toISOString(),
    expiresAt: member.expiresAt?.toISOString() ?? null,
    dateOfBirth: formatCalendarDate(member.dateOfBirth),
    gender: member.gender,
    address: member.address,
    city: member.city,
    occupation: member.occupation,
    notes: member.notes,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    memberType: member.memberType,
    homeBranch: member.homeBranch,
    // Name and email live on `User`. A member registered at the desk without an
    // account still has a name, so the fields are nullable rather than required.
    account: member.user
      ? {
          userId: member.user.id,
          email: member.user.email,
          firstName: member.user.firstName,
          lastName: member.user.lastName,
          emailVerified: member.user.emailVerifiedAt !== null,
        }
      : null,
  };
}

/** `YYYY-MM-DD` from a `Date`, read in UTC to match how the value was stored. */
export function formatCalendarDate(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/* ── Reads ──────────────────────────────────────────────────────────────────── */

export interface MemberListFilters {
  status?: MemberStatus;
  memberTypeId?: string;
  branchId?: string;
  q?: string;
  includeDeleted?: boolean;
  pagination: PaginationQuery;
  sort?: string;
  direction?: 'asc' | 'desc';
}

/**
 * Lists members visible to `principal`.
 *
 * `includeDeleted` is gated on `MEMBER_VIEW_OTHERS` rather than trusted from the
 * query string, because soft-deleted rows hold the identifiers an operator needs
 * to resolve a dispute, and a member must not be able to enumerate them.
 */
export async function listMembers(
  principal: AuthPrincipal,
  filters: MemberListFilters,
): Promise<{ members: MemberWithRelations[]; total: number }> {
  const { pagination } = filters;

  const where: Prisma.MemberWhereInput = {
    ...branchScopeFilter(principal, 'homeBranchId'),
    ...ownOrStaffFilter(principal, 'MEMBER_VIEW_OTHERS', 'id'),
  };

  if (filters.status) where.status = filters.status;
  if (filters.memberTypeId) where.memberTypeId = filters.memberTypeId;
  if (filters.branchId) where.homeBranchId = filters.branchId;
  if (filters.q) {
    // Case-insensitive substring across both identifiers. `contains` with
    // `mode: 'insensitive'` cannot use a plain btree index, so this stays a scan
    // — acceptable at member-table scale, and the alternative (a search engine)
    // is not justified until it is not.
    where.OR = [
      { membershipNumber: { contains: filters.q, mode: 'insensitive' } },
      { user: { is: { lastName: { contains: filters.q, mode: 'insensitive' } } } },
      { user: { is: { firstName: { contains: filters.q, mode: 'insensitive' } } } },
    ];
  }

  if (!filters.includeDeleted || !principal.permissions.has('MEMBER_VIEW_OTHERS')) {
    where.deletedAt = null;
  }

  const [members, total] = await Promise.all([
    prisma.member.findMany({
      where,
      select: MEMBER_SELECT,
      orderBy: orderBy(
        (['membershipNumber', 'createdAt'] as const).filter((f) =>
          filters.sort ? (SORTABLE_FIELDS.member as readonly string[]).includes(f) : true,
        ),
        filters.direction ?? 'desc',
        SORTABLE_FIELDS.member,
      ),
      ...skipTake(pagination),
    }),
    prisma.member.count({ where }),
  ]);

  return { members, total };
}

export async function getMember(
  principal: AuthPrincipal,
  id: string,
): Promise<MemberWithRelations> {
  const member = await prisma.member.findFirst({
    where: {
      id,
      deletedAt: null,
      ...branchScopeFilter(principal, 'homeBranchId'),
      ...ownOrStaffFilter(principal, 'MEMBER_VIEW_OTHERS', 'id'),
    },
    select: MEMBER_SELECT,
  });

  // 404 rather than 403: a 403 confirms the record exists, which turns an id
  // into an oracle for enumerating the membership.
  if (!member) throw notFound('Member');

  return member;
}

/* ── Create ─────────────────────────────────────────────────────────────────── */

export interface MemberCreateInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  memberTypeId: string;
  homeBranchId?: string;
  membershipNumber?: string;
  dateOfBirth?: string;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  occupation?: string | null;
  notes?: string | null;
  expiresAt?: string;
  createAccount?: boolean;
  password?: string;
}

/**
 * Resolves the home branch for a registration when the desk does not pick one.
 *
 * A single-branch library (the only deployment this build supports) has nothing
 * to choose, so a form that demands a branch is asking a question whose answer
 * is already enforced. A scoped desk gets its own branch; an administrator with
 * every branch in scope falls back to the library's active branch. An explicit
 * pick is still honoured — and still held to Gate 3 — so the moment a second
 * branch exists the API is already ready for a picker.
 */
async function resolveDefaultHomeBranchId(
  principal: AuthPrincipal,
  libraryId: string,
  requested: string | undefined,
): Promise<string> {
  if (requested) {
    assertBranchScope(principal, requested);
    return requested;
  }

  if (principal.branchScope !== null) {
    const [first] = principal.branchScope;
    if (!first) throw forbidden('You are not assigned to a branch');
    return first;
  }

  const branch = await prisma.branch.findFirst({
    where: { libraryId, isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true },
  });
  if (!branch) throw unprocessable('No active branch in this library to assign the member to');
  return branch.id;
}

/**
 * Registers a member at the desk.
 *
 * Unlike self-registration this is a privileged, staff-driven action. The member
 * type comes from the request; the home branch defaults to the caller's branch
 * when omitted. Both are still validated to exist and to be active, because a
 * member attached to a deactivated type inherits that type's borrowing limits
 * and could borrow outside policy.
 */
export async function createMember(
  principal: AuthPrincipal,
  input: MemberCreateInput,
  context: AuditContext = {},
): Promise<MemberWithRelations> {
  // Fail closed BEFORE any lookup: without a library scope there is no tenant to
  // attribute the member (or its login account) to, and a null `libraryId` would
  // make the new account invisible to every library-scoped check forever.
  const libraryId = requireLibraryScope(principal);
  const email = input.email.trim().toLowerCase();

  // The desk need not pick a branch when there is only one to pick. The default
  // is resolved server-side so a single-branch library never asks for the
  // obvious — and an explicit pick is still held to the same validation below.
  const homeBranchId = await resolveDefaultHomeBranchId(principal, libraryId, input.homeBranchId);

  const [memberType, branch, emailOwner] = await Promise.all([
    prisma.memberType.findUnique({
      where: { id: input.memberTypeId },
      select: { id: true, code: true, isActive: true },
    }),
    prisma.branch.findUnique({
      where: { id: homeBranchId },
      select: { id: true, isActive: true, libraryId: true },
    }),
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
  ]);

  if (!memberType) throw unprocessable('The selected member type does not exist');
  if (!memberType.isActive) throw unprocessable('The selected member type is not active');
  if (!branch) throw unprocessable('The selected branch does not exist');
  if (!branch.isActive) throw unprocessable('The selected branch is not active');
  // The home branch must sit in the caller's own library. `branchId` alone cannot
  // reveal which tenant it belongs to, so this is resolved server-side rather
  // than trusted from the desk.
  if (branch.libraryId !== libraryId) {
    throw forbidden('The selected branch belongs to another library');
  }
  if (emailOwner)
    throw conflict('MEMBER_ALREADY_REGISTERED', 'A member already uses this email address');

  // The membership number is the barcode payload, so it must be unique. When the
  // desk does not supply one it is derived from the member type, and the unique
  // index — not this read — is what settles a concurrent collision.
  const membershipNumber =
    input.membershipNumber?.trim() || (await nextMembershipNumber(memberType.code));

  /**
   * Every member gets a `User` row, even when the member will never sign in.
   *
   * `Member.userId` is NOT NULL and `@unique`, so "no account" is not
   * representable in the schema — two members sharing one placeholder user would
   * violate the index on the second insert. Creating the row and leaving it
   * unusable is the honest encoding: `mustChangePassword` is set, so the member
   * sets a password the first time they sign in, and until then the account
   * cannot be used by anyone who guesses.
   *
   * A random 32-byte credential is generated rather than an empty password. An
   * account whose password is a known constant is one dictionary attack away from
   * being a real login.
   */
  const password = input.createAccount ? (input.password ?? '') : randomPassword();

  // Policy is checked here rather than in the schema, matching `auth.schemas.ts`:
  // the rules live in one place, so a desk-set password cannot drift from a
  // self-chosen one. The generated credential is exempt by construction —
  // 32 bytes of base64url fails every rule by design.
  if (input.createAccount) validatePasswordStrength(password);

  const passwordHash = await hashPassword(password);

  const joinedAt = new Date();
  const expiresAt = input.expiresAt
    ? parseCalendarDate(input.expiresAt)
    : await defaultExpiry(joinedAt);

  let created: MemberWithRelations;

  try {
    created = await withTransaction(async (db) => {
      const user = await db.user.create({
        data: {
          email,
          passwordHash,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          phone: input.phone?.trim() || null,
          roleId: await memberRoleId(db),
          libraryId,
          primaryBranchId: homeBranchId,
          status: 'ACTIVE',
          passwordChangedAt: joinedAt,
          // Forces a real password before the account is usable. Set for desk
          // registrations, where the operator chose no password and the member
          // picks their own at first sign-in.
          mustChangePassword: !input.createAccount,
          // An account nobody asked for is unverified until the member proves
          // they own the address. Otherwise staff would be handing out
          // "password-reset" addresses that have never been proven either.
          emailVerifiedAt: null,
        },
        select: { id: true },
      });

      const member = await db.member.create({
        data: {
          membershipNumber,
          userId: user.id,
          memberTypeId: memberType.id,
          homeBranchId,
          status: 'ACTIVE',
          joinedAt,
          expiresAt,
          dateOfBirth: input.dateOfBirth ? parseCalendarDate(input.dateOfBirth) : null,
          gender: input.gender?.trim() || null,
          address: input.address?.trim() || null,
          city: input.city?.trim() || null,
          occupation: input.occupation?.trim() || null,
          notes: input.notes?.trim() || null,
        },
        select: MEMBER_SELECT,
      });

      return member;
    });
  } catch (error) {
    if (isMembershipNumberConflict(error)) {
      throw conflict('MEMBER_ALREADY_REGISTERED', 'That membership number is already in use');
    }
    throw error;
  }

  await recordAudit({
    action: 'MEMBER_CREATED',
    entityType: 'Member',
    entityId: created.id,
    description: 'Registered a member at the desk',
    after: {
      membershipNumber: created.membershipNumber,
      memberType: created.memberType.code,
      homeBranch: created.homeBranch.code,
    },
    actor: { userId: principal.userId, email: principal.email },
    context,
  });

  announce('Member.created', created.id);
  return created;
}

/* ── Update ─────────────────────────────────────────────────────────────────── */

export interface MemberUpdateInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  memberTypeId?: string;
  homeBranchId?: string;
  dateOfBirth?: string;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  occupation?: string | null;
  notes?: string | null;
  expiresAt?: string;
  status?: MemberStatus;
}

/**
 * Updates a member.
 *
 * Two invariants are checked rather than trusted:
 *
 *   • `memberTypeId` and `homeBranchId` must still resolve to active rows, for the
 *     same reason they are checked on create.
 *   • Moving a member to another branch requires `MEMBER_BRANCH_ASSIGN`. Reassigning
 *     someone out from under a branch is how a loan ends up charged to a branch the
 *     member no longer has anything to do with.
 */
export async function updateMember(
  principal: AuthPrincipal,
  id: string,
  input: MemberUpdateInput,
  context: AuditContext = {},
): Promise<MemberWithRelations> {
  const before = await getMember(principal, id);

  if (input.memberTypeId) {
    const type = await prisma.memberType.findUnique({
      where: { id: input.memberTypeId },
      select: { isActive: true },
    });
    if (!type) throw unprocessable('The selected member type does not exist');
    if (!type.isActive) throw unprocessable('The selected member type is not active');
  }

  if (input.homeBranchId) {
    if (!principal.permissions.has('MEMBER_BRANCH_ASSIGN')) {
      throw unprocessable('You do not have permission to move a member to another branch');
    }
    const branch = await prisma.branch.findUnique({
      where: { id: input.homeBranchId },
      select: { isActive: true },
    });
    if (!branch) throw unprocessable('The selected branch does not exist');
    if (!branch.isActive) throw unprocessable('The selected branch is not active');
  }

  if (input.email) {
    const email = input.email.trim().toLowerCase();
    const owner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (owner)
      throw conflict('MEMBER_ALREADY_REGISTERED', 'A member already uses this email address');
  }

  const data: Prisma.MemberUpdateInput = {};
  if (input.status !== undefined) data.status = input.status;
  if (input.expiresAt !== undefined) data.expiresAt = parseCalendarDate(input.expiresAt);
  if (input.dateOfBirth !== undefined) {
    data.dateOfBirth = input.dateOfBirth ? parseCalendarDate(input.dateOfBirth) : null;
  }
  // `phone` lives on `User` and is handled in the transactional block below, so
  // it is deliberately absent from this list.
  for (const field of ['address', 'city', 'occupation', 'notes', 'gender'] as const) {
    if (input[field] !== undefined) data[field] = input[field];
  }
  if (input.memberTypeId) data.memberType = { connect: { id: input.memberTypeId } };
  if (input.homeBranchId) data.homeBranch = { connect: { id: input.homeBranchId } };

  // Name, email and phone live on `User`, so this update spans two tables and must
  // be transactional — otherwise a changed email with a failed name update leaves
  // the two out of sync.
  const updated = await withTransaction(async (db) => {
    if (before.user) {
      const userData: Prisma.UserUpdateInput = {};
      if (input.firstName !== undefined) userData.firstName = input.firstName.trim();
      if (input.lastName !== undefined) userData.lastName = input.lastName.trim();
      if (input.email) userData.email = input.email.trim().toLowerCase();
      if (input.phone !== undefined) userData.phone = input.phone;

      if (Object.keys(userData).length > 0) {
        await db.user.update({ where: { id: before.user.id }, data: userData });
      }
    }

    return db.member.update({ where: { id }, data, select: MEMBER_SELECT });
  });

  await recordAudit({
    action: 'MEMBER_UPDATED',
    entityType: 'Member',
    entityId: id,
    description: 'Updated member record',
    before: { status: before.status, memberTypeId: before.memberType.id },
    after: { status: updated.status, memberTypeId: updated.memberType.id },
    actor: { userId: principal.userId, email: principal.email },
    context,
  });

  announce('Member.updated', updated.id);
  return updated;
}

/**
 * Soft-deletes a member.
 *
 * Refused while the member has an active loan, because deleting the person who
 * has a book out does not return the book. The check is a count against
 * `LoanStatus`, not a `findFirst` of a filtered list, so it cannot be defeated by
 * pagination.
 */
export async function archiveMember(
  principal: AuthPrincipal,
  id: string,
  context: AuditContext = {},
): Promise<void> {
  // Reads the member through the scoped/ownership-filtered lookup, so a principal
  // who cannot see the record gets 404 before any existence leak.
  await getMember(principal, id);

  const activeLoans = await prisma.loan.count({
    where: { memberId: id, status: 'ACTIVE' },
  });
  if (activeLoans > 0) {
    throw conflict(
      'MEMBER_HAS_ACTIVE_LOANS',
      'This member has items on loan and must return them before archiving',
    );
  }

  const activeReservations = await prisma.reservation.count({
    where: { memberId: id, status: { in: ['ACTIVE', 'READY'] } },
  });
  if (activeReservations > 0) {
    throw conflict(
      'MEMBER_HAS_ACTIVE_RESERVATIONS',
      'This member has active reservations that must be cancelled before archiving',
    );
  }

  const outstandingFines = await prisma.fine.count({
    where: { memberId: id, status: { in: ['OUTSTANDING', 'PARTIAL'] } },
  });
  if (outstandingFines > 0) {
    throw conflict(
      'MEMBER_HAS_OUTSTANDING_FINES',
      'This member has outstanding fines that must be settled before archiving',
    );
  }

  await prisma.member.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'INACTIVE' },
  });

  await recordAudit({
    action: 'MEMBER_DELETED',
    entityType: 'Member',
    entityId: id,
    description: 'Archived member record',
    actor: { userId: principal.userId, email: principal.email },
    context,
  });

  logger.info({ event: 'member.archived', memberId: id, by: principal.userId }, 'Member archived');
  announce('Member.archived', id);
}

/* ── Member types ───────────────────────────────────────────────────────────── */

const MEMBER_TYPE_SELECT = {
  id: true,
  code: true,
  name: true,
  maxActiveLoans: true,
  loanDurationDays: true,
  maxRenewals: true,
  renewalDurationDays: true,
  gracePeriodDays: true,
  finePerDay: true,
  maxFineCap: true,
  reservationLimit: true,
  holdDurationDays: true,
  requiresApproval: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MemberTypeSelect;

type MemberTypeRow = Prisma.MemberTypeGetPayload<{ select: typeof MEMBER_TYPE_SELECT }>;

/** Money as strings: `Decimal` is not a `number` and must never cross the wire. */
export function toMemberTypeDto(type: MemberTypeRow) {
  return {
    ...type,
    finePerDay: toMoneyString(type.finePerDay),
    maxFineCap: type.maxFineCap === null ? null : toMoneyString(type.maxFineCap),
    createdAt: type.createdAt.toISOString(),
    updatedAt: type.updatedAt.toISOString(),
  };
}

/**
 * Every active member type, for a dropdown.
 *
 * Branch scope does not apply: a member type is library-wide policy, not a
 * per-branch record, so filtering it by branch would leave a member at one branch
 * unable to see which types exist at another during a transfer.
 */
export async function listMemberTypes(filters: {
  includeInactive?: boolean;
  pagination: PaginationQuery;
  sort?: string;
  direction?: 'asc' | 'desc';
}): Promise<{ memberTypes: MemberTypeRow[]; total: number }> {
  const where: Prisma.MemberTypeWhereInput = filters.includeInactive ? {} : { isActive: true };

  const [memberTypes, total] = await Promise.all([
    prisma.memberType.findMany({
      where,
      select: MEMBER_TYPE_SELECT,
      orderBy: orderBy(
        (['name', 'createdAt'] as const).filter((f) =>
          filters.sort ? (SORTABLE_FIELDS.memberType as readonly string[]).includes(f) : true,
        ),
        filters.direction ?? 'asc',
        SORTABLE_FIELDS.memberType,
      ),
      ...skipTake(filters.pagination),
    }),
    prisma.memberType.count({ where }),
  ]);

  return { memberTypes, total };
}

export async function getMemberType(id: string): Promise<MemberTypeRow> {
  const type = await prisma.memberType.findUnique({ where: { id }, select: MEMBER_TYPE_SELECT });
  if (!type) throw notFound('Member type');
  return type;
}

export interface MemberTypeCreateInput {
  code: string;
  name: string;
  maxActiveLoans?: number;
  loanDurationDays?: number;
  maxRenewals?: number;
  renewalDurationDays?: number;
  gracePeriodDays?: number;
  finePerDay: string;
  maxFineCap?: string | null;
  reservationLimit?: number;
  holdDurationDays?: number;
  requiresApproval?: boolean;
  isActive?: boolean;
}

export async function createMemberType(
  principal: AuthPrincipal,
  input: MemberTypeCreateInput,
  context: AuditContext = {},
): Promise<MemberTypeRow> {
  const created = await prisma.memberType.create({
    data: {
      code: input.code,
      name: input.name.trim(),
      maxActiveLoans: input.maxActiveLoans,
      loanDurationDays: input.loanDurationDays,
      maxRenewals: input.maxRenewals,
      renewalDurationDays: input.renewalDurationDays,
      gracePeriodDays: input.gracePeriodDays,
      finePerDay: input.finePerDay,
      maxFineCap: input.maxFineCap,
      reservationLimit: input.reservationLimit,
      holdDurationDays: input.holdDurationDays,
      requiresApproval: input.requiresApproval,
      isActive: input.isActive,
    },
    select: MEMBER_TYPE_SELECT,
  });

  await recordAudit({
    action: 'MEMBER_TYPE_CREATED',
    entityType: 'MemberType',
    entityId: created.id,
    description: `Created member type ${created.code}`,
    after: { code: created.code, name: created.name },
    actor: { userId: principal.userId, email: principal.email },
    context,
  });

  announce('MemberType.created', created.id);
  return created;
}

export interface MemberTypeUpdateInput {
  name?: string;
  maxActiveLoans?: number;
  loanDurationDays?: number;
  maxRenewals?: number;
  renewalDurationDays?: number;
  gracePeriodDays?: number;
  finePerDay?: string;
  maxFineCap?: string | null;
  reservationLimit?: number;
  holdDurationDays?: number;
  requiresApproval?: boolean;
  isActive?: boolean;
}

/**
 * Updates borrowing policy.
 *
 * Takes effect for existing loans on their NEXT renewal, not retroactively: a
 * `Loan` copies its due date when it is issued, so changing a member type does
 * not move a due date that has already been communicated to the member. That is
 * the intended behaviour and the reason `LoanRenewal` exists.
 */
export async function updateMemberType(
  principal: AuthPrincipal,
  id: string,
  input: MemberTypeUpdateInput,
  context: AuditContext = {},
): Promise<MemberTypeRow> {
  const before = await getMemberType(id);

  const updated = await prisma.memberType.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      maxActiveLoans: input.maxActiveLoans,
      loanDurationDays: input.loanDurationDays,
      maxRenewals: input.maxRenewals,
      renewalDurationDays: input.renewalDurationDays,
      gracePeriodDays: input.gracePeriodDays,
      finePerDay: input.finePerDay,
      maxFineCap: input.maxFineCap,
      reservationLimit: input.reservationLimit,
      holdDurationDays: input.holdDurationDays,
      requiresApproval: input.requiresApproval,
      isActive: input.isActive,
    },
    select: MEMBER_TYPE_SELECT,
  });

  await recordAudit({
    action: 'MEMBER_TYPE_UPDATED',
    entityType: 'MemberType',
    entityId: id,
    description: `Updated borrowing policy for ${before.code}`,
    before: { maxActiveLoans: before.maxActiveLoans, loanDurationDays: before.loanDurationDays },
    after: { maxActiveLoans: updated.maxActiveLoans, loanDurationDays: updated.loanDurationDays },
    actor: { userId: principal.userId, email: principal.email },
    context,
  });

  announce('MemberType.updated', updated.id);
  return updated;
}

/**
 * Deactivates a member type.
 *
 * Never hard-deleted: loans and members reference it, and `onDelete: Restrict`
 * means the delete would fail anyway. Deactivation stops it appearing in new
 * registrations while leaving history readable.
 */
export async function deactivateMemberType(
  principal: AuthPrincipal,
  id: string,
  context: AuditContext = {},
): Promise<void> {
  const type = await getMemberType(id);

  const inUse = await prisma.member.count({ where: { memberTypeId: id, deletedAt: null } });
  if (inUse > 0) {
    // Deactivation is still allowed — the members keep their terms — but it is
    // logged at warn so a type silently dropped out of use is noticed.
    logger.warn(
      { event: 'member_type.deactivated_in_use', code: type.code, members: inUse },
      'Member type deactivated while members still use it',
    );
  }

  await prisma.memberType.update({ where: { id }, data: { isActive: false } });

  await recordAudit({
    action: 'MEMBER_TYPE_UPDATED',
    entityType: 'MemberType',
    entityId: id,
    description: `Deactivated member type ${type.code}`,
    actor: { userId: principal.userId, email: principal.email },
    context,
  });
  announce('MemberType.deactivated', id);
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Parses `YYYY-MM-DD` to a UTC-midnight `Date`, matching the `@db.Date` column. */
function parseCalendarDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw unprocessable(`Not a valid date: ${value}`);
  }
  return parsed;
}

/** Falls back to the org policy, so an unconfigured library still sets an expiry. */
async function defaultExpiry(from: Date): Promise<Date | null> {
  const days = await getSetting(SETTING_KEYS.MEMBERSHIP_VALIDITY_DAYS, 365);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(from.getTime() + days * 86_400_000);
}

/**
 * The `MEMBER` role id, for a desk-created account.
 *
 * Read inside the transaction rather than cached: an unseeded database must fail
 * the whole create, not commit a member whose account cannot be authorised.
 */
async function memberRoleId(db: Prisma.TransactionClient): Promise<string> {
  const role = await db.role.findUnique({ where: { code: 'MEMBER' }, select: { id: true } });
  if (!role) throw unprocessable('Registration is not available right now');
  return role.id;
}

/**
 * A random, unguessable password for a desk registration.
 *
 * 32 bytes of CSPRNG output, not a short random string: the length makes an
 * exhaustive search pointless even if the hash leaked, which is the property that
 * matters for a credential nobody is meant to use.
 */
function randomPassword(): string {
  return randomBytes(32).toString('base64url');
}

/** Derives the next membership number for a type, e.g. `PUB-0007`. */
async function nextMembershipNumber(memberTypeCode: string): Promise<string> {
  const prefix = memberTypeCode.slice(0, 3).toUpperCase().padEnd(3, 'X');
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);

  const latest = await prisma.member.findFirst({
    where: { membershipNumber: { startsWith: `${prefix}-` } },
    orderBy: { membershipNumber: 'desc' },
    select: { membershipNumber: true },
  });

  const match = latest ? pattern.exec(latest.membershipNumber) : null;
  return `${prefix}-${String((match ? Number(match[1]) : 0) + 1).padStart(4, '0')}`;
}

/**
 * Whether a failure was the membership number colliding.
 *
 * The column is unique, so a concurrent desk registration takes this path; the
 * operator retries and gets a fresh number. Only string targets are inspected, so
 * an unrecognised shape falls through to the generic error rather than being
 * misreported as a number conflict.
 */
function isMembershipNumberConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;

  const { target } = candidate.meta ?? {};
  const fields: unknown[] = Array.isArray(target) ? target : [target];

  return fields.some((field) => typeof field === 'string' && field.includes('membership_number'));
}
