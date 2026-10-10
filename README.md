# Library Management System

A multi-branch library platform: catalogue, circulation, membership, finance, and
reporting, with an installable PWA.

> **Users should only see and access what they are explicitly authorized to see
> and access.**

Every design decision below descends from that sentence. See
[Authorization](./docs/authorization/authorization.md).

## Status

The foundation is complete. The application is not.

|                    |                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Database**       | 36 models, integrity constraints, partial unique indexes, append-only triggers, search indexes        |
| **Authorization**  | 80 permissions, 3 roles, four gates, enforced by an executed test matrix                              |
| **Authentication** | Argon2id, rotating refresh tokens with reuse detection, sessions, revocation                          |
| **Modules live**   | `auth`, `members`, `member-types`, `settings` (public only), `system`                                 |
| **Circulation**    | Not started — the schema and constraints for it already exist                                         |
| **Frontend**       | Installable PWA shell; no feature routes yet                                                          |
| **Docs**           | Complete — see [docs/README.md](./docs/README.md)                                                     |
| **Gates**          | `lint` · `typecheck` · `test` · `format:check` · `db:validate` · `openapi:check` · `build` — all pass |

Every planned endpoint is listed in the [endpoint map](./docs/api/endpoint-map.md)
and marked as such. Nothing in this README describes functionality that does not
exist.

## Stack

|          |                                                               |
| -------- | ------------------------------------------------------------- |
| Frontend | React + TypeScript + Vite + plain CSS (design tokens)         |
| Backend  | Express · TypeScript · Zod · Pino                             |
| Database | PostgreSQL 16 · Prisma                                        |
| Auth     | Argon2id · JWT access tokens · opaque rotating refresh tokens |
| Runtime  | npm workspaces monorepo · Node (see `.nvmrc`)                 |
| Optional | Redis (correct without it) · S3-compatible storage · Sentry   |

## Quick start

```bash
# 1. Install (use `npm ci` in CI and for a reproducible install)
npm ci

# 2. Configure
cp .env.example .env      # then set JWT_SECRET and JWT_REFRESH_SECRET

# 3. Database
# Start local PostgreSQL 16 and Redis on localhost
npm run db:generate
npm run db:migrate
npm run db:seed

# 4. Run
npm run dev               # backend  → http://localhost:4000
npm run dev:frontend      # frontend → http://localhost:5173
```

### The two required secrets

`config/env.ts` validates the whole environment at startup and **fails rather
than defaulting**. Two values must be generated:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```bash
JWT_SECRET=<generated>
JWT_REFRESH_SECRET=<a different generated value>
```

They must be at least 32 characters and **must differ** — the process refuses to
start if they are equal.

### Seed data

`npm run db:seed` creates the three system roles, all 80 permissions and their
grants, member types with borrowing policies, a bootstrap administrator, and a
small sample catalogue. It is **idempotent**, which CI verifies by running it
twice.

Production never seeds — see [Deployment](./docs/operations/deployment.md).

## Commands

| Command                     | Purpose                                     |
| --------------------------- | ------------------------------------------- |
| `npm run dev`               | Backend in watch mode                       |
| `npm run dev:frontend`      | Frontend in watch mode                      |
| `npm run build`             | Build shared → backend → frontend, in order |
| `npm test`                  | Tests in every workspace                    |
| `npm run lint`              | ESLint                                      |
| `npm run typecheck`         | `tsc --noEmit`                              |
| `npm run format`            | Rewrite formatted files                     |
| `npm run format:check`      | Prettier **and** `prisma validate`          |
| `npm run db:migrate`        | Create and apply a migration (development)  |
| `npm run db:migrate:deploy` | Apply existing migrations only (production) |
| `npm run db:seed`           | Idempotent seed                             |
| `npm run db:validate`       | Validate the Prisma schema                  |
| `npm run db:drift`          | Diff migrations against a shadow database   |
| `npm run db:invariants`     | Assert the integrity objects exist          |
| `npm run db:deploy`         | Migrate **and** assert invariants           |
| `npm run db:studio`         | Prisma Studio                               |
| `npm run openapi`           | Regenerate `apps/backend/openapi.json`      |
| `npm run openapi:check`     | Fail if the committed OpenAPI is stale      |

