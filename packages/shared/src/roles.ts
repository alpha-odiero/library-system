import { ALL_PERMISSION_CODES, type PermissionCode } from './permissions.js';

export const ROLE_CODES = ['ADMIN', 'LIBRARIAN', 'MEMBER'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export interface RoleDefinition {
  readonly code: RoleCode;
  readonly name: string;
  readonly description: string;
  /** System roles may not be deleted; new business roles are added as data. */
  readonly isSystem: boolean;
  /** Hierarchy rank — used only for UX ordering and "outrank" checks. */
  readonly rank: number;
  /** Whether the role is granted BRANCH_MANAGE_ALL by default (still revocable). */
  readonly globalBranchScope: boolean;
  readonly permissions: readonly PermissionCode[];
}

/**
 * LIBRARIAN — operational circulation staff.
 *
 * Deliberately NOT granted: user administration, role/permission editing,
 * system settings, audit-log access, or global (all-branch) scope.
 * Separation of duties is enforced here as data, so removing a grant later is
 * a single UPDATE rather than a code change.
 */
const LIBRARIAN_PERMISSIONS: readonly PermissionCode[] = [
  // Organisation (read-only)
  'LIBRARY_VIEW',
  'BRANCH_VIEW',
  'LOCATION_VIEW',
  'SHELF_VIEW',

  // Members
  'MEMBER_VIEW',
  'MEMBER_CREATE',
  'MEMBER_UPDATE',
  'MEMBER_TYPE_VIEW',

  // Catalogue + inventory
  'BOOK_VIEW',
  'BOOK_CREATE',
  'BOOK_UPDATE',
  'BOOK_ARCHIVE',
  'AUTHOR_VIEW',
  'AUTHOR_MANAGE',
  'CATEGORY_VIEW',
  'CATEGORY_MANAGE',
  'PUBLISHER_VIEW',
  'PUBLISHER_MANAGE',
  'TAG_VIEW',
  'TAG_MANAGE',
  'COPY_VIEW',
  'COPY_CREATE',
  'COPY_UPDATE',

  // Circulation (within assigned branches)
  'LOAN_VIEW',
  'LOAN_CREATE',
  'LOAN_RETURN',
  'LOAN_RENEW',
  'LOAN_MARK_LOST',
  'LOAN_MARK_DAMAGED',

  // Reservations
  'RESERVATION_VIEW',
  'RESERVATION_CREATE',
  'RESERVATION_CANCEL',
  'RESERVATION_FULFIL',

  // Borrow requests: reviews the desk queue and fulfils approved requests.
  // Deliberately NOT granted: BORROW_REQUEST_CREATE / *_OWN — a librarian files
  // requests on a member's behalf through the members module, not as themselves.
  'BORROW_REQUEST_VIEW',
  'BORROW_REQUEST_APPROVE',
  'BORROW_REQUEST_REJECT',
  'BORROW_REQUEST_CANCEL',
  'BORROW_REQUEST_ISSUE',

  // Finance (within assigned branches)
  'FINE_VIEW',
  'FINE_CREATE',
  'FINE_UPDATE',
  'FINE_WAIVE',
  'PAYMENT_VIEW',
  'PAYMENT_CREATE',
  'PAYMENT_VOID',

  // Notifications (broadcast limited to assigned branches by scope gate)
  'NOTIFICATION_VIEW_OWN',
  'NOTIFICATION_DELETE_OWN',
  'NOTIFICATION_BROADCAST',

  // Reports (operational, branch-scoped; NOT financial)
  'REPORT_VIEW',
  'REPORT_EXPORT',

  // Digital
  'DIGITAL_VIEW',
  'DIGITAL_ACCESS',
  'DIGITAL_MANAGE',
];

/**
 * MEMBER — library patron.
 *
 * Only `*_OWN` capabilities are granted. Every `*_OWN` route is additionally
 * constrained by Gate 4 (ownership predicate in the SQL query), so these
 * grants can never reach another member's data.
 */
const MEMBER_PERMISSIONS: readonly PermissionCode[] = [
  'BRANCH_VIEW',
  'MEMBER_TYPE_VIEW',
  'BOOK_VIEW',
  'AUTHOR_VIEW',
  'CATEGORY_VIEW',
  'PUBLISHER_VIEW',
  'TAG_VIEW',
  'COPY_VIEW',
  'LOAN_VIEW_OWN',
  'LOAN_RENEW_OWN',
  'RESERVATION_VIEW_OWN',
  'RESERVATION_CREATE_OWN',
  'RESERVATION_CANCEL_OWN',

  // Borrow requests: the `_OWN` variants only. A member may see and withdraw
  // their own requests and nothing else — Gate 4 additionally constrains every
  // query by memberId, so the grant cannot reach another patron's request even
  // if the code were refactored carelessly.
  'BORROW_REQUEST_CREATE',
  'BORROW_REQUEST_VIEW_OWN',
  'BORROW_REQUEST_CANCEL_OWN',
  'FINE_VIEW_OWN',
  'PAYMENT_VIEW_OWN',
  'NOTIFICATION_VIEW_OWN',
  'NOTIFICATION_DELETE_OWN',
  'REPORT_VIEW_OWN',
  'DIGITAL_VIEW',
  'DIGITAL_ACCESS',
];

export const ROLES: readonly RoleDefinition[] = [
  {
    code: 'ADMIN',
    name: 'Administrator',
    description:
      'Full system authority including settings, roles, users, audit log and cross-branch operations.',
    isSystem: true,
    rank: 100,
    globalBranchScope: true,
    permissions: ALL_PERMISSION_CODES,
  },
  {
    code: 'LIBRARIAN',
    name: 'Librarian',
    description:
      'Operational circulation within assigned branches: catalogue, inventory, members, loans, reservations, fines, operational reports.',
    isSystem: true,
    rank: 50,
    globalBranchScope: false,
    permissions: LIBRARIAN_PERMISSIONS,
  },
  {
    code: 'MEMBER',
    name: 'Member',
    description:
      'Library patron. Access limited to their own loans, reservations, fines and notifications.',
    isSystem: true,
    rank: 10,
    globalBranchScope: false,
    permissions: MEMBER_PERMISSIONS,
  },
];

export const ROLE_MAP = Object.fromEntries(ROLES.map((r) => [r.code, r])) as Record<
  RoleCode,
  RoleDefinition
>;

export function isRoleCode(value: string): value is RoleCode {
  return Object.hasOwn(ROLE_MAP, value);
}

/** Permissions a role holds, as a Set. Used by the authorization engine. */
export function permissionsForRole(code: RoleCode): Set<PermissionCode> {
  return new Set(ROLE_MAP[code]?.permissions ?? []);
}
