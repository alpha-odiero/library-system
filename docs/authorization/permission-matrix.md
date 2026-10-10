# Permission Matrix

**Generated from `packages/shared/src/permissions.ts` and `packages/shared/src/roles.ts`.
Those files are the source of truth — this document describes them, it does not
define them.** If this table and the code disagree, the code is correct and this
file is stale.

## Registry shape

80 permissions across 24 resources and 17 actions.

|                        | Count |
| ---------------------- | ----- |
| Total permissions      | 80    |
| Flagged `sensitive`    | 23    |
| Granted to `ADMIN`     | 80    |
| Granted to `LIBRARIAN` | 48    |
| Granted to `MEMBER`    | 20    |

Permissions are **`RESOURCE_ACTION`**, uppercase and underscore-separated, and a
code is a stable identifier: never rename one in place, because it is stored in
the `permissions` table and referenced by audit history.

### Why permissions are resource-scoped, never row-scoped

`LOAN_VIEW` answers _"may this caller see loans at all"_. It does **not** answer
_"which loans"_. That second question is ownership (Gate 4) and branch scope
(Gate 3), and it is a `WHERE` clause rather than a permission code.

The alternative — inventing `LOAN_VIEW_OWN_BRANCH_3` — produces an unbounded
number of codes, cannot express "the union of my branches", and puts a
data-dependent answer in the authorization table where it belongs in the query.
The design rule is stated in the registry header:

> Permissions are RESOURCE-scoped, never row-scoped. "Which rows a permission
> reaches" is a separate concern handled by branch scope (Gate 3) and ownership
> (Gate 4) on the backend.

### Why `action` is an enumeration

`ACTIONS` is a closed union, so `requirePermission()` takes a type-checked code
and a typo is a compile error. It is also why the vocabulary is small: `view`,
`create`, `update`, `delete`, `manage`, `export`, `archive`, `waive`, `void`,
`return`, `renew`, `cancel`, `broadcast`, `fulfil`, `mark_lost`,
`mark_damaged`, `access`.

Domain verbs (`renew`, `return`, `waive`, `fulfil`) are separate actions rather
than generic `update` because their audit entries must be distinguishable.
"Someone updated a loan" is not a useful audit record; "someone renewed a loan"
is.

`access` is split out from `view` and `create` for digital resources:
consuming an entitlement is a _read_ that must be recorded, and conflating it
with `view` (metadata) or `create` (a write) either over-grants or produces a
misleading audit entry for what was a read.

## The full matrix

`ADMIN` holds every permission by construction (`ALL_PERMISSION_CODES`), so its
column is uniform and omitted from the counting discussion below.

