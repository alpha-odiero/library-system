import { randomBytes } from 'node:crypto';
import type { Prisma, UserStatus } from '@prisma/client';
import type { AuthPrincipal } from '@lms/shared';
import { prisma, withTransaction } from '../../config/database.js';
import { SORTABLE_FIELDS } from '../../config/constants.js';
import { AppError, badRequest, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { orderBy, skipTake, type PaginationQuery } from '../../lib/pagination.js';
import { libraryScopeFilter, requireLibraryScope } from '../../middleware/library-scope.js';
import { hashPassword, validatePasswordStrength } from '../auth/password.service.js';
import { actorFromPrincipal, recordAudit, type AuditContext } from '../audit/audit.service.js';

/**
 * Staff-account administration.
 *
 * The whole module exists to answer one question: how does a LIBRARIAN account
 * come into being? Public registration creates ADMIN owners (see
 * `auth.service.ts`) and desk registration creates MEMBERs (see
 * `members.service.ts`); this is the third path, where an existing administrator
 * provisions operational staff.
 *
 * Three invariants hold everywhere below:
 *
 *   1. THE ROLE IS NEVER A REQUEST FIELD. `PROVISIONED_ROLE` is a constant and
 *      the `roleId` is resolved from it server-side. No schema in this module
 *      mentions a role, so no body — validated or not — can ask for ADMIN.
 *   2. EVERY WRITE IS LIBRARY-SCOPED. The tenant comes from the principal
 *      (`requireLibraryScope`), and a branch is verified to belong to that tenant
 *      server-side, because a branch id cannot reveal its own library.
 *   3. TEMPORARY CREDENTIALS LIVE ONCE. The plaintext exists in the creation
 *      response and nowhere else: the hash is Argon2, the audit row records THAT
 *      a credential was issued, never what it was.
 */

/** The one role this module may grant. */
const PROVISIONED_ROLE = 'LIBRARIAN';

/** Projection for every read. Never includes `passwordHash` — it cannot leak. */
const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  status: true,
  employeeId: true,
  profileImageUrl: true,
  emailVerifiedAt: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { code: true, name: true } },
  primaryBranch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect;

export type UserWithRelations = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/** Shapes a staff account for the wire. */
export function toUserDto(user: UserWithRelations) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    phone: user.phone,
    status: user.status,
    roleCode: user.role.code,
    roleName: user.role.name,
    employeeId: user.employeeId,
    profileImageUrl: user.profileImageUrl,
    emailVerified: user.emailVerifiedAt !== null,
    mustChangePassword: user.mustChangePassword,
    primaryBranch: user.primaryBranch,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/* ── Reads ──────────────────────────────────────────────────────────────────── */

export interface UserListFilters {
  roleCode?: string;
  status?: UserStatus;
  q?: string;
  pagination: PaginationQuery;
  sort?: string;
  direction?: 'asc' | 'desc';
}

/**
 * Lists accounts in the principal's library.
 *
 * `libraryScopeFilter` fails closed: a principal with no library scope matches
 * the impossible id rather than everything, so the directory answers empty
 * instead of serving another tenant's staff.
 */
