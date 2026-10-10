# CI/CD

The pipeline, what each gate proves, and the release sequence.

## Pipeline

`.github/workflows/ci.yml`. Triggered on pushes to `main` and on every pull
request.

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

A newer push makes the in-flight run irrelevant, so it is cancelled rather than
left to finish. Without this, a rapid sequence of pushes queues runs that nobody
will read.

```yaml
permissions:
  contents: read
```

Read-only by default. A CI job that can write to the repository is a credential
worth stealing.

Three jobs run in parallel, and the split is by what each needs rather than by
speed:

| Job        | Needs a database | Proves                                                                    |
| ---------- | :--------------: | ------------------------------------------------------------------------- |
| `verify`   |        no        | Lint, types, tests, formatting, schema validity, OpenAPI freshness, build |
| `database` |     **yes**      | Migration SQL is valid, invariants hold, the seed is idempotent, no drift |
| `security` |        no        | No high-severity dependency advisory                                      |

## `verify` — lint, types, tests, build

```yaml
- uses: actions/setup-node@v4
  with:
    node-version-file: .nvmrc
    cache: npm

- run: npm ci
```

**`npm ci`, not `npm install`.** `ci` installs exactly the lockfile and fails on an
out-of-sync one. `install` may resolve versions afresh, so CI can pass on
different code than local — and the failure surfaces on a maintainer's machine
instead of in review.

`.nvmrc` pins the Node version, so CI and local cannot diverge.

| Step       | Command                 | Catches                                               |
| ---------- | ----------------------- | ----------------------------------------------------- |
| Lint       | `npm run lint`          | Style, unused code, unsafe patterns                   |
| Typecheck  | `npm run typecheck`     | Type errors, including across workspace boundaries    |
| Unit tests | `npm test`              | Logic regressions                                     |
| Formatting | `npm run format:check`  | Prettier **and** `prisma validate`                    |
| Schema     | `npm run db:validate`   | A malformed `schema.prisma`                           |
| OpenAPI    | `npm run openapi:check` | A stale committed API document                        |
| Build      | `npm run build`         | Anything the compiler permits but the bundler rejects |

The build step supplies `DATABASE_URL` and `DIRECT_URL` pointing at localhost:

```yaml
# `prisma generate` runs inside the build and needs a syntactically
# valid URL, but never connects. No live database is required here.
```

That comment matters: without it, the next reader adds a database service to a job
that does not need one.

**`npm run format:check` also runs `db:validate`.** A malformed schema fails the
formatting gate because it is the same class of problem — a committed artefact
that does not match what the code expects.

## `database` — migrations and invariants

The only job that can prove the migration SQL is valid, and the only one that can
prove a partial unique index actually rejects a double borrow.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    options: >-
      --health-cmd "pg_isready -U lms -d lms"
      --health-interval 5s
      --health-timeout 5s
      --health-retries 20
```

A health-gated service container. Without `--health-cmd`, the first migration can
race PostgreSQL's own startup and fail on a connection error that is not a real
defect.

### Steps

| Step                        | Command                                 | Proves                                                 |
| --------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Deploy migrations           | `npm run db:deploy`                     | The SQL executes **and** the integrity objects exist   |
| Seed is idempotent          | `db:seed` twice                         | A restart cannot create duplicate roles or permissions |
| Migrations and schema agree | `npm run db:drift`                      | The migrations produce exactly `schema.prisma`         |
| Integration tests           | `npm run test --workspace @lms/backend` | Module behaviour against a real database               |

### Each step earns its place

**`db:deploy`, not `db:migrate`.** The deploy script applies migrations and then
asserts every `CHECK` constraint, partial unique index, append-only trigger, and
`REVOKE` exists. A migration that creates a table without its integrity objects
fails here — which is precisely the failure that would otherwise ship and be
discovered under concurrent load.

**Seed run twice.** A seed that is not idempotent is a bug that only appears on a
restart or a redeploy: duplicate roles, duplicate permissions, and an ambiguous
grant. Running it twice in CI is the cheapest possible test of that.

**`db:drift`.** Migrations and `schema.prisma` can disagree. Drift means someone
edited the schema without a migration, so a fresh database differs from the
production one. This is the step that catches it.

**Two databases.** Migrations run against `lms`; tests run against `lms_test`.
The migrated database stays clean, so a test cannot leave the migration state
dirty and make the next run non-deterministic.

## `security` — dependency audit

```yaml
# `npm audit` fails the build on any vulnerability at any severity.
# Deliberately not `|| true`: a high-severity advisory in a library that
# parses untrusted input is a release blocker, not a warning.
- run: npm audit --audit-level=high
```

**The comment exists because someone will be tempted to add `|| true`.** An audit
failure in a library that parses untrusted input is a release blocker. Silencing
it to make a pipeline green trades a real risk for a cosmetic pass.

When a genuine high-severity advisory blocks an urgent fix, the correct action is
to bump the dependency, verify the tests pass, and record why — not to weaken the
gate.

## Gate summary

A pull request merges when all three jobs pass:

```
verify    lint · typecheck · tests · format · schema · openapi · build
database  migrate · invariants · idempotent seed · no drift · integration
security  no high-severity advisory
```

Each proves something the others cannot:

| Question                                             | Answered by |
| ---------------------------------------------------- | ----------- |
| Is the code correct and consistent?                  | `verify`    |
| Does the schema deploy, and do the guarantees exist? | `database`  |
| Is a dependency a known risk?                        | `security`  |

## Local parity

Every CI step runs locally with the same commands:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run format:check
npm run db:validate
npm run openapi:check
npm run build

# requires PostgreSQL
npm run db:deploy --workspace @lms/backend
npm run db:drift
npm run test --workspace @lms/backend
npm audit --audit-level=high
```

