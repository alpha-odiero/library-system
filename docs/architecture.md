# System Architecture

Repository layout, runtime topology, and the layering rules that keep the
database the source of truth and the backend the security boundary.

## Repository shape: npm workspaces monorepo

```
library-management/
├── apps/
│   ├── backend/          Express + TypeScript API (the security boundary)
│   └── frontend/         React + TypeScript + Vite PWA (the user experience)
├── packages/
│   └── shared/           contracts both sides compile against
├── docs/                 this documentation set
├── .github/workflows/    CI
├── .env.example
└── package.json          workspace root
```

### Why a monorepo, and why _this_ monorepo

**One repository.** The permission registry, the error-code contract, and the API
response shapes are the three things that must never disagree between client and
server. In a monorepo they are one file that both TypeScript projects import, and
a mismatch is a **compile error**. Across repositories it is a runtime bug
discovered by a user.

**npm workspaces, not a framework.** No Turborepo/Nx/Lerna. Three packages and a
build script that orders them (`shared` → `backend` → `frontend`) do not justify
a build orchestrator. The root `package.json` is the orchestrator.

**`packages/shared` is contracts only, and that boundary is strict.** It contains
the permission registry, the role→permission mapping, the error-code taxonomy and
status mapping, and the API envelope types. It contains **no logic and no
dependency on Prisma, Express, or React**. A contract package that imports the
framework it describes stops being a contract and becomes a coupling.

### Why `apps/` and `packages/`

`apps/` are deployable units. `packages/` are not. That distinction is the whole
point of the split: nothing in `packages/` may depend on `apps/`, and both
`apps/` depend on `packages/`. The dependency graph is a DAG with no cycles,
which is what makes the build order in the root `build` script well-defined.

## Runtime topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser / installed PWA                                            │
│  React SPA · service worker (app shell only) · permission-gated nav  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ HTTPS, JSON over /api/v1
                            │ cookies (HttpOnly, SameSite=Lax, Secure)
                            │ CSRF double-submit header
┌───────────────────────────▼─────────────────────────────────────────┐
│  CDN / reverse proxy  (nginx or platform edge)                      │
│  TLS termination · static assets · /api → backend                   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  Express application (@lms/backend)                                 │
│                                                                     │
│  requestId → helmet → cors → logging → compression → body →         │
│  rateLimit → /health /ready → /api/v1 → notFound → errorHandler     │
│                                                                     │
│  Gate 1 authenticate  → Gate 2 permission  → Gate 3 branch scope     │
│                                    → Gate 4 ownership (in the query) │
│                                                                     │
│  routes → controllers (thin) → services (rules) → repositories (SQL) │
└───────┬─────────────────────────────────────────────┬───────────────┘
        │                                             │
┌───────▼──────────────────┐              ┌───────────▼──────────────┐
│ PostgreSQL 16            │              │ Redis (optional)         │
│ source of truth          │              │ rate limits, cache       │
│ constraints + triggers   │              │ absent ⇒ system is       │
│ partial unique indexes   │              │ correct, just slower     │
└──────────────────────────┘              └──────────────────────────┘
```

**Redis is optional and the system is correct without it.** Every use has an
in-process fallback. This is deliberate: an absent cache must degrade performance,
never correctness. Introducing Redis where a measurable benefit does not yet
exist is the kind of complexity that costs more in incidents than it returns in
milliseconds.

**Same-origin is the target deployment.** The frontend is served behind a proxy
that forwards `/api` to the backend, so cookies are first-party and `SameSite`
does the real work. The cross-origin configuration (explicit `FRONTEND_URL`
allowlist, credentialed CORS) exists for split-host development and for
platforms that cannot proxy.

## Layering rules

```
routes/       declare the HTTP shape and attach guards
controllers   parse the request, call one service, shape the response
services      business rules, transactions, authorization predicates
repositories  Prisma queries only — no rules, no transactions
```

Four rules, each with a failure it prevents:

1. **Controllers are thin.** A controller that decides whether a member may borrow
   is a rule that no other caller can reuse, and no test can exercise without HTTP.
   A controller's whole job is: read validated input → call a service → shape a
   response.

2. **Services own transaction boundaries; repositories never open one.** Two
   repositories composing a transaction would have to pass a transaction handle
   between layers, and the layer boundary would become conditional.

3. **Repositories contain no business rules.** A `WHERE` clause built in a
   repository is a _scope_, and scopes are assembled by services from the
   principal.

4. **Authorization predicates are composed by services, from helpers in
   `middleware/`.** The helpers live in `middleware/` because that is where the
   gate model is documented, but they are called from services because that is
   where the query is built. A service that forgets is caught by the security
   tests; see [Authorization](./authorization/authorization.md).

## Module architecture

A module is a vertical slice: one resource, owning its routes, controller,
service, repository, schemas, and types.

```
src/modules/<module>/
  <module>.routes.ts        guards attached here — the authorization surface
  <module>.controller.ts    request → service → response
  <module>.service.ts       business rules + transactions
  <module>.repository.ts    Prisma queries
  <module>.schemas.ts       Zod: body, query, params
