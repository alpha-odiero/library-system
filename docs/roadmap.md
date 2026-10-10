# Development Roadmap

What exists, what is next, and why it is in that order.

## Where the system is

| Layer            | State                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Database schema  | **Complete** — 36 models, integrity constraints, partial unique indexes, append-only triggers, search indexes |
| Seed data        | **Complete** — permissions, roles, member types, admin, sample catalogue; idempotent                          |
| Shared contracts | **Complete** — permission registry, role grants, error codes, API types                                       |
| Auth             | **Complete** — login, registration, refresh with rotation and reuse detection, sessions, password lifecycle   |
| Members          | **Complete** — members, member types, borrowing policy                                                        |
| Settings         | **Partial** — public settings only, plus read-only branches to populate pickers and filters                   |
| Audit            | **Service only** — writes, no read routes                                                                     |
| Notifications    | **Service only** — creation, no routes                                                                        |
| API foundation   | **Complete** — envelopes, errors, validation, CSRF, rate limits, security headers, request ids                |
| Circulation      | **Not started**                                                                                               |
| Frontend         | **Foundation** — router, guards, auth and member screens; other modules wait on their APIs                    |
| PWA              | **Installable** — app shell, offline error page, two shortcuts that 404                                       |
| CI/CD            | **Complete** for the existing surface                                                                         |
| Observability    | **Logs and health** — no metrics                                                                              |
| Documentation    | **Complete** — this set                                                                                       |

The database and the authorization model are deliberately ahead of the
application. Both are expensive to change once data exists, and every module
inherits them, so building them first was the only ordering that would not have
to be redone.

## Phase A — foundations ✅

Schema, contracts, auth, members, API foundation, CI, documentation.

Verified on this repository: `npm run typecheck`, `npm run lint`, `npm test`
(24 + 232 + 18 passing), `npm run format:check`, `npm run db:validate`,
`npm run openapi:check`, and `npm run build` all pass. The CI `verify` job's
steps are green as committed.

## Phase B — catalogue and inventory

The first phase that produces visible value, and the prerequisite for
circulation: a loan needs a copy, and a copy needs a book.

| Order | Module                                                   | Why this order                          |
| ----- | -------------------------------------------------------- | --------------------------------------- |
| 1     | Organisation — libraries, branches, locations, shelves   | Everything else is scoped by branch     |
| 2     | Catalogue — books, authors, categories, publishers, tags | The intellectual work                   |
| 3     | Copies — inventory, barcodes, QR                         | Circulation cannot start without a copy |
| 4     | Search                                                   | Useless until there is a catalogue      |
| 5     | Users and roles — staff administration                   | Needed before real staff are onboarded  |

Books and copies stay separate throughout: a single `copy_count` column cannot
answer which copy is at `MAIN-03-117`, cannot carry per-copy condition, and makes
"lost copy" indistinguishable from "lost book".

ISBN validation is `lib/isbn.ts` already; the catalogue module is its first
consumer.

## Phase C — circulation

The only genuinely concurrent code in the system. It lands **after** both sides of
a loan exist and are stable, because it is the code most expensive to get wrong.

| Order | Module                       | Notes                                                                             |
| ----- | ---------------------------- | --------------------------------------------------------------------------------- |
| 1     | Loans — issue, return, renew | Every operation is a transaction; every constraint in the schema exists for these |
| 2     | Status history               | `loan_status_history`, `copy_status_history`                                      |
| 3     | Reservations                 | Queue positions, holds, fulfilment                                                |
| 4     | Fine assessment              | Automated on overdue; the daily job                                               |
| 5     | Scheduled jobs               | Overdue sweep, hold expiry, notification dispatch, session purge                  |

### The gates for this phase

This phase is the reason the constraints were built first. Before it is called
done:

- [ ] Every concurrency case in
      [Testing strategy](./engineering/testing-strategy.md#concurrency-tests)
      passes against a real database
- [ ] A loan, return, or renewal failure leaves **no** partial state
- [ ] The audit row is written in the same transaction as each action — tested,
      not assumed
- [ ] An overdue assessment never double-fines
- [ ] A reservation can never produce two members at queue position 1

## Phase D — finance

Fines are created in circulation; finance is what a member pays.

| Order | Module           | Notes                                                             |
| ----- | ---------------- | ----------------------------------------------------------------- |
| 1     | Payments         | Append-only, voided not deleted, receipt numbering                |
| 2     | Waivers          | Mandatory actor and reason, enforced by `ck_fine_waiver_complete` |
| 3     | Online payment   | Gated, separate from staff-recorded payments                      |
| 4     | Idempotency keys | See below                                                         |

**Money is `Decimal(14,2)` and crosses the wire as a string.** There is no float
anywhere near a currency value.

### Idempotency keys

A member tapping "Pay" twice must not create two payments. Requires an
`Idempotency-Key` header, a recorded operation, and a stored result returned on a
repeat.

Needed before real payments are taken, not after the first duplicate charge.

## Phase E — frontend

The shell exists; nothing is built on it yet.

| Order | Work                                                                   |
| ----- | ---------------------------------------------------------------------- |
| 1     | Router, `RequireAuth` and `RequirePermission` guards, app shell layout |
| 2     | Authentication screens — login, register, forgot/reset, verify email   |
| 3     | Member and catalogue browsing                                          |
| 4     | **Circulation desk** — scan member, scan book, borrow, return, renew   |
| 5     | Reservations and holds                                                 |
| 6     | Fines and payments                                                     |
| 7     | Administration — users, roles, member types, settings, audit           |

Step 4 is the highest-value screen in the system: a librarian doing scan-issue-scan-return
is the workflow the whole platform exists for, and it is where the transaction and
authorization guarantees become visible.

### Frontend gaps still open

- **PWA manifest shortcuts point to `/catalogue` and `/loans`, which do not
  exist.** The router is mounted now, so both land on the in-app 404 page rather
  than a blank shell — still a promise the launcher cannot keep. Fixed when those
  routes land.
- **`orientation: portrait-primary`** is wrong for circulation desks. Tablets are
  frequently mounted in landscape. Left as a product decision rather than changed
  unilaterally.
- **No end-to-end harness, and no component tests.** `test:e2e` was removed rather
  than left as a command that cannot run. There is still no
  `@testing-library/react` and no `axe-core`, so the guards, the permission-driven
  navigation, and the forms remain unproven end to end. Both belong at step 1.
- **No PNG icons**, including `apple-touch-icon`, which iOS does not render.

### Where the frontend stands

| Present                       |                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/api.ts`              | Typed client: envelopes, `ApiError`/`NetworkError`, CSRF header on unsafe methods, timeout + abort composition, `cache: 'no-store'`, `isPaginated`, single-flight refresh-and-retry |
| `src/lib/api.test.ts`         | 25 tests over credentials, CSRF, error handling, transport failure, pagination narrowing, and session recovery                                                                      |
| `src/lib/format.ts` + tests   | Money, calendar-date, instant, and relative-date helpers, with the conventions that are easy to break                                                                               |
| `src/routes/`                 | `react-router-dom` route tree, `RequireAuth`, `RequirePermission`, 403 and 404 pages, centralised paths                                                                             |
| `src/contexts/`               | `AuthContext` (session bootstrap, sign-in/out, `can()`), `ToastContext` for action feedback                                                                                         |
| `src/components/`             | Layout shells, mobile drawer, and UI primitives: button, card, badge, fields, dialog, confirm dialog, states, pagination, responsive table                                          |
| `src/features/auth/`          | Login, register, forgot, reset, verify, and profile/session management                                                                                                              |
| `src/features/members/`       | List with search, status filter, and pagination; create, detail, edit, archive; member-type list, create, and deactivate                                                            |
| `src/features/branches/`      | Read-only branch options for pickers and filters, backed by `GET /api/v1/branches`                                                                                                  |
| `src/features/dashboard/`     | Role-aware dashboard using `/members/me` and public settings                                                                                                                        |
| `src/styles.css`              | Design tokens, light/dark, focus-visible ring, reduced-motion guard, responsive layout                                                                                              |
| `public/sw.js`                | App-shell-only service worker; `/api/**` never cached                                                                                                                               |
| `public/manifest.webmanifest` | Installability, maskable icon, two (currently dead) shortcuts                                                                                                                       |

| Absent           |                                                                                   |
| ---------------- | --------------------------------------------------------------------------------- |
| Feature coverage | Only auth, members, member types, and branches; every other page waits on its API |
| Component tests  | No `@testing-library/react`, no `axe-core`                                        |
| E2E              | No harness, no CI job                                                             |
| PNG icons        | SVG only, including `apple-touch-icon`, which iOS does not render                 |

## Phase F — reporting

Last among the backend, because every report reads tables that must already be
correct.

| Work                    | Notes                                                          |
| ----------------------- | -------------------------------------------------------------- |
| Dashboards              | Role-specific; only data that role may see                     |
| Analytics               | Most borrowed, most active members, popular categories, trends |
| Export                  | CSV, Excel, PDF                                                |
| `REPORT_VIEW_FINANCIAL` | Separate from `REPORT_VIEW`; no non-admin role holds it        |

Export is the most expensive read path in the system and has its own rate-limit
tier.

## Phase G — operations

| Work                | Priority                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| Production topology | Managed PostgreSQL, container backend, static frontend, private object storage |
| Backup automation   | PITR + snapshots + **a rehearsed restore**                                     |
| Metrics             | Latency percentiles, saturation, error rate                                    |
| Alerting            | Only what is actionable at 3 a.m.                                              |
| Error tracking      | `SENTRY_DSN`                                                                   |
| Staging environment | Migrations proven before production                                            |
| Image build in CI   | So a broken image is found before release                                      |

**A restore drill is a deliverable, not an aspiration.** An untested backup is a
hypothesis. See [Backup and recovery](./operations/backup-and-recovery.md).

## Named gaps

Collected here so each is a decision rather than an oversight.

| Gap                                               | Impact                                                        | Status                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rate limits are per process**                   | Behind N replicas an attacker gets N× the budget              | Accepted for V1; Argon2 cost is the real control. Fix with a shared store when a multi-instance deployment makes it material.                                        |
| **Password denylist is 23 entries**               | A production deployment should load a breach corpus           | `isCommonPassword()` is synchronous and offline by design; a boot-loaded corpus is additive                                                                          |
| **No metrics pipeline**                           | Percentile latency is hard to answer                          | Logs and `audit_logs` cover the important questions today                                                                                                            |
| **Integration tests lack DB isolation**           | Tests may interfere with each other                           | CI separates `lms` and `lms_test`; per-suite rollback still to add                                                                                                   |
| **No admin bootstrap in production**              | The first administrator must be created deliberately, by hand | Must be a documented, audited procedure before a real deployment                                                                                                     |
| **OpenAPI covers only `/health` and `/ready`**    | The generated contract is incomplete                          | Deliberate; a partial document reads as complete                                                                                                                     |
| **PWA icons are SVG only**                        | Some older Android launchers and MDM policies need PNG        | Fallbacks to add with the frontend                                                                                                                                   |
| **`MEMBER_VIEW_OTHERS` is granted to no role**    | A future support-agent role would need it                     | Intentional — a member resolves via `/auth/me`                                                                                                                       |
| **No SAST or secret scanning in CI**              | A vulnerability in our own code would be found late           | `npm audit` covers dependencies only                                                                                                                                 |
| **No preview environment per PR**                 | Reviewers cannot exercise a change                            | Planned                                                                                                                                                              |
| **No image build in CI**                          | A broken image is found at release time                       | Planned                                                                                                                                                              |
| **Prisma config is still `package.json#prisma`**  | A Prisma 7 upgrade breaks the toolchain                       | Every Prisma command warns today. Migrate to `prisma.config.ts` before upgrading.                                                                                    |
| **`openapi.json` can drift from the error codes** | A committed contract can be stale                             | It happened once already — `MEMBER_HAS_ACTIVE_LOANS` was added to the shared registry without regenerating. `openapi:check` in CI is the only thing that catches it. |

## Deliberately deferred

Named in [Requirements](./requirements.md#explicitly-deferred) with the reasons.
Summarised:

| Capability                     | Why deferred                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Offline circulation writes** | Replays are _detectable_ rather than harmless, but the conflict-resolution policy is undecided and payments must never be queued. The schema and constraints are ready; the client is not. |
| **Multi-tenancy**              | `libraries` is the hierarchy root, so `organization_id` is additive. It would otherwise multiply every query and index for a requirement nobody has stated.                                |
| **Real-time push**             | Notifications are already persisted and pollable, so the transport is an implementation detail rather than a schema change.                                                                |
| **AI features**                | Extension points only. Recommendations must never become a dependency of circulation.                                                                                                      |
| **Elasticsearch**              | PostgreSQL trigram + `tsvector` cover the V1 catalogue. Revisit on measurement.                                                                                                            |
| **Redis as a dependency**      | Every optional use has an in-process fallback, so absence degrades performance rather than correctness.                                                                                    |

## Sequencing principle

**Foundation → visibility → transactions → money → read models.**

Each phase makes the previous one usable and is independently valuable. A loan
without a fine is a working library; a report without a correct loan is a
confident wrong answer.

Circulation is deliberately late. It is the only code where two real people at
two terminals can race, and the only place where the constraints written in Phase A
either hold or do not. Landing it before the catalogue is stable would mean
writing it twice.

## Related

- [Architecture](./architecture.md) — the module map and its status
- [Requirements](./requirements.md) — scope and deferrals
- [Endpoint map](./api/endpoint-map.md) — what is implemented versus planned
