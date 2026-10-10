# Deployment

Environments, the build, migrations, and the production topology.

## Environments

|                    | Development      | CI                              | Production                    |
| ------------------ | ---------------- | ------------------------------- | ----------------------------- |
| `NODE_ENV`         | `development`    | `test`                          | `production`                  |
| Database           | Local PostgreSQL | Ephemeral PostgreSQL 16 service | Managed PostgreSQL            |
| Cookies            | `Secure: false`  | n/a                             | **`Secure: true` — enforced** |
| Seed data          | `db:seed`        | `db:seed`                       | **never**                     |
| Source             | Working tree     | Committed                       | Committed, tagged image       |
| CSRF / rate limits | enforced         | limits disabled                 | enforced                      |

### Production never seeds

`npm run db:seed` is never run in production. It creates the three system roles,
the permission registry, and a bootstrap administrator — which is exactly the
wrong thing to run unattended against a real database.

The bootstrap administrator is created deliberately, once, with a password
supplied through the deployment secret store. Tracked in
[Roadmap](../roadmap.md) as a pending bootstrap path.

## The build

```
packages/shared  →  apps/backend  →  apps/frontend
      ↓                  ↓                 ↓
   tsc build        tsc + prisma      tsc + vite build
```

The order is not incidental. `shared` holds the types both apps import, and
`backend` produces the generated Prisma client the frontend's API types reference.
Building the frontend before the backend produces type errors that have nothing
to do with the frontend.

`npm run build` at the root runs all three in order.

### Per-package scripts

| Script                      | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `npm run build`             | Build shared → backend → frontend              |
| `npm run typecheck`         | `tsc --noEmit` in every workspace              |
| `npm run lint`              | ESLint in every workspace                      |
| `npm test`                  | Vitest in every workspace                      |
| `npm run format:check`      | Prettier **and** `prisma validate`             |
| `npm run format`            | Rewrite formatted files                        |
| `npm run db:migrate`        | Create and apply a migration (development)     |
| `npm run db:migrate:deploy` | Apply existing migrations only (production)    |
| `npm run db:seed`           | Idempotent seed                                |
| `npm run db:validate`       | Validate `schema.prisma`                       |
| `npm run db:drift`          | Diff migrations against a shadow database      |
| `npm run db:invariants`     | Assert the integrity objects exist             |
| `npm run db:deploy`         | `migrate deploy` **plus** invariant assertions |
| `npm run openapi`           | Regenerate `openapi.json`                      |
| `npm run openapi:check`     | Fail if the committed OpenAPI is stale         |

`format:check` running `db:validate` is deliberate: a malformed schema should
fail the formatting gate, because it is the same class of problem — the committed
schema must match what the code expects.

## Migrations

Two phases, and the distinction matters.

**Development** uses `prisma migrate dev`, which generates a migration from the
diff between `schema.prisma` and the database, and may reset. Convenient, and
destructive.

**Production** uses `prisma migrate deploy`, which applies existing migrations and
**never** generates or resets anything. A migration that does not exist cannot be
applied, so a deploy fails rather than guessing.

The rule: **generate a migration in development, review the SQL, commit it, then
deploy.**

### Constraints are added, never dropped

A migration may add a `CHECK` constraint, a partial unique index, or a trigger.
It may not drop one, and it may not weaken one — because the invariant it encodes
is load-bearing for data already written.

`20260101000100_invariants` is the example: it adds constraints, partial unique
indexes, append-only triggers, GIN and trigram indexes, and the `REVOKE`
statements, all as an additive step after the base schema.

### `scripts/deploy.ts` — migrate, then verify

`npm run db:deploy` does not stop at "the migrations applied". It then asserts
that the integrity objects exist:

- every named `CHECK` constraint,
- every partial unique index,
- the append-only triggers,
- the `REVOKE` grants on `lms_app`.

`apps/backend/scripts/invariant-checks.sql` contains the assertions.

**Why this is not paranoia.** A restore from a backup taken before the invariants
migration, or a database where a DBA has manually adjusted grants, would otherwise
deploy successfully and run with weaker guarantees than the code assumes. The
assertions turn a silent posture regression into a failed deploy.

## Production topology

Managed, not self-hosted. A library cannot be the operator of its own database.