```

Modules never import each other's repositories. Cross-module collaboration goes
through services, which keeps the dependency graph inside `modules/` a DAG and
means a module can be deleted or extracted without archaeology.

### The module map

| Module                                            | Status       | Owns                                                     |
| ------------------------------------------------- | ------------ | -------------------------------------------------------- |
| `auth`                                            | implemented  | login, logout, refresh, password, sessions, registration |
| `members`                                         | implemented  | members, member types                                    |
| `settings`                                        | partial      | public settings; admin settings pending the admin module |
| `notifications`                                   | service only | creation; routes pending                                 |
| `audit`                                           | service only | write path; read routes pending                          |
| `system`                                          | implemented  | `/health`, `/ready`                                      |
| `users`                                           | planned      | user administration, staff directory                     |
| `roles`                                           | planned      | role + permission administration                         |
| `libraries` / `branches` / `locations`            | planned      | organisation hierarchy                                   |
| `books` / `authors` / `categories` / `publishers` | planned      | catalogue                                                |
| `copies`                                          | planned      | inventory, barcodes, QR                                  |
| `loans` / `renewals`                              | planned      | circulation                                              |
| `reservations`                                    | planned      | holds and waiting lists                                  |
| `fines` / `payments`                              | planned      | finance                                                  |
| `reports`                                         | planned      | dashboards, analytics, export                            |

Status is tracked honestly in [Roadmap](./roadmap.md). `settings` is marked
partial rather than done because only the public slice exists: the administrative
endpoints are deliberately absent rather than ungated.

### Ordering rationale

The delivery order is not by importance, it is by **dependency and risk**:

1. **Identity first.** Nothing can be authorized before identity exists, and every
   later module inherits `requireAuth()`.
2. **Membership before catalogue.** Loans need a member on one side and a copy on
   the other; a member with no books is testable, the reverse is not.
3. **Catalogue and inventory before circulation.** Circulation is the only
   transactional, concurrency-critical code in the system. It lands once both
   sides of a loan exist and are stable.
4. **Finance after circulation.** A fine is a consequence of a loan. Building
   finance first means inventing a model for a loan that does not exist yet.
5. **Reports last among the backend.** Every report is a read over tables that
   must already be correct.

## Backend folder structure

```
apps/backend/
├── prisma/
│   ├── schema.prisma                   36 models — the datamodel
│   ├── migrations/
│   │   ├── 20260101000000_init/        schema
│   │   └── 20260101000100_invariants/  CHECK, partial unique, triggers, GIN
│   ├── seed.ts                         orchestrator (idempotent)
│   └── seed/                           permissions, users, member-types, catalog
├── scripts/
│   ├── deploy.ts                       migrate deploy + assert invariants
│   ├── check-migration-drift.ts        shadow DB diff
│   └── generate-openapi.ts             OpenAPI document + freshness check
├── tests/
│   ├── authorization.test.ts           the permission matrix, executed
│   ├── members.test.ts                 module integration
│   ├── credentials.test.ts             password/credential policy
│   ├── app.test.ts                     error envelope, health, limits
│   ├── helpers.ts, setup.ts
│   └── security/route-manifest.test.ts every route is guarded
├── src/
│   ├── config/
│   │   ├── env.ts                      Zod-validated env, fail-fast
│   │   ├── database.ts                 Prisma lifecycle, withTransaction
│   │   ├── constants.ts                hard limits, allowlists, denylists
│   │   ├── logger.ts, observability.ts
│   │   └── dotenv.ts
│   ├── middleware/
│   │   ├── request-id.ts               correlation
│   │   ├── helmet.ts, cors.ts          security headers, origin allowlist
│   │   ├── request-logger.ts           structured access log
│   │   ├── rate-limit.ts               global + auth limiters
│   │   ├── authenticate.ts             GATE 1
│   │   ├── authorize.ts                GATE 2 (+ Gate 3 wrapper)
│   │   ├── scope.ts                    GATE 3 predicates
│   │   ├── ownership.ts                GATE 4 predicates
│   │   ├── validate.ts                 Zod body/query/params
│   │   ├── csrf.ts                     double-submit
│   │   └── error-handler.ts            the only writer of a failure response
│   ├── modules/<module>/               vertical slices
│   ├── routes/
│   │   ├── system.routes.ts            /health, /ready
│   │   └── v1/index.ts                 the route manifest
│   ├── lib/                            pure, unit-testable helpers
│   │   ├── dates.ts                    calendar-day arithmetic
│   │   ├── money.ts                    Decimal ↔ string, never float
│   │   ├── isbn.ts                     checksum + canonicalisation
│   │   ├── pagination.ts, response.ts, errors.ts
│   │   ├── redact.ts, cookies.ts, async-handler.ts
│   ├── app.ts                          middleware assembly — order is a contract
│   └── server.ts                       process lifecycle, graceful shutdown
└── openapi.json                        generated; CI asserts it is current
```

Three structural decisions worth naming:

**`lib/` is pure.** `dates.ts`, `money.ts`, `isbn.ts`, `pagination.ts`, and
`redact.ts` have no database and no framework dependency. They are where the
subtle correctness lives — a timezone bug and a float bug are both invisible in a
diff and both expensive in production — so they are unit-tested exhaustively and
cheaply.

**`middleware/` owns the gate model.** The four gates are documented together and
enforced together. Splitting ownership checks into services while keeping the
model in middleware would make the model drift from its implementation.

**`config/constants.ts` is the ceiling.** Limits an administrator must not
exceed live here and nowhere else. Anything an administrator _should_ be able to
tune is a `member_types` column or a `settings` row. The distinction is what
stops "the settings page lets you set page size to 100,000" from ever shipping.

## Frontend folder structure

Feature-first, not type-first. Everything about a feature lives in one folder, so
a change to, say, loans touches one directory rather than four.

**Current layout.** The tree below is what `src/` holds today. `routes/` is the one
deviation from a pure feature-first split: the route table and the two guards are
cross-feature by nature, and putting them behind a feature boundary would mean
every feature importing the others to register itself.

```
apps/frontend/
├── public/
│   ├── manifest.webmanifest            installability
│   ├── sw.js                           app-shell-only service worker
│   ├── icon.svg, icon-maskable.svg
├── src/
│   ├── app/                            providers, router, bootstrap
│   ├── features/<feature>/             the unit of the UI
│   │   ├── routes.tsx                  routes + the permissions they need
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── api.ts                      typed calls, no URL strings
│   │   └── types.ts
│   ├── components/                     cross-feature primitives only
│   │   ├── ui/                         Button, Table, Dialog, Toast, Skeleton
│   │   └── layout/                     AppShell, Sidebar, TopBar
│   ├── routes/
│   │   └── guards.tsx                  <RequireAuth> <RequirePermission>
│   ├── lib/
│   │   └── api.ts                      envelope handling, CSRF, error mapping
│   ├── contexts/                       AuthContext, ToastContext
│   └── styles/
```

**Cross-feature code must earn its place in `components/`.** A component used by
one feature stays in that feature. Promoting it early creates a shared module
with one consumer, which then acquires requirements its single consumer does not
have.

### Route guards

Both guards exist, in `routes/guards.tsx`, and they landed before the first feature
route — a feature shipped without a guard is a feature reachable by an
unauthenticated user.

```tsx
<RequireAuth>
  {' '}
  // unauthenticated → /login
  <RequirePermission permission="SETTINGS_VIEW">
    {' '}
    // authenticated but not
    <SettingsPage /> // permitted → 403 page
  </RequirePermission>