export async function listUsers(
  principal: AuthPrincipal,
  filters: UserListFilters,
): Promise<{ users: UserWithRelations[]; total: number }> {
  const { pagination } = filters;

  const where: Prisma.UserWhereInput = {
    ...libraryScopeFilter(principal, 'libraryId'),
    deletedAt: null,
  };

  if (filters.roleCode) where.role = { is: { code: filters.roleCode } };
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    where.OR = [
      { email: { contains: filters.q, mode: 'insensitive' } },
      { firstName: { contains: filters.q, mode: 'insensitive' } },
      { lastName: { contains: filters.q, mode: 'insensitive' } },
      { employeeId: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  if (filters.sort && !(SORTABLE_FIELDS.user as readonly string[]).includes(filters.sort)) {
    throw badRequest('Invalid sort field');
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: orderBy(
        [filters.sort ?? 'lastName', 'createdAt'],
        filters.direction ?? 'asc',
        SORTABLE_FIELDS.user,
      ),
      ...skipTake(pagination),
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total };
}

/** One account, or 404 — a 403 would confirm that the id exists elsewhere. */
export async function getUser(principal: AuthPrincipal, id: string): Promise<UserWithRelations> {
  const user = await prisma.user.findFirst({
    where: {
      id,
      deletedAt: null,
      ...libraryScopeFilter(principal, 'libraryId'),
    },
    select: USER_SELECT,
  });

  if (!user) throw notFound('User');
  return user;
}

/* ── Create ─────────────────────────────────────────────────────────────────── */

export interface UserCreateInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  employeeId?: string | null;
  branchId?: string;
  profileImageUrl?: string | null;
  temporaryPassword?: string;
}

export interface CreatedUser {
  user: UserWithRelations;
  /**
   * The generated credential, shown to the administrator exactly once.
   * `null` when the administrator chose the password — repeating it back would
   * put a second copy of a known secret into a response log.
   */
  generatedPassword: string | null;
}

/**
 * Provisions a LIBRARIAN account.
 *
 * `mustChangePassword` is always set: the credential is chosen by (or handed to)
 * somebody other than its owner, so the first sign-in must end with the owner
 * replacing it. `emailVerifiedAt` is stamped because an administrator creating
 * an account for a colleague has confirmed the address with them directly;
 * leaving it null would gate the sign-in behind an email proof the system cannot
 * yet send.
 */
export async function createUser(
  principal: AuthPrincipal,
  input: UserCreateInput,
  context: AuditContext = {},
): Promise<CreatedUser> {
  const libraryId = requireLibraryScope(principal);
  const email = input.email.trim().toLowerCase();

  const role = await prisma.role.findUnique({
    where: { code: PROVISIONED_ROLE },
    select: { id: true },
  });
  if (!role) throw unprocessable('Staff provisioning is not available right now');

  const [emailOwner, branch] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    input.branchId
      ? prisma.branch.findUnique({
          where: { id: input.branchId },
          select: { id: true, isActive: true, libraryId: true },
        })
      : Promise.resolve(null),
  ]);

  if (emailOwner) {
    throw new AppError('CONFLICT', 'An account already exists for this email address');
  }
  if (input.branchId) {
    if (!branch) throw unprocessable('The selected branch does not exist');
    if (!branch.isActive) throw unprocessable('The selected branch is not active');
    if (branch.libraryId !== libraryId) {
      throw forbidden('The selected branch belongs to another library');
    }
  }

  // The generated credential is exempt by construction — base64url of 18 bytes
  // fails every length/character rule by design — so only a chosen one is checked.
  const password = input.temporaryPassword ?? generatePassword();
  const generatedPassword = input.temporaryPassword ? null : password;
  if (input.temporaryPassword) validatePasswordStrength(password);

  const passwordHash = await hashPassword(password);
  const now = new Date();

  let created: UserWithRelations;
  try {
    created = await withTransaction(async (db) =>
      db.user.create({
        data: {
          email,
          passwordHash,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          phone: input.phone?.trim() || null,
          employeeId: input.employeeId?.trim() || null,
          profileImageUrl: input.profileImageUrl?.trim() || null,
          roleId: role.id,
          libraryId,
          primaryBranchId: input.branchId ?? null,
          status: 'ACTIVE',
          passwordChangedAt: now,
          emailVerifiedAt: now,
          // The owner did not choose this credential; they must replace it.
          mustChangePassword: true,
        },
        select: USER_SELECT,
      }),
    );
  } catch (error) {
    if (isEmployeeIdConflict(error)) {
      throw unprocessable('That staff number is already in use in this library');
    }
    throw error;
  }

  const actor = actorFromPrincipal(principal);
  await recordAudit({
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: created.id,
    description: `Created a ${PROVISIONED_ROLE.toLowerCase()} account`,
    after: {
      email: created.email,
      firstName: created.firstName,
      lastName: created.lastName,
      roleCode: PROVISIONED_ROLE,
      libraryId,
      branchId: input.branchId ?? null,
    },
    actor,
    context,
  });

  if (input.temporaryPassword) {
    // Records THAT the administrator chose the credential — never the value.
    await recordAudit({
      action: 'USER_CREDENTIALS_ISSUED',
      entityType: 'User',
      entityId: created.id,
      description: 'Temporary password set by an administrator',
      actor,
      context,
    });
  }

  return { user: created, generatedPassword };
}