| Permission                | Resource     | Action       | Sensitive | ADMIN | LIBRARIAN | MEMBER |
| ------------------------- | ------------ | ------------ | :-------: | :---: | :-------: | :----: |
| `USER_VIEW`               | user         | view         |     —     |  yes  |     —     |   —    |
| `USER_CREATE`             | user         | create       |  **yes**  |  yes  |     —     |   —    |
| `USER_UPDATE`             | user         | update       |  **yes**  |  yes  |     —     |   —    |
| `USER_DELETE`             | user         | delete       |  **yes**  |  yes  |     —     |   —    |
| `USER_DEACTIVATE`         | user         | archive      |  **yes**  |  yes  |     —     |   —    |
| `ROLE_VIEW`               | role         | view         |     —     |  yes  |     —     |   —    |
| `ROLE_UPDATE`             | role         | update       |  **yes**  |  yes  |     —     |   —    |
| `PERMISSION_VIEW`         | permission   | view         |     —     |  yes  |     —     |   —    |
| `AUDIT_VIEW`              | audit        | view         |  **yes**  |  yes  |     —     |   —    |
| `AUDIT_EXPORT`            | audit        | export       |  **yes**  |  yes  |     —     |   —    |
| `SETTINGS_VIEW`           | setting      | view         |     —     |  yes  |     —     |   —    |
| `SETTINGS_UPDATE`         | setting      | update       |  **yes**  |  yes  |     —     |   —    |
| `LIBRARY_VIEW`            | library      | view         |     —     |  yes  |    yes    |   —    |
| `LIBRARY_MANAGE`          | library      | manage       |  **yes**  |  yes  |     —     |   —    |
| `BRANCH_VIEW`             | branch       | view         |     —     |  yes  |    yes    |  yes   |
| `BRANCH_MANAGE`           | branch       | manage       |  **yes**  |  yes  |     —     |   —    |
| `BRANCH_MANAGE_ALL`       | branch       | update       |  **yes**  |  yes  |     —     |   —    |
| `LOCATION_VIEW`           | location     | view         |     —     |  yes  |    yes    |   —    |
| `LOCATION_MANAGE`         | location     | manage       |  **yes**  |  yes  |     —     |   —    |
| `SHELF_VIEW`              | shelf        | view         |     —     |  yes  |    yes    |   —    |
| `SHELF_MANAGE`            | shelf        | manage       |  **yes**  |  yes  |     —     |   —    |
| `MEMBER_VIEW`             | member       | view         |     —     |  yes  |    yes    |   —    |
| `MEMBER_CREATE`           | member       | create       |     —     |  yes  |    yes    |   —    |
| `MEMBER_UPDATE`           | member       | update       |     —     |  yes  |    yes    |   —    |
| `MEMBER_DELETE`           | member       | delete       |  **yes**  |  yes  |     —     |   —    |
| `MEMBER_VIEW_OTHERS`      | member       | view         |     —     |  yes  |     —     |   —    |
| `MEMBER_TYPE_VIEW`        | member_type  | view         |     —     |  yes  |    yes    |  yes   |
| `MEMBER_TYPE_MANAGE`      | member_type  | manage       |  **yes**  |  yes  |     —     |   —    |
| `BOOK_VIEW`               | book         | view         |     —     |  yes  |    yes    |  yes   |
| `BOOK_CREATE`             | book         | create       |     —     |  yes  |    yes    |   —    |
| `BOOK_UPDATE`             | book         | update       |     —     |  yes  |    yes    |   —    |
| `BOOK_DELETE`             | book         | delete       |  **yes**  |  yes  |     —     |   —    |
| `BOOK_ARCHIVE`            | book         | archive      |     —     |  yes  |    yes    |   —    |
| `AUTHOR_VIEW`             | author       | view         |     —     |  yes  |    yes    |  yes   |
| `AUTHOR_MANAGE`           | author       | manage       |     —     |  yes  |    yes    |   —    |
| `CATEGORY_VIEW`           | category     | view         |     —     |  yes  |    yes    |  yes   |
| `CATEGORY_MANAGE`         | category     | manage       |     —     |  yes  |    yes    |   —    |
| `PUBLISHER_VIEW`          | publisher    | view         |     —     |  yes  |    yes    |  yes   |
| `PUBLISHER_MANAGE`        | publisher    | manage       |     —     |  yes  |    yes    |   —    |
| `TAG_VIEW`                | tag          | view         |     —     |  yes  |    yes    |  yes   |
| `TAG_MANAGE`              | tag          | manage       |     —     |  yes  |    yes    |   —    |
| `COPY_VIEW`               | copy         | view         |     —     |  yes  |    yes    |  yes   |
| `COPY_CREATE`             | copy         | create       |     —     |  yes  |    yes    |   —    |
| `COPY_UPDATE`             | copy         | update       |     —     |  yes  |    yes    |   —    |
| `COPY_DELETE`             | copy         | delete       |  **yes**  |  yes  |     —     |   —    |
| `LOAN_VIEW`               | loan         | view         |     —     |  yes  |    yes    |   —    |
| `LOAN_VIEW_OWN`           | loan         | view         |     —     |  yes  |     —     |  yes   |
| `LOAN_CREATE`             | loan         | create       |     —     |  yes  |    yes    |   —    |
| `LOAN_RETURN`             | loan         | return       |     —     |  yes  |    yes    |   —    |
| `LOAN_RENEW`              | loan         | renew        |     —     |  yes  |    yes    |   —    |
| `LOAN_RENEW_OWN`          | loan         | renew        |     —     |  yes  |     —     |  yes   |
| `LOAN_MARK_LOST`          | loan         | mark_lost    |  **yes**  |  yes  |    yes    |   —    |
| `LOAN_MARK_DAMAGED`       | loan         | mark_damaged |     —     |  yes  |    yes    |   —    |
| `RESERVATION_VIEW`        | reservation  | view         |     —     |  yes  |    yes    |   —    |
| `RESERVATION_VIEW_OWN`    | reservation  | view         |     —     |  yes  |     —     |  yes   |
| `RESERVATION_CREATE`      | reservation  | create       |     —     |  yes  |    yes    |   —    |
| `RESERVATION_CREATE_OWN`  | reservation  | create       |     —     |  yes  |     —     |  yes   |
| `RESERVATION_CANCEL`      | reservation  | cancel       |     —     |  yes  |    yes    |   —    |
| `RESERVATION_CANCEL_OWN`  | reservation  | cancel       |     —     |  yes  |     —     |  yes   |
| `RESERVATION_FULFIL`      | reservation  | fulfil       |     —     |  yes  |    yes    |   —    |
| `FINE_VIEW`               | fine         | view         |     —     |  yes  |    yes    |   —    |
| `FINE_VIEW_OWN`           | fine         | view         |     —     |  yes  |     —     |  yes   |
| `FINE_CREATE`             | fine         | create       |     —     |  yes  |    yes    |   —    |
| `FINE_UPDATE`             | fine         | update       |     —     |  yes  |    yes    |   —    |
| `FINE_WAIVE`              | fine         | waive        |  **yes**  |  yes  |    yes    |   —    |
| `PAYMENT_VIEW`            | payment      | view         |     —     |  yes  |    yes    |   —    |
| `PAYMENT_VIEW_OWN`        | payment      | view         |     —     |  yes  |     —     |  yes   |
| `PAYMENT_CREATE`          | payment      | create       |     —     |  yes  |    yes    |   —    |
| `PAYMENT_CREATE_OWN`      | payment      | create       |     —     |  yes  |     —     |   —    |
| `PAYMENT_VOID`            | payment      | void         |  **yes**  |  yes  |    yes    |   —    |
| `NOTIFICATION_VIEW_OWN`   | notification | view         |     —     |  yes  |    yes    |  yes   |
| `NOTIFICATION_DELETE_OWN` | notification | delete       |     —     |  yes  |    yes    |  yes   |
| `NOTIFICATION_BROADCAST`  | notification | broadcast    |  **yes**  |  yes  |    yes    |   —    |
| `REPORT_VIEW`             | report       | view         |     —     |  yes  |    yes    |   —    |
| `REPORT_VIEW_FINANCIAL`   | report       | view         |  **yes**  |  yes  |     —     |   —    |
| `REPORT_EXPORT`           | report       | export       |     —     |  yes  |    yes    |   —    |
| `REPORT_VIEW_OWN`         | report       | view         |     —     |  yes  |     —     |  yes   |
| `DIGITAL_VIEW`            | digital      | view         |     —     |  yes  |    yes    |  yes   |
| `DIGITAL_ACCESS`          | digital      | access       |     —     |  yes  |    yes    |  yes   |
| `DIGITAL_MANAGE`          | digital      | manage       |  **yes**  |  yes  |    yes    |   —    |

