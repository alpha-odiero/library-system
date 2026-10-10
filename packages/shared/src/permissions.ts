/**
 * PERMISSION REGISTRY — single source of truth.
 *
 * Consumed by:
 *   - `prisma/seed.ts`              → seeds `permissions` + `role_permissions`
 *   - backend `requirePermission()` → type-checked guard arguments
 *   - frontend `usePermission()`    → navigation/button gating (UX only)
 *   - docs generation               → role/permission matrices
 *
 * DESIGN RULE: permissions are RESOURCE-scoped, never row-scoped.
 * "Which rows a permission reaches" is a separate concern handled by branch
 * scope (Gate 3) and ownership (Gate 4) on the backend.
 *
 * Adding a capability is therefore an INSERT here + a seed run — it never
 * requires changing the authorization engine.
 */

export const RESOURCES = [
  'user',
  'role',
  'permission',
  'audit',
  'setting',
  'library',
  'branch',
  'location',
  'shelf',
  'member',
  'member_type',
  'book',
  'author',
  'category',
  'publisher',
  'tag',
  'copy',
  'loan',
  'reservation',
  'borrow_request',
  'fine',
  'payment',
  'notification',
  'report',
  'digital',
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = [
  'view',
  'create',
  'update',
  'delete',
  'manage',
  'export',
  'archive',
  'waive',
  'void',
  'return',
  'renew',
  'cancel',
  /**
   * Decide a request in the member's favour (a librarian approves a title).
   * Kept distinct from `create`/`update`: approval is a decision with a
   * notification and audit consequence, so it needs its own grant to be
   * revocable without also stripping the ability to edit other request fields.
   */
  'approve',
  /**
   * Decide a request against the member's favour. Separate from `approve` so a
   * desk that may approve for stock reasons cannot also refuse a member, and
   * vice versa.
   */
  'reject',
  'broadcast',
  'fulfil',
  'mark_lost',
  'mark_damaged',
  /**
   * Read an entitlement and consume it (open or download a digital resource).
   * Distinct from `view`, which lists metadata, and from `create`, which implies
   * a write: conflating the two either over-grants or produces mislabelled audit
   * entries for what is a read.
   */
  'access',
] as const;

export type Action = (typeof ACTIONS)[number];

export interface PermissionDefinition {
  readonly code: string;
  readonly resource: Resource;
  readonly action: Action;
  readonly description: string;
  /** Privileged capabilities — surfaced in the security review checklist. */
  readonly sensitive?: boolean;
}

/**
 * Order matters only for readability of generated documentation.
 * Codes are stable identifiers; never rename one in place.
 */
export const PERMISSIONS = [
  // ── Users ────────────────────────────────────────────────────────────────
  {
    code: 'USER_VIEW',
    resource: 'user',
    action: 'view',
    description: 'View user accounts and staff directory',
  },
  {
    code: 'USER_CREATE',
    resource: 'user',
    action: 'create',
    description: 'Create user accounts',
    sensitive: true,
  },
  {
    code: 'USER_UPDATE',
    resource: 'user',
    action: 'update',
    description: 'Update user accounts, roles and branch assignments',
    sensitive: true,
  },
  {
    code: 'USER_DELETE',
    resource: 'user',
    action: 'delete',
    description: 'Deactivate and soft-delete user accounts',
    sensitive: true,
  },
  {
    code: 'USER_DEACTIVATE',
    resource: 'user',
    action: 'archive',
    description: 'Suspend or deactivate a user account',
    sensitive: true,
  },

  // ── Roles & permissions ──────────────────────────────────────────────────
  {
    code: 'ROLE_VIEW',
    resource: 'role',
    action: 'view',
    description: 'View roles and their permission grants',
  },
  {
    code: 'ROLE_UPDATE',
    resource: 'role',
    action: 'update',
    description: 'Create or modify roles and their permission grants',
    sensitive: true,
  },
  {
    code: 'PERMISSION_VIEW',
    resource: 'permission',
    action: 'view',
    description: 'View the permission registry',
  },

  // ── Audit & settings ────────────────────────────────────────────────────
  {
    code: 'AUDIT_VIEW',
    resource: 'audit',
    action: 'view',
    description: 'Read the audit log',
    sensitive: true,
  },
  {
    code: 'AUDIT_EXPORT',
    resource: 'audit',
    action: 'export',
    description: 'Export audit log entries',
    sensitive: true,
  },
  {
    code: 'AUDIT_DELETE',
    resource: 'audit',
    action: 'delete',
    description: 'Delete audit log entries (settings-gated, password confirmed)',
    sensitive: true,
  },
  {
    code: 'SETTINGS_VIEW',
    resource: 'setting',
    action: 'view',
    description: 'View system settings',
  },
  {
    code: 'SETTINGS_UPDATE',
    resource: 'setting',
    action: 'update',
    description: 'Change system settings and borrowing policy',
    sensitive: true,
  },

  // ── Organisation ─────────────────────────────────────────────────────────
  { code: 'LIBRARY_VIEW', resource: 'library', action: 'view', description: 'View libraries' },
  {
    code: 'LIBRARY_MANAGE',
    resource: 'library',
    action: 'manage',
    description: 'Create and modify libraries',
    sensitive: true,
  },
  { code: 'BRANCH_VIEW', resource: 'branch', action: 'view', description: 'View branches' },
  {
    code: 'BRANCH_MANAGE',
    resource: 'branch',
    action: 'manage',
    description: 'Create and modify branches',
    sensitive: true,
  },
  {
    code: 'BRANCH_MANAGE_ALL',
    resource: 'branch',
    action: 'update',
    description: 'Operate across ALL branches, ignoring branch scope',
    sensitive: true,
  },
  {
    code: 'LOCATION_VIEW',
    resource: 'location',
    action: 'view',
    description: 'View locations within a branch',
  },
  {
    code: 'LOCATION_MANAGE',
    resource: 'location',
    action: 'manage',
    description: 'Create and modify locations',
    sensitive: true,
  },
  { code: 'SHELF_VIEW', resource: 'shelf', action: 'view', description: 'View shelves and racks' },
  {
    code: 'SHELF_MANAGE',
    resource: 'shelf',
    action: 'manage',
    description: 'Create and modify shelves',
    sensitive: true,
  },

  // ── Members ──────────────────────────────────────────────────────────────
  { code: 'MEMBER_VIEW', resource: 'member', action: 'view', description: 'View member records' },
  { code: 'MEMBER_CREATE', resource: 'member', action: 'create', description: 'Register members' },
  {
    code: 'MEMBER_UPDATE',
    resource: 'member',
    action: 'update',
    description: 'Update member records and membership status',
  },
  {
    code: 'MEMBER_DELETE',
    resource: 'member',
    action: 'delete',
    description: 'Soft-delete member records',
    sensitive: true,
  },
  {
    code: 'MEMBER_VIEW_OTHERS',
    resource: 'member',
    action: 'view',
    description: 'View members belonging to other users (non-self records)',
  },

  // ── Member types ─────────────────────────────────────────────────────────
  {
    code: 'MEMBER_TYPE_VIEW',
    resource: 'member_type',
    action: 'view',
    description: 'View member types and borrowing policy',
  },
  {
    code: 'MEMBER_TYPE_MANAGE',
    resource: 'member_type',
    action: 'manage',
    description: 'Create and modify member types and their limits',
    sensitive: true,
  },

  // ── Catalog ──────────────────────────────────────────────────────────────
  { code: 'BOOK_VIEW', resource: 'book', action: 'view', description: 'View the catalogue' },
  {
    code: 'BOOK_CREATE',
    resource: 'book',
    action: 'create',
    description: 'Create bibliographic records',
  },
  {
    code: 'BOOK_UPDATE',
    resource: 'book',
    action: 'update',
    description: 'Update bibliographic records',
  },
  {
    code: 'BOOK_DELETE',
    resource: 'book',
    action: 'delete',
    description: 'Delete bibliographic records with no history',
    sensitive: true,
  },
  {
    code: 'BOOK_ARCHIVE',
    resource: 'book',
    action: 'archive',
    description: 'Retire a bibliographic record from the active catalogue',
  },
  { code: 'AUTHOR_VIEW', resource: 'author', action: 'view', description: 'View authors' },
  {
    code: 'AUTHOR_MANAGE',
    resource: 'author',
    action: 'manage',
    description: 'Create and modify authors',
  },
  { code: 'CATEGORY_VIEW', resource: 'category', action: 'view', description: 'View categories' },
  {
    code: 'CATEGORY_MANAGE',
    resource: 'category',
    action: 'manage',
    description: 'Create and modify categories and the category tree',
  },
  { code: 'PUBLISHER_VIEW', resource: 'publisher', action: 'view', description: 'View publishers' },
  {
    code: 'PUBLISHER_MANAGE',
    resource: 'publisher',
    action: 'manage',
    description: 'Create and modify publishers',
  },
  { code: 'TAG_VIEW', resource: 'tag', action: 'view', description: 'View tags' },
  { code: 'TAG_MANAGE', resource: 'tag', action: 'manage', description: 'Create and delete tags' },

  // ── Copies ───────────────────────────────────────────────────────────────
  {
    code: 'COPY_VIEW',
    resource: 'copy',
    action: 'view',
    description: 'View physical copies and inventory',
  },
  {
    code: 'COPY_CREATE',
    resource: 'copy',
    action: 'create',
    description: 'Add physical copies to inventory',
  },
  {
    code: 'COPY_UPDATE',
    resource: 'copy',
    action: 'update',
    description: 'Update copy condition, status and location',
  },
  {
    code: 'COPY_DELETE',
    resource: 'copy',
    action: 'delete',
    description: 'Remove copies from inventory',
    sensitive: true,
  },

  // ── Circulation ──────────────────────────────────────────────────────────
  {
    code: 'LOAN_VIEW',
    resource: 'loan',
    action: 'view',
    description: 'View all loans within scope',
  },
  { code: 'LOAN_VIEW_OWN', resource: 'loan', action: 'view', description: 'View own loans' },
  {
    code: 'LOAN_CREATE',
    resource: 'loan',
    action: 'create',
    description: 'Issue a loan to a member',
  },
  { code: 'LOAN_RETURN', resource: 'loan', action: 'return', description: 'Process a return' },
  { code: 'LOAN_RENEW', resource: 'loan', action: 'renew', description: 'Renew a loan' },
  { code: 'LOAN_RENEW_OWN', resource: 'loan', action: 'renew', description: 'Renew own loans' },
  {
    code: 'LOAN_MARK_LOST',
    resource: 'loan',
    action: 'mark_lost',
    description: 'Declare a loan lost',
    sensitive: true,
  },
  {
    code: 'LOAN_MARK_DAMAGED',
    resource: 'loan',
    action: 'mark_damaged',
    description: 'Record damage on return',
  },

  // ── Reservations ─────────────────────────────────────────────────────────
  {
    code: 'RESERVATION_VIEW',
    resource: 'reservation',
    action: 'view',
    description: 'View all reservations within scope',
  },
  {
    code: 'RESERVATION_VIEW_OWN',
    resource: 'reservation',
    action: 'view',
    description: 'View own reservations',
  },
  {
    code: 'RESERVATION_CREATE',
    resource: 'reservation',
    action: 'create',
    description: 'Create a reservation for any member',
  },
  {
    code: 'RESERVATION_CREATE_OWN',
    resource: 'reservation',
    action: 'create',
    description: 'Reserve a title for oneself',
  },
  {
    code: 'RESERVATION_CANCEL',
    resource: 'reservation',
    action: 'cancel',
    description: 'Cancel any reservation within scope',
  },
  {
    code: 'RESERVATION_CANCEL_OWN',
    resource: 'reservation',
    action: 'cancel',
    description: 'Cancel own reservation',
  },
  {
    code: 'RESERVATION_FULFIL',
    resource: 'reservation',
    action: 'fulfil',
    description: 'Convert a ready reservation into a loan',
  },

  // ── Borrow requests ──────────────────────────────────────────────────────
  {
    code: 'BORROW_REQUEST_VIEW',
    resource: 'borrow_request',
    action: 'view',
    description: 'View all borrow requests within library scope',
  },
  {
    code: 'BORROW_REQUEST_VIEW_OWN',
    resource: 'borrow_request',
    action: 'view',
    description: 'View own borrow requests',
  },
  {
    code: 'BORROW_REQUEST_CREATE',
    resource: 'borrow_request',
    action: 'create',
    description: 'File a borrow request for oneself',
  },
  {
    code: 'BORROW_REQUEST_APPROVE',
    resource: 'borrow_request',
    action: 'approve',
    description: 'Approve a pending borrow request',
    sensitive: true,
  },
  {
    code: 'BORROW_REQUEST_REJECT',
    resource: 'borrow_request',
    action: 'reject',
    description: 'Reject a pending borrow request',
    sensitive: true,
  },
  {
    code: 'BORROW_REQUEST_CANCEL',
    resource: 'borrow_request',
    action: 'cancel',
    description: 'Cancel any borrow request within scope',
  },
  {
    code: 'BORROW_REQUEST_CANCEL_OWN',
    resource: 'borrow_request',
    action: 'cancel',
    description: 'Cancel own pending borrow request',
  },
  {
    /**
     * Turn an APPROVED request into a Loan.
     *
     * Distinct from `BORROW_REQUEST_APPROVE` on purpose. Approval commits the
     * library to a member; issuance moves a physical object and creates a Loan.
     * They happen at different moments and are performed by different people at
     * the desk, so a role that may decide requests should not automatically be
     * able to hand over books.
     */
    code: 'BORROW_REQUEST_ISSUE',
    resource: 'borrow_request',
    action: 'create',
    description: 'Issue an approved request as a loan and assign its copy',
    sensitive: true,
  },

  // ── Finance ──────────────────────────────────────────────────────────────
  {
    code: 'FINE_VIEW',
    resource: 'fine',
    action: 'view',
    description: 'View all fines within scope',
  },
  { code: 'FINE_VIEW_OWN', resource: 'fine', action: 'view', description: 'View own fines' },
  { code: 'FINE_CREATE', resource: 'fine', action: 'create', description: 'Assess a fine' },
  { code: 'FINE_UPDATE', resource: 'fine', action: 'update', description: 'Adjust a fine' },
  {
    code: 'FINE_WAIVE',
    resource: 'fine',
    action: 'waive',
    description: 'Waive all or part of a fine',
    sensitive: true,
  },
  {
    code: 'PAYMENT_VIEW',
    resource: 'payment',
    action: 'view',
    description: 'View all payments and receipts within scope',
  },
  {
    code: 'PAYMENT_VIEW_OWN',
    resource: 'payment',
    action: 'view',
    description: 'View own payment receipts',
  },
  {
    code: 'PAYMENT_CREATE',
    resource: 'payment',
    action: 'create',
    description: 'Record a payment against a fine',
  },
  {
    code: 'PAYMENT_CREATE_OWN',
    resource: 'payment',
    action: 'create',
    description: 'Pay own fine via an online method',
  },
  {
    code: 'PAYMENT_VOID',
    resource: 'payment',
    action: 'void',
    description: 'Void a recorded payment (never deletes it)',
    sensitive: true,
  },

  // ── Notifications ────────────────────────────────────────────────────────
  {
    code: 'NOTIFICATION_VIEW_OWN',
    resource: 'notification',
    action: 'view',
    description: 'View own notifications',
  },
  {
    code: 'NOTIFICATION_DELETE_OWN',
    resource: 'notification',
    action: 'delete',
    description: 'Delete own notifications',
  },
  {
    code: 'NOTIFICATION_BROADCAST',
    resource: 'notification',
    action: 'broadcast',
    description: 'Send notifications to members in scope',
    sensitive: true,
  },

  // ── Reports ──────────────────────────────────────────────────────────────
  {
    code: 'REPORT_VIEW',
    resource: 'report',
    action: 'view',
    description: 'View reports and analytics within scope',
  },
  {
    code: 'REPORT_VIEW_FINANCIAL',
    resource: 'report',
    action: 'view',
    description: 'View financial reports (revenue, outstanding fines)',
    sensitive: true,
  },
  {
    code: 'REPORT_EXPORT',
    resource: 'report',
    action: 'export',
    description: 'Export reports to CSV/Excel/PDF',
  },
  {
    code: 'REPORT_VIEW_OWN',
    resource: 'report',
    action: 'view',
    description: 'View own borrowing summary',
  },

  // ── Digital resources ────────────────────────────────────────────────────
  {
    code: 'DIGITAL_VIEW',
    resource: 'digital',
    action: 'view',
    description: 'View digital resource metadata',
  },
  {
    code: 'DIGITAL_ACCESS',
    resource: 'digital',
    action: 'access',
    description: 'Access/download entitled digital resources',
  },
  {
    code: 'DIGITAL_MANAGE',
    resource: 'digital',
    action: 'manage',
    description: 'Upload and manage digital resources',
    sensitive: true,
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];
export type PermissionMap = Record<PermissionCode, PermissionDefinition>;

export const PERMISSION_MAP = Object.fromEntries(
  PERMISSIONS.map((p) => [p.code, p]),
) as PermissionMap;

/**
 * Already typed as `PermissionCode[]`: mapping a tuple of literal object types
 * preserves the literal `code` types, so no assertion is needed or wanted.
 */
export const ALL_PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.hasOwn(PERMISSION_MAP, value);
}
