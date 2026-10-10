# Authorization and Ownership

The model itself: four gates, what each one decides, and the failure mode each
one prevents.

> **Users should only see and access what they are explicitly authorized to see
> and access.**

Every rule in this document descends from that sentence.

## The four gates

| Gate                 | Question                        | Decides          | Enforced in                                        |
| -------------------- | ------------------------------- | ---------------- | -------------------------------------------------- |
| **1** Authentication | Who is this?                    | Identity         | `middleware/authenticate.ts`                       |
| **2** Permission     | May they perform this action?   | Capability       | `middleware/authorize.ts`                          |
| **3** Branch scope   | May they touch _this_ branch?   | Tenancy boundary | `middleware/scope.ts`                              |
| **4** Ownership      | Is _this record_ theirs to see? | Row visibility   | `middleware/ownership.ts`, composed into the query |

They are four gates rather than one `authorize()` helper because **they fail
differently, they are fixed differently, and collapsing them is how real
vulnerabilities happen:**

- Collapsing 1 and 2 produces a 403 where a 401 is required, so a client cannot
  tell "log in" from "you may not".
- Collapsing 2 and 4 produces a permission check standing in for a missing `WHERE`
  clause. `MEMBER` holds `LOAN_VIEW_OWN`; the permission name is a lie unless a
  query predicate enforces it. A member requests another member's loan id and
  receives it.
- Collapsing 3 and 4 produces a scoped librarian seeing out-of-scope rows because
  one predicate overwrote the other — `scopedOwnershipFilter()` exists because
  that happened.

## Gate 1 — Authentication

`requireAuth()` verifies the access token, confirms the session is still live in
the database, and builds an `AuthPrincipal`. `optionalAuth()` attaches a principal
when one is present but never rejects. Both are documented in
[Authentication](./authentication.md).

A principal is the whole authorization context:

```ts
interface AuthPrincipal {
  userId: string;
  email: string;
  roleCode: string;
  sessionId: string;
  permissions: ReadonlySet<string>; // union across the user's grants
  branchScope: readonly string[] | null; // null = all branches
  memberId: string | null; // null for staff
}
```

The session is checked against the database on every request, which is what makes
logout-everywhere and per-session revocation immediate rather than effective at
token expiry.

## Gate 2 — Permission

```ts
requirePermission('LOAN_CREATE'); // OR — holds at least one
requireAllPermissions('X', 'Y'); // AND — holds all
requireRole('ADMIN'); // coarse; prefer permissions
```

The implementation has no default-allow branch. Absence from the principal's
permission set is a denial, always.

**Prefer permissions over roles.** A role check hard-codes a role code into a
route; a permission check lets the grant change in the database. `requireRole()`
exists for the few places where "which kind of staff is this" really is the
question.

Grants are read from the database, not from `roles.ts`. The code is the seed; the
`role_permissions` table is the authority.

## Gate 3 — Branch scope

Answering "may this user act on branch X's data?" with a permission check is _the
classic multi-branch vulnerability_: a librarian with `LOAN_CREATE` posting a
loan against a copy at a branch they were never assigned to.

```ts
isBranchInScope(principal, branchId); // test
assertBranchScope(principal, branchId); // service-layer throw
branchScopeFilter(principal, 'homeBranchId'); // the predicate that enforces it
```

### A scope test is never sufficient on its own

The predicate is what enforces Gate 3, not the test. `branchScopeFilter()` is
**spread into the query**:

```ts
where: { ...branchScopeFilter(principal, 'homeBranchId'), status: 'ACTIVE' }
```

`findUnique` by id followed by a scope test leaks existence — through timing and
through the status code — and it has already read the row the caller should not
have been able to see.

**The spread is load-bearing.** A helper returning a whole `where` object is one
caller's extra property away from silently dropping the scope:

```ts
where: { status, ...branchScopeFilter(...) }  // safe
where: { ...branchScopeFilter(...), status }  // safe — this is the convention
```

Everywhere in this codebase the scope filter comes **first**, so a caller's
predicates can only add to it, never replace it.

### `403` is correct here