## Reading the matrix

### The `_OWN` split is the member-safety mechanism

Every member capability has a staff counterpart and an `_OWN` counterpart:

| Staff                | Member                   |
| -------------------- | ------------------------ |
| `LOAN_VIEW`          | `LOAN_VIEW_OWN`          |
| `LOAN_RENEW`         | `LOAN_RENEW_OWN`         |
| `RESERVATION_VIEW`   | `RESERVATION_VIEW_OWN`   |
| `RESERVATION_CREATE` | `RESERVATION_CREATE_OWN` |
| `RESERVATION_CANCEL` | `RESERVATION_CANCEL_OWN` |
| `FINE_VIEW`          | `FINE_VIEW_OWN`          |
| `PAYMENT_VIEW`       | `PAYMENT_VIEW_OWN`       |
| `REPORT_VIEW`        | `REPORT_VIEW_OWN`        |

The split exists so that granting a member role the _ability_ to renew a loan is
impossible without also granting the ability to renew **someone else's**. The
`_OWN` variants are additionally constrained by Gate 4, so a member's grant
cannot reach another member's rows even by mistake in a query. See
[Authorization](./authorization.md).

`PAYMENT_CREATE_OWN` is the exception: **no member may create a payment for
themselves.** Recording a payment requires staff, because it produces a financial
record and a receipt number. Online payment is a separate, gated flow — not a
member writing to `fine_payments`.

### Two split codes worth calling out