</RequireAuth>
```

Authorization completes **before** protected content renders. The navigation is
built from the permission list, so a member is never shown a Settings link that
would 403 — but the backend still refuses the call, because a hidden link is not
a control. See [Authorization](./authorization/authorization.md#frontend-visibility-is-not-security).

### Permission gating in the client

Target design — `usePermissions()` does not exist yet. `GET /api/v1/auth/me` does,
and it is the source the hook will read.

```tsx
const { can } = usePermissions();
{
  can('LOAN_RENEW') && <Button onClick={renew}>Renew</Button>;
}
```

`can()` reads the permission array from `GET /api/v1/auth/me`. It is
convenience, not enforcement, and it is documented as such everywhere it appears.

## Design decisions and their reasons

| Decision                       | Reason                                                                                                    | Alternative rejected                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REST under `/api/v1`           | Cacheable, inspectable, no custom protocol to learn                                                       | GraphQL — one endpoint is attractive until authorization becomes per-field and the permission model must be reproduced in the resolver graph                  |
| Prisma + raw SQL migrations    | Typed queries without hand-rolled SQL; anything Prisma cannot express goes in a migration it does not own | An ORM that introspects the live database and generates DDL — that cannot express a partial unique index, so the concurrency guarantee would be unenforceable |
| Services own transactions      | One place to reason about atomicity                                                                       | Per-repository transactions — no way to compose two writes atomically                                                                                         |
| Argon2id, not bcrypt           | Memory-hard; OWASP baseline; resists GPU cracking                                                         | bcrypt — 72-byte input limit, GPU-friendly                                                                                                                    |
| SHA-256 for refresh tokens     | A 256-bit CSPRNG value has nothing to brute-force; Argon2 on a hot path adds latency and no security      | Storing the refresh token in plaintext — a database disclosure becomes a credential disclosure                                                                |
| UUID primary keys              | Creation-site independence, non-enumerable, client-mintable for offline sync                              | Sequences — invite "lower id was created first", which breaks under concurrency and replication lag                                                           |
| In-process rate limit fallback | Correctness must not depend on Redis                                                                      | Redis-only — an outage or a misconfiguration becomes an outage or a total auth failure                                                                        |
| Job scheduler in-process       | No new infrastructure for three cron jobs                                                                 | BullMQ — a queue for a daily overdue sweep is a premature dependency                                                                                          |

## Architecture quality check

Against the checklist in the master prompt:

| Check                              | Result                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Circular dependencies              | None. `packages/shared` depends on nothing; `apps/*` depend on it; modules never import each other's repositories.                                                                        |
| Duplicated entities                | None. `books`/`book_copies` deliberately distinct; `users`/`members` deliberately distinct.                                                                                               |
| Unnecessary tables                 | 36, each with a stated reason in [Tables](./database/tables.md). `libraries`, `digital_resources`, and `sync_operations` exist for stated forward-compatibility reasons and cost nothing. |
| Missing relationships / FKs        | None. Every joinable FK is declared and indexed.                                                                                                                                          |
| Missing indexes                    | None for any filtered or joined column. Rationale in [Constraints and indexes](./database/constraints-and-indexes.md).                                                                    |
| Insecure authorization assumptions | Four independent gates; deny-by-default enforced by an executed test over the real Express stack.                                                                                         |
| Frontend-only security             | No. Guards mirror the backend; the backend is the boundary and is tested as such.                                                                                                         |
| Financial floating point           | None. `Decimal(14,2)` throughout; wire format is a string.                                                                                                                                |
| Unsafe cascading deletes           | None. `RESTRICT` on everything financial, circulation, or evidentiary; `REVOKE DELETE` from the application role.                                                                         |
| Circulation race conditions        | Row locks for a friendly error, partial unique indexes for correctness. Tested with two real connections.                                                                                 |
| Unauthorized data exposure         | Ownership is a `WHERE` predicate in the same statement. Branch scope likewise.                                                                                                            |
| Missing auditability               | Every mutation writes an audit row inside the same transaction as the mutation.                                                                                                           |
| Impossible business rules          | `CHECK` constraints reject incoherent policy (loan duration 0, waiver exceeding the fine, renewal shortening a due date) at write time.                                                   |