Unlike Gate 4, revealing that a branch id exists leaks nothing: branches are
public information within a library. `requireBranchScope()` answers 403.

### `branchScope: null` vs `[]`

`null` means unrestricted — all branches. `[]` means assigned to nothing and
denies everything. They are different states and the distinction is deliberate:
an empty scope must not be treated as "no restriction".

`resolveEffectiveBranchId()` rejects rather than defaulting when the scope is
empty. Guessing a branch would place data somewhere the user cannot see it.

## Gate 4 — Ownership

**THE RULE: ownership is a `WHERE` predicate, never a post-fetch comparison.**

A handler that loads a row and then checks ownership has already read the row. It
may then get the error right — but the row was already in memory, and the
enforcement depends on every handler remembering. The predicate makes the correct
behaviour the default.

```ts
where: { ...ownOrStaffFilter(principal, 'LOAN_VIEW') }   // the ordinary case
```

### `ownOrStaffFilter` — the pattern behind every `_OWN` pair

```ts
if (principal.permissions.has(staffPermission)) return {}; // staff: scoped world
return ownMemberFilter(principal, ownerField); // member: own rows only
```

Staff with the permission see everything inside their branch scope; a member sees
only their own. Encoding both in one `OR` keeps that decision in a single
reviewable place rather than spread across every handler.

### The always-false predicate

```ts
export const NO_MEMBER_PROFILE = '00000000-0000-0000-0000-000000000000';

if (!principal.memberId) return { [field]: NO_MEMBER_PROFILE };
```

**Never return `{}` from an ownership filter.** Prisma reads an empty object as
"no constraint", so a staff user with no member profile would be handed every
member's loans. This is the single most dangerous shape in the authorization
layer, which is why it is commented as such.

The sentinel is an invalid-UUID-shaped constant rather than a string like
`'none'`, because it must fail for the right reason: the columns are non-nullable
`@db.Uuid`, so no row can ever carry it. A string sentinel relies on the column
being non-empty, which a future migration could invalidate silently.

### 404, not 403, and why

A resource the caller may not see is reported as **404**. This is a deliberate
information-disclosure decision.

A 403 for "exists but forbidden" and a 404 for "does not exist" turns every
endpoint into an enumeration oracle: an authenticated member walks member ids and
reads the status codes to discover who is registered. Both cases answer 404.

`assertOwned()` throws 404 unconditionally, for everyone. An earlier version
returned 403 to holders of a broad permission such as `MEMBER_VIEW`, reasoning
that staff are "allowed to know" the record exists. That was wrong: `assertOwned`
is reached on `*_OWN` routes, where a staff caller has already failed a filter
that was supposed to _widen_ their result set. Answering 403 there both leaks
existence and points staff at the wrong problem. Staff who legitimately hold a
broader permission should use `assertCanModifyOwn()`, which returns before the
check, or widen the query with `ownOrStaffFilter()`.

### Ownership is enforced before the handler

```ts
assertSelfOrPermission(principal, targetMemberId, 'LOAN_RENEW', 'Loan');
```

A guard against a whole class of mistake in self-service routes: reading the
target id from the URL instead of the principal. A member who can reach
`/api/v1/members/:id/renew` with any id is stopped here, **before the handler**,
because no amount of per-handler discipline is reliable enough to prevent it.

### Ownership and branch scope compose

```ts
scopedOwnershipFilter(principal, {
  staffPermission: 'MEMBER_VIEW',
  branchScopeFilter: branchScopeFilter(principal, 'homeBranchId'),
});
```

Two independent predicates, both present. A scoped librarian's list once returned
out-of-scope rows because one filter overwrote the other.

## Status codes

| Situation                                             | Status  |
| ----------------------------------------------------- | ------- |
| No credentials, or an invalid/expired one             | **401** |
| Authenticated, lacks the permission                   | **403** |
| Authenticated, in scope, but the record is not theirs | **404** |
| Authenticated, but the branch is out of scope         | **403** |
| Passes every gate, but no matching row exists         | **404** |
| Passes every gate, and the row exists                 | **200** |

401 versus 403 is never blurred: a client must be able to tell "log in again"
from "ask someone for access".