- **`MEMBER_VIEW` vs `MEMBER_VIEW_OTHERS`.** Neither librarian nor member holds
  `MEMBER_VIEW_OTHERS`. A member resolves to their own member record through
  `/auth/me`, not through a general member query, so the code exists to make the
  distinction explicit for a future "support agent" role rather than to be
  granted now.
- **`BRANCH_MANAGE` vs `BRANCH_MANAGE_ALL`.** `BRANCH_MANAGE` creates and edits
  branches. `BRANCH_MANAGE_ALL` lifts Gate 3 so a librarian can operate across
  every branch. Splitting them means "can create a branch" and "can ignore branch
  scope" are independently revocable. Only `ADMIN` holds the second. Grants are
  role-level, so taking it from one librarian means assigning a role that omits
  it — see [Role matrix](./role-matrix.md#narrowing-a-grant-without-a-code-change).

### Sensitive permissions

23 permissions are flagged `sensitive`. The flag is documentation and tooling
input, not enforcement: it drives the security review checklist and makes the
high-privilege surface greppable.

They are the permissions where a mistake is unrecoverable or immediately
valuable to an attacker:

| Group                | Codes                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Account lifecycle    | `USER_CREATE`, `USER_UPDATE`, `USER_DELETE`, `USER_DEACTIVATE`                            |
| Privilege escalation | `ROLE_UPDATE`                                                                             |
| Evidentiary          | `AUDIT_VIEW`, `AUDIT_EXPORT`                                                              |
| Policy               | `SETTINGS_UPDATE`                                                                         |
| Organisation         | `LIBRARY_MANAGE`, `BRANCH_MANAGE`, `BRANCH_MANAGE_ALL`, `LOCATION_MANAGE`, `SHELF_MANAGE` |
| Members              | `MEMBER_DELETE`, `MEMBER_TYPE_MANAGE`                                                     |
| Catalogue            | `BOOK_DELETE`, `COPY_DELETE`                                                              |
| Circulation          | `LOAN_MARK_LOST`                                                                          |
| Finance              | `FINE_WAIVE`, `PAYMENT_VOID`                                                              |
| Messaging            | `NOTIFICATION_BROADCAST`                                                                  |
| Reporting            | `REPORT_VIEW_FINANCIAL`                                                                   |
| Digital              | `DIGITAL_MANAGE`                                                                          |

`BOOK_DELETE` and `COPY_DELETE` are sensitive because a `sensitive` delete is
usually a mistake rather than an intent: `BOOK_ARCHIVE` and `COPY_UPDATE`
(retiring, not erasing) are the operations a librarian actually wants.

## Enforcing the matrix

Three independent checks, so no single omission is load-bearing:

1. **Compile time.** `requirePermission('LOAN_VEW')` is a type error. The
   `PermissionCode` union is closed.
2. **Test time.** `authorization.test.ts` walks the matrix and asserts each
   role's response for each protected route — a real request through the real
   Express stack, not a unit test of the guard.
3. **Runtime.** `requirePermission()` resolves the caller's permissions from the
   database (union across all assigned roles) and denies on absence. It never
   consults the frontend, and it never has a default-allow branch.

Because grants live in `role_permissions` and roles are assigned to users,
revoking a capability is an `UPDATE`, not a deployment. The role definitions in
`roles.ts` are the **seed**; the database is the runtime authority.

## Changing the matrix

**Adding a permission** — append to `PERMISSIONS`, add grants in `roles.ts`, run
the seed. `requirePermission()` needs no change; the engine is data-driven.

**Adding a role** — append to `ROLES`. It appears in the database on the next
seed. No code path enumerates role codes.

**Removing a grant** — remove from `roles.ts` and re-seed. The permission and
its `role_permissions` row remain, so history stays interpretable; an
outstanding audit entry still names a permission that no longer exists.

**Adding an action verb** — extend `ACTIONS`. This is the only change that
touches the type system, and it is a compile error until every consumer handles
the new verb.

## Conventions

- Codes are `RESOURCE_ACTION`, uppercase, snake case for multi-word actions
  (`mark_lost`, not `markLost`).
- `_OWN` suffix means "the caller's own rows", and implies Gate 4.
- `_ALL` suffix means "ignores branch scope".
- Never encode a row id, a branch id, or a time window in a permission code.