## Repository layout

```
library-management/
├── apps/
│   ├── backend/            Express API — the security boundary
│   └── frontend/           React PWA
├── packages/
│   └── shared/             contracts only: permissions, roles, errors, types
├── docs/                   the documentation set
├── .github/workflows/      CI
├── .env.example
└── .nvmrc
```

`apps/` are deployable; `packages/` are not. Nothing in `packages/` may depend
on `apps/`, and both `apps/` depend on `packages/shared` — which is what makes
the permission registry a compile-time contract rather than a runtime agreement.

## Design principles

**The database is the source of truth.** Invariants that must hold under
concurrency are `CHECK` constraints and partial unique indexes, not service
checks. A rule enforced only in application code is bypassed by the next service,
the next migration, or a hand-run script.

**The backend is the security boundary.** The frontend hides what a user may not
do, so the interface is not misleading — but a hidden button is not a control, and
every gate is enforced server-side.

**Deny by default.** A route is protected unless it is explicitly declared
public. `security/route-manifest.test.ts` walks the mounted router and fails the
build if one is reachable unguarded.

**Policy is data.** Borrowing limits, loan durations, fine rates, and hold periods
are `member_types` columns, not code. An administrator can change them without a
deployment. Structural limits — page size, body size, absolute fine ceiling — are
constants that cannot be loosened through the settings page.

**Money is never a float.** `Decimal(14,2)` in the database, a string on the wire.

**Calendar days, not milliseconds.** Due dates and overdue counts are computed in
the library's timezone. `14 * 24 * 3600 * 1000` is not the same operation as 14
calendar days across a daylight-saving transition.

**History is append-only.** Audit logs and status history reject `UPDATE` and
`DELETE` at the database level, and the application role has been granted neither.
The right to erase history is a DBA privilege during an incident.

## Documentation

Start at **[docs/README.md](./docs/README.md)** — it indexes all 32 documents by
topic and by audience.

|                                                                |                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Requirements](./docs/requirements.md)                         | Scope, the governing principle, and what is deliberately deferred |
| [Architecture](./docs/architecture.md)                         | Monorepo, runtime topology, module map, layering rules            |
| [Authorization](./docs/authorization/authorization.md)         | The four gates                                                    |
| [Permission matrix](./docs/authorization/permission-matrix.md) | All 80 permissions and their grants                               |
| [Database](./docs/database/database-architecture.md)           | The datamodel                                                     |
| [Business rules](./docs/database/business-rules.md)            | Circulation, finance, and audit invariants                        |
| [API](./docs/api/api-architecture.md)                          | Conventions and the response envelope                             |
| [Endpoint map](./docs/api/endpoint-map.md)                     | Every endpoint, implemented and planned                           |
| [Testing](./docs/engineering/testing-strategy.md)              | What to test and why                                              |
| [Roadmap](./docs/roadmap.md)                                   | What is next, and what is deferred                                |

## Contributing

1. Branch from `main`.
2. Make the change, with tests.
3. Run the full local gate:

   ```bash
   npm run lint && npm run typecheck && npm test && npm run format:check
   ```

4. Open a pull request. CI must pass: `verify`, `database`, and `security`.

The full gate is green on this repository: `lint`, `typecheck`, `test`,
`format:check`, `db:validate`, `openapi:check`, and `build` all pass. If one of
them fails on a clean checkout, the change introduced it.

**Before adding an endpoint**, read
[Adding an endpoint](./docs/api/endpoint-map.md#adding-an-endpoint). The guards go
**on the route**, and the route-manifest test will fail if they do not.

## Security

Report a vulnerability privately rather than opening a public issue.

Before deploying, work through the checklist in
[Security architecture](./docs/security/security-architecture.md#security-checklist)
and [Deployment](./docs/operations/deployment.md#pre-deploy-checklist).

## License

See `LICENSE`.