## Deny by default, enforced

Three mechanisms, so no single omission is load-bearing:

**1. Inverted default at the router.** `denyAnonymous()` does not consult the
`PUBLIC_ROUTES` allowlist — it checks whether a principal exists. A route is
therefore protected unless it is _explicitly_ wrapped in `allowAnonymous()`.
Forgetting to protect a route **closes** it; exposing a route takes an explicit,
visible act.

**2. Compile time.** `requirePermission()` accepts only `PermissionCode`. A typo
is a compile error, and a permission that does not exist in the registry cannot be
requested.

**3. A test that walks the router.** `security/route-manifest.test.ts` mounts the
real Express app and asserts that every route outside `PUBLIC_ROUTES` requires
authentication and declares a permission. Adding a route without a guard fails
the build.

`PUBLIC_ROUTES` is a short, explicit, auditable list — login, refresh,
registration, public settings, health. It is reviewed as a security surface, not
grown by accident.

## Frontend visibility is not security

The frontend hides what a user may not do:

```tsx
const { can } = usePermissions();
{
  can('LOAN_RENEW') && <Button onClick={renew}>Renew</Button>;
}
```

This is **UX only**. The API is called over the network by anyone, including a
user who edited the bundle, so the backend enforces every gate regardless. A
hidden button is an affordance, never a control.

The point of the client-side gating is that a member is not shown a Settings link
that would 403. The point of the backend gating is that it does not matter.

Both directions are tested: `authorization.test.ts` proves the backend refuses,
and the frontend tests prove the navigation is not misleading.

## Row-level security: why the database does not enforce this

PostgreSQL RLS is available and was considered. It was not adopted, because:

- Prisma does not emit `SET LOCAL app.current_user`, so every transaction would
  need a hand-written prelude that the ORM cannot see;
- a security policy that only works when the connection is set up correctly fails
  **open**, which is the worst possible failure direction;
- the application already owns identity and session state, so the database would
  need a second copy of it.

The defense is instead layered where the facts live: a predicate in every query,
composed from helpers, covered by an executed matrix, and checked by a test that
fails when a route is added without a guard.

## Auditing

Every decision-relevant action is recorded with actor, action, entity, entity id,
timestamp, IP, user agent, request id, and before/after state — in the **same
transaction** as the action, so an audit row cannot exist for a rolled-back change
or be missing for a committed one.

`audit_logs` is append-only: triggers reject `UPDATE` and `DELETE`, and the
application role has been granted neither. See
[Business rules](../database/business-rules.md#audit-immutability).

Authorization failures are logged too, with the principal and the required
permission. A spike in 403s is a signal; an audit log that only records successes
cannot show it.

## Threat model

| Threat                                | Control                                                       |
| ------------------------------------- | ------------------------------------------------------------- |
| Forged request body role              | `requireRole()` reads `principal.roleCode`, never the body    |
| Guessing another member's id          | Gate 4 predicate; 404 not 403                                 |
| Horizontal privilege escalation       | `_OWN` grants plus Gate 4; role-level grants only             |
| Vertical privilege escalation         | Deny by default; `ROLE_UPDATE` is ADMIN-only                  |
| Cross-branch access                   | Gate 3 predicate in the query                                 |
| IDOR on a nested resource             | Ownership travels through the relation path (`loan.memberId`) |
| Staff user with no member record      | `ownMemberFilter` returns an always-false predicate           |
| Leaking existence via status code     | 404 for both "not yours" and "not there"                      |
| Frontend tampering                    | Backend enforces; guards are UX only                          |
| Stale permission after role change    | Permissions resolved from the database per request            |
| Session revoked but token still valid | Session checked against the database on every request         |
| Privilege via a filter parameter      | `assertRequestedBranchAllowed()` on list filters              |

## Related

- [Authentication](./authentication.md) — Gate 1
- [Role matrix](./role-matrix.md) — who holds what
- [Permission matrix](./permission-matrix.md) — the 80 permissions
- [Business rules](../database/business-rules.md#access-control-invariants) — A1–A6
- [Security architecture](../security/security-architecture.md) — the wider model