```
            ┌────────────────────────────┐
            │  CDN / edge (TLS, WAF)     │
            └──────────────┬─────────────┘
                           │ HTTPS
            ┌──────────────▼─────────────┐
            │  Static host — SPA assets   │   versioned, immutable, cached
            │  (CDN, not the API host)    │
            └──────────────┬─────────────┘
                           │ /api
            ┌──────────────▼─────────────┐
            │  API service ×N            │   containers, stateless
            │  /health  /ready           │
            └───────┬──────────────┬─────┘
                    │              │
        ┌───────────▼───┐   ┌──────▼─────────────┐
        │ PostgreSQL    │   │ Object storage      │
        │ managed,      │   │ digital resources   │
        │ private,      │   │ signed URLs         │
        │ automated     │   └─────────────────────┘
        │ backups, PITR │
        └───────────────┘
```

| Component      | Choice                 | Why                                                                             |
| -------------- | ---------------------- | ------------------------------------------------------------------------------- |
| Frontend       | Static host + CDN      | It is static files. Serving it from the API wastes capacity and couples deploys |
| Backend        | Container platform     | Stateless, so replicas are trivial and rolling deploys are free                 |
| Database       | Managed PostgreSQL 16  | Backups, PITR, and failover are the operator's job, not the library's           |
| Object storage | S3-compatible, private | Digital resources; signed URLs only                                             |
| Redis          | Optional               | Correct without it                                                              |
| TLS            | At the edge            | Termination, with HSTS from the app as well                                     |

### The backend must be stateless

No in-memory session, no local file upload, no sticky session requirement. The
refresh cookie path is `/api/v1/auth` and the CSRF cookie is `/`, both host-only,
so a load balancer needs no affinity. `trust proxy 1` means every replica must
see the same proxy depth — an asymmetry between replicas produces inconsistent
`req.ip` values, which changes which rate-limit bucket a request lands in.

### Secrets

Injected from a secret manager at deploy time. Never in the image, never in the
repository, never in a build argument — a build argument is visible in the image
history.

`.env` is git-ignored. `.env.example` documents every variable with no values.

## Deployment sequence

```
1.  Build the image from the tagged commit
2.  Run db:deploy        migrate deploy + assert invariants
3.  Start the new replica
4.  Wait for /ready      200, database reachable, migrations applied
5.  Shift traffic
6.  Stop the old replica
7.  Observe error rate and latency before declaring success
```

**Migrations before traffic, never during.** An expand-and-contract migration is
required for any change that would lock a large table: add the new column,
deploy code that writes both, backfill, deploy code that reads only the new
column, then drop the old one in a later release.

Step 4 is not optional. `/ready` reports `503` when the database is unreachable
or the migration history is missing, so an un-migrated replica never receives
traffic.

## Graceful shutdown

`server.ts` handles `SIGTERM`: stop accepting new connections, let in-flight
requests finish, close the Prisma pool, exit.

The drain window must exceed the longest request the system makes. Killing a
replica mid-transaction rolls that transaction back — correct, but it surfaces to
a librarian as a failed request they will retry.

## Health and readiness

| Probe         | Question                             | Checks                                        |
| ------------- | ------------------------------------ | --------------------------------------------- |
| `GET /health` | Is this process running?             | Nothing. Never touches the database.          |
| `GET /ready`  | Should this process receive traffic? | Database reachable; migration history present |

They are separate because conflating them causes a real outage: a transient
database blip would fail the liveness probe and the platform would restart every
replica, turning a recoverable database problem into a full restart storm.

`/health` also returns `status`, `uptimeSeconds`, `environment`, and `version`,
which is what a deployment gate asserts against.

Both are unauthenticated, are excluded from the rate limiter, and sit outside
`/api/v1` so a probe never depends on the API version.

## Rollback

**Code rollback is safe. Migration rollback is not.**

Prisma migrations are forward-only — there is no `down`. Rolling back the code
must therefore always be compatible with the schema that is already applied,
which is what expand-and-contract is for.

The recovery path when a migration is wrong is a new migration that corrects it,
not a revert. If a migration has already modified production data destructively,
that is a restore from backup — see
[Backup and recovery](./backup-and-recovery.md).

## Pre-deploy checklist

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass
- [ ] `npm run format:check` passes (includes `prisma validate`)
- [ ] `npm run openapi:check` passes — the committed document is current
- [ ] `npm run db:drift` clean — migrations match the schema
- [ ] Migrations reviewed: additive only, no dropped constraints
- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` differ, ≥ 32 characters
- [ ] `ACCESS_TOKEN_TTL` ≤ 60 minutes
- [ ] `COOKIE_SECURE=true`
- [ ] `FRONTEND_URL` is `https://` and not `*`
- [ ] `DATABASE_URL` uses `lms_app`, not a superuser
- [ ] Database not publicly reachable
- [ ] Backups configured **and a restore rehearsed**
- [ ] `/health` and `/ready` wired to the platform