A local PostgreSQL instance is required before the database checks run; there is
no separate container bootstrap step in the repo. Redis is optional for the app
itself and is not required for the core workflow.

A test that only fails in CI is usually a test that depends on ordering or on a
stale local database. If it happens, fix the test rather than re-running until it
passes.

## Release sequence

```
1.  Merge to main                    → CI runs on the push
2.  Build the image from the commit  → immutable tag
3.  npm run db:deploy                → migrate, then assert invariants
4.  Start the new replica            → drain old traffic
5.  Wait for /ready                  → 200: database reachable, migrations applied
6.  Shift traffic
7.  Observe                          → error rate and latency before declaring success
```

Detailed in [Deployment](../operations/deployment.md#deployment-sequence).

**Code rollback is safe; migration rollback is not.** Prisma migrations are
forward-only, so rolling back the code must always be compatible with the schema
already applied. That is what expand-and-contract migrations are for.

## Deployment triggers

**Manual and gated.** There is no `deploy.yml`, and no CD workflow.

For a system holding membership records, fines, payments, and an audit trail, an
automatic deploy on merge removes the human who should be deciding whether the
change is safe for a database. Merging is a code decision; deploying is an
operations decision.

Automation is planned, in this order:

1. Build the image on merge to `main` — safe, reversible, no production effect.
2. Publish to a staging environment with the production migration path.
3. Require an explicit, audited approval to promote to production.

The audit log makes step 3 meaningful: who promoted, and when, is answerable.

## Branch strategy

Trunk-based. `main` is always releasable.

Feature branches, short-lived, reviewed. The gate for merging is CI passing, and
the reviewer's job is correctness and design — the pipeline covers what a machine
can judge.

Direct pushes to `main` are blocked except for the initial commit and by an
administrator override.

## Secrets in CI

CI needs no production secrets. Test values are fixed, deterministic strings in
`vitest.config.ts`, and the database job uses throwaway credentials scoped to an
ephemeral service container.

**Nothing that reaches production is needed to run the pipeline.** A pipeline
that cannot run without production credentials is a pipeline where a compromise
escalates to production.

## Known gaps

| Gap                                    | Consequence                                   | Status                                                                                       |
| -------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| No image build in CI                   | No proof the image builds                     | Planned                                                                                      |
| No coverage reporting to a service     | Trends are local only                         | Planned                                                                                      |
| No integration-test database isolation | Tests may interfere                           | See [Testing strategy](./testing-strategy.md#isolation)                                      |
| `security` uses `npm audit` only       | No SAST, no secret scanning, no licence check | Planned                                                                                      |
| No dependency update automation        | Upgrades are manual                           | Deliberate — updates are reviewed                                                            |
| No preview environment per PR          | Reviewers cannot exercise a change            | Planned                                                                                      |
| **Prisma config is deprecated**        | A Prisma 7 upgrade breaks the toolchain       | Every Prisma command warns about `package.json#prisma`. Migrate to `prisma.config.ts` first. |

Recorded in [Roadmap](../roadmap.md).

## Related

- [Testing strategy](./testing-strategy.md) — what the gates run
- [Deployment](../operations/deployment.md) — the release sequence
- [Security architecture](../security/security-architecture.md#dependency-and-supply-chain)