/* ── Update ─────────────────────────────────────────────────────────────────── */

export interface UserUpdateInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  employeeId?: string | null;
  profileImageUrl?: string | null;
  branchId?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

/**
 * Updates a staff account.
 *
 * The role is not updatable here at all — promoting an account to ADMIN is a
 * different, deliberately harder operation than editing a phone number, and
 * burying it in a PATCH with no separate audit action is how privilege creep
 * starts. Status changes to ACTIVE also clear any lockout, because "reactivate
 * this suspended account" must leave it usable rather than half-locked.
 */
export async function updateUser(
  principal: AuthPrincipal,
  id: string,
  input: UserUpdateInput,
  context: AuditContext = {},
): Promise<UserWithRelations> {
  requireLibraryScope(principal);

  const existing = await getUser(principal, id);

  if (input.status !== undefined && input.status !== 'ACTIVE' && id === principal.userId) {
    throw unprocessable('You cannot suspend or deactivate your own account');
  }

  if (input.branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: input.branchId },
      select: { id: true, isActive: true, libraryId: true },
    });
    if (!branch) throw unprocessable('The selected branch does not exist');
    if (!branch.isActive) throw unprocessable('The selected branch is not active');
    if (branch.libraryId !== principal.libraryScope) {
      throw forbidden('The selected branch belongs to another library');
    }
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.firstName !== undefined) data.firstName = input.firstName.trim();
  if (input.lastName !== undefined) data.lastName = input.lastName.trim();
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.employeeId !== undefined) data.employeeId = input.employeeId;
  if (input.profileImageUrl !== undefined) data.profileImageUrl = input.profileImageUrl;
  if (input.branchId !== undefined) data.primaryBranch = { connect: { id: input.branchId } };
  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === 'ACTIVE') {
      // Reactivation is only honest if the account is immediately usable.
      data.lockedUntil = null;
      data.failedLoginCount = 0;
    }
  }

  let updated: UserWithRelations;
  try {
    updated = await prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
  } catch (error) {
    if (isEmployeeIdConflict(error)) {
      throw unprocessable('That staff number is already in use in this library');
    }
    throw error;
  }

  const statusChanged = input.status !== undefined && input.status !== existing.status;
  await recordAudit({
    action: statusChanged && input.status !== 'ACTIVE' ? 'USER_DEACTIVATED' : 'USER_UPDATED',
    entityType: 'User',
    entityId: id,
    description: statusChanged
      ? `Account status changed from ${existing.status} to ${input.status}`
      : 'Staff account updated',
    before: { status: existing.status, email: existing.email },
    after: { status: updated.status, email: updated.email },
    fields: ['status', 'email'],
    actor: actorFromPrincipal(principal),
    context,
  });

  return updated;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/**
 * Credential for an admin-provisioned account.
 *
 * 18 bytes of base64url (~143 bits) — comfortably past the password policy, and
 * unlike a memorable-word scheme it carries no dictionary to attack. Not a
 * secret the system must keep: it is handed over out of band and replaced at
 * first sign-in.
 */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * Whether a failure was the (library, staff number) unique index colliding.
 *
 * The index exists in SQL only — Prisma cannot express "unique where not null" —
 * so a duplicate surfaces as P2002 naming `employee_id`. Only string targets are
 * inspected, so an unrecognised shape falls through to the generic error handler
 * rather than being misreported as a staff-number conflict.
 */
function isEmployeeIdConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;

  const { target } = candidate.meta ?? {};
  const fields: unknown[] = Array.isArray(target) ? target : [target];

  return fields.some((field) => typeof field === 'string' && field.includes('employee_id'));
}
