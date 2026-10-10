# Role Matrix

**Source of truth: `packages/shared/src/roles.ts`, seeded into `Role`,
`RolePermission`, and `UserBranch`.** The role definitions in code are the
**seed**; the database rows are the **runtime authority**.

## The three roles

|                     | `ADMIN`       | `LIBRARIAN`       | `MEMBER` |
| ------------------- | ------------- | ----------------- | -------- |
| Name                | Administrator | Librarian         | Member   |
| Rank                | 100           | 50                | 10       |
| System role         | yes           | yes               | yes      |
| `globalBranchScope` | yes           | no                | no       |
| Permissions         | 80 (all)      | 48                | 20       |
| Branch scope        | all branches  | assigned branches | n/a      |
| Has a member record | no            | no                | yes      |

`rank` orders the UI and supports "can this user outrank that one" checks. It is
**not** an authorization input: a higher rank never implies a permission, because
that would make the permission matrix a lie.

## What each role is for

### `ADMIN` — full system authority

Configuration, identity, and evidentiary surfaces: user accounts, roles and
permissions, library settings, the audit log, cross-branch operations, and every
operational permission as well.

The justification for `ADMIN` holding all 80 is auditability, not capability.
Every `sensitive` permission is exercised by an administrator eventually, and
the audit trail records the actor. Restricting an administrator to a subset of
permissions produces an account that cannot finish a task and an audit log full
of privilege errors.

`BRANCH_MANAGE_ALL` is held only by `ADMIN` by default, so a librarian cannot
widen their own reach by any route.

### `LIBRARIAN` — operational circulation, within assigned branches

Everything needed to run a lending desk: catalogue and inventory, member
registration, issuing, returning, renewing, marking lost and damaged,
reservations, fines and payments, operational reports, and digital resource
management.

**Deliberately not granted**, and this is the separation of duties that makes the
role auditable:

| Withheld                     | Why                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `USER_*`                     | Staff cannot create or edit accounts. A librarian who can also grant themselves a role has no separation of duties at all.        |
| `ROLE_UPDATE`                | Cannot alter permissions. See above.                                                                                              |
| `SETTINGS_UPDATE`            | Cannot change borrowing policy library-wide. The person applying a policy should not be the person defining it.                   |
| `AUDIT_VIEW`, `AUDIT_EXPORT` | Cannot read the record of their own actions.                                                                                      |
| `REPORT_VIEW_FINANCIAL`      | Cannot see revenue and outstanding fines library-wide. They see fines they operate on, through `FINE_VIEW` within their branches. |
| `BRANCH_MANAGE_ALL`          | Cannot operate outside assigned branches.                                                                                         |

The header comment in `roles.ts` states this intent, and the omissions are
load-bearing: an audit log that a librarian cannot read is worth much less.

### `MEMBER` — library patron

Catalogue browsing plus self-service on their own records: own loans, own
renewals, own reservations, own fines, own payment receipts, own notifications,
own borrowing summary, and entitled digital resources.

Every grant is an `_OWN` variant, and every `_OWN` route is additionally
constrained by Gate 4 — an ownership predicate in the SQL query, not a post-fetch
comparison. The grants can never reach another member's rows.

`MEMBER` does **not** hold `PAYMENT_CREATE_OWN`. Recording a payment produces a
financial record and a receipt number; it is a staff action. Online payment is a
separate gated flow.

## Deny by default

```
  ADMIN      80 / 80   permissions
  LIBRARIAN  48 / 80   permissions
  MEMBER     20 / 80   permissions
```

Any permission not granted is a **denial**. There is no default-allow branch
anywhere in the authorization path, and `requirePermission()` cannot be called
with an empty list by accident — the zero-argument form is reachable only by
naming it, and it means "authenticated is sufficient", which is a deliberate,
visible decision.

A new role starts with **zero** permissions. It is invisible and inert until
grants are added.

## Branch scope

Branch scope is a property of the _user_, not of the role: `UserBranch` assigns
branch ids per user, and `AuthPrincipal.branchScope` is computed as:

- `null` — every branch, when the caller holds `BRANCH_MANAGE_ALL`;
- otherwise the list of assigned branch ids.

`null` means "unrestricted", and it is deliberately distinct from `[]`. An empty
array means "assigned to no branch", which denies everything — see
`resolveEffectiveBranchId()`, which rejects rather than guessing a branch when
the scope is empty.

A member's branch scope comes from their home branch and never grants them access
to another member's records; ownership and branch scope are independent
predicates and both are applied.

## Assigning roles

```
users.role_id → roles.id          exactly one role per user
user_branches                       zero or more branch assignments per staff user
role_permissions                   the grants for a role
```

A user has **one** role. Multiple simultaneous roles are deliberately not
supported in V1: the permission set would become the union of several roles, and
"which of my roles lets me waive this fine" becomes unanswerable from the audit
log. If a business needs a part-time librarian who is also a member, the right
shape is a `MEMBER` user with a staff role assigned — not two roles.

## Narrowing a grant without a code change

Because grants live in `role_permissions`, narrowing a role's authority is data:

**To revoke a capability from everyone in a role** — delete the
`role_permissions` row and update `roles.ts` so the next seed agrees.

**To revoke a capability from one user** — create a new role that is a copy of
the current one minus that permission, and reassign the user. No code change, no
deployment. The original role stays intact for everyone else.

**To change branch reach for one user** — edit `user_branches`. Adding a branch
widens reach, removing one narrows it, and neither touches a permission.

Every one of these is an `audit_logs` entry. A role or branch change is among the
most consequential events the system records.

## The executed matrix

`authorization.test.ts` walks this matrix against the real Express stack: real
tokens, real cookies, real route handlers, real database. It asserts that each
role receives the expected status for each protected route, including the
negative cases — that `MEMBER` gets 403 on `MEMBER_VIEW`, that `LIBRARIAN` gets
403 on `AUDIT_VIEW`, and that an anonymous caller gets 401 everywhere except the
`PUBLIC_ROUTES` allowlist.

`security/route-manifest.test.ts` walks the mounted Express router and fails if
**any** route is reachable without authentication or without a declared
permission. That test is what makes deny-by-default an enforced property rather
than a stated intention: adding a route and forgetting its guard fails the build.

## Conventions

- Role codes are uppercase and stable: `ADMIN`, `LIBRARIAN`, `MEMBER`.
- Never rename a role code in place — it is a foreign key target in `users` and
  appears in audit history.
- `isSystem: true` means the API refuses to delete the role.
- A role's rank is for display and outranking checks only, never authorization.
- Prefer a new permission over a new role. "Librarian who may waive fines under
  1000" is a new role; "librarian" plus a threshold check is a rule.
