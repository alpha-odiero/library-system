# Requirements

The scope this architecture answers to, and the reasoning behind the choices that
are not obvious from the schema.

## Who it serves

A multi-branch library platform: schools, universities, public and community
libraries, research institutions, private collections, and multi-branch
organisations. The deployment unit is a **library** containing **branches**; V1
runs one library with any number of branches.

## The governing principle

> Users should only see and access what they are explicitly authorized to see and
> access.

**Deny by default.** Every requirement below is subordinate to this. The
consequences are concrete and repeated throughout the codebase:

| Decision                                                                 | Consequence                                                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend hiding is never a security control                              | A hidden nav item is a UX affordance. The backend still rejects the call.                                                                                    |
| Authorization is a **filter**, not a filter-after-fetch                  | `WHERE member_id = $1` in the same statement, never "fetch all, then compare". This is simultaneously the security control and the performance optimisation. |
| Every protected route requires authentication                            | No route is public because nobody added a guard; it is public only if it is on an explicit allowlist.                                                        |
| Every protected operation requires a permission                          | Absence of a grant is a denial, not an implicit allow.                                                                                                       |
| 401 means _unauthenticated_; 403 means _authenticated but not permitted_ | Never the other way round, and never one code for both.                                                                                                      |

See [Authorization](./authorization/authorization.md) for the four-gate model and
[Role matrix](./authorization/role-matrix.md) for the grants.

## Scale targets

The architecture is sized for the following, and every design decision that
affects them is traceable to one of them:

| Dimension       | Target                                                       |
| --------------- | ------------------------------------------------------------ |
| Titles          | 10,000+                                                      |
| Physical copies | 100,000+                                                     |
| Members         | 50,000+                                                      |
| Branches        | 10+                                                          |
| Transactions    | Thousands per day, with genuine concurrent scanning          |
| Retention       | Loans, fines, payments, and audit logs retained indefinitely |

Consequences: UUID keys over sequences (creation-site independence, no
enumerable ids), index-backed pagination everywhere (no unbounded query), row
leveling plus partial unique indexes for correctness under concurrency, and
append-only history rather than deletion.

## Functional scope

### Identity and access

Authentication: login, logout, logout-everywhere, password change, password
reset by email, optional email verification, session listing and per-session
revocation, refresh token rotation with reuse detection, account lockout after
repeated failures.

Passwords are hashed with **Argon2id** at the OWASP baseline (19 MiB, t=2, p=1).
Plaintext passwords are never stored, logged, or returned.

Users are `ADMIN`, `LIBRARIAN`, or `MEMBER` in V1, with statuses `ACTIVE`,
`INACTIVE`, `SUSPENDED`, `LOCKED`. The architecture is data-driven: a new role is
a row plus a permission grant, and a new permission is a row plus a seed run —
neither requires a code change.

### Membership

Members carry a membership number, member type, home branch, contact details,
address, status (`ACTIVE`/`INACTIVE`/`SUSPENDED`/`EXPIRED`/`PENDING`), join date,
and expiry date. A member is **not** the same thing as a user: a user is an
account that can sign in; a member is library participation. Staff are users
without member records.

Member types carry the borrowing policy — maximum active loans, loan duration,
renewal limit and duration, grace period, daily fine rate, fine cap, reservation
limit, hold duration. **These are columns, not code.** A `STUDENT` type with 5
loans for 14 days and a `PUBLIC` type with 3 for 7 are data, tunable by an
administrator without a deployment.

### Organisation

`Library → Branch → Location → Shelf → BookCopy`. Users and members are attached
to branches; staff additionally carry an explicit branch assignment, which is the
scope boundary for multi-branch librarians.

### Catalogue

A **book** is the intellectual work; a **book copy** is a physical item. They are
never merged — a single `copy_count` column cannot answer which copy is at
`MAIN-03-117`, cannot hold per-copy condition, and makes "lost copy"
indistinguishable from "lost book".

Books carry ISBN-10 and ISBN-13 (validated by checksum, stored canonically so the
same title cannot be entered twice), title, subtitle, description, edition,
language, publication year and date, page count, publisher, categories, authors,
tags, subjects, cover image, call number, and acquisition metadata.

Authors, publishers and categories are separate entities. A book has many authors
and an author has many books (true many-to-many via `book_authors`). Categories
nest.

### Inventory and identification

Each copy carries an accession number, a barcode, an independent QR token, branch,
location, shelf, condition, acquisition details, replacement cost, and status
(`AVAILABLE`, `BORROWED`, `RESERVED`, `LOST`, `DAMAGED`, `MAINTENANCE`,
`REMOVED`).

**Status and condition are orthogonal.** Status is circulation state; condition is
physical state. A copy can be `AVAILABLE` + `POOR` — lendable, but flagged for
attention.

Barcodes and QR codes identify both copies and members. QR tokens are opaque and
independently generated, so a QR payload is not derivable from a sequential
accession number.

### Circulation

Borrow, return, renew, reserve, mark lost, mark damaged. Every one of these is a
database transaction. The book lifecycle is `AVAILABLE → RESERVED → BORROWED →
OVERDUE → RETURNED`, with exceptional terminal states `LOST` and `DAMAGED`.

Overdue is a **calendar-day** question in the library's timezone, never a UTC
field read. "14 days" means 14 calendar days in the library's zone.

Renewal rules: capped by member type, cannot renew an overdue loan, cannot renew
if another member holds a live reservation, cannot renew a lost or damaged loan.
Every renewal is recorded in an append-only ledger with `(loan_id, renewal_number)`
uniqueness, so the renewal count cannot be raced.

Reservations target a **title**, not a copy. The specific copy is assigned only
when the hold becomes `READY`, because the copy a member expects can be lost,
transferred, or already on loan by the time the hold is served. Statuses:
`ACTIVE`, `READY`, `FULFILLED`, `CANCELLED`, `EXPIRED`. A member cannot hold two
live reservations on one title.

### Finance

Fines arise from overdue loans, loss, and damage. They support adjustment, partial
payment, full payment, waiver (with a mandatory reason), receipt numbering,
payment references, and attribution to the staff member who took the payment.
Payment methods: `CASH`, `MPESA`, `BANK`, `CARD`, `OTHER`.

**Money is `Decimal(14,2)` and crosses the wire as a string.** No floating point
anywhere near a currency value. JSON numbers are IEEE-754 doubles and cannot
represent `0.01`.

Payments are append-only. A void is recorded as columns on the same row, never as
a deletion, so the money trail is always reconstructable.

### Notifications

In-app notifications: due soon, overdue, reservation ready, fine created, payment
recorded, book returned, general, system. Carrying title, message, type, read
state, read timestamp, and a deep-link payload.

Email, SMS, and push are **providers**, not schema changes. `notification.channel`
already carries `IN_APP`; the others are added by registering a provider.

### Reporting and analytics

Dashboards per role, with the backend sending only the data that role may see:
totals for titles, copies, availability, active and overdue loans, members,
reservations, outstanding fines, fine collection, lost and damaged copies, recent
activity. Analytics: most borrowed titles, most active members, popular
categories, monthly loans and returns, overdue and fine trends, member growth.

Filters by date, branch, category, author, member type, and status. Export to
CSV, Excel, and PDF. Reports are never exposed to a caller without
`REPORT_VIEW`; financial reports additionally require `REPORT_VIEW_FINANCIAL`.

### Search

Search is **database-backed**: trigram and full-text GIN indexes cover titles,
subtitles, authors, subjects, barcodes, and accession numbers. Nothing fetches
thousands of rows into JavaScript and filters there.

Barcode and accession search is deliberately typo-tolerant, because handheld
scanners are imprecise. A consequence: a scan can return near-misses, so a scan
lookup must resolve to exactly one copy before any state change.

### Digital resources

Private object storage for PDF/EPUB previews. Only a storage key is persisted,
never a public URL. Access is authorized and served via short-lived signed URLs
(`SIGNED_URL_TTL_SECONDS`). Digital files must not become public by accident.

### Audit

Every security- and business-relevant action is recorded: login, logout, failed
login, password change and reset, catalogue create/update/archive, copy creation
and status change, member create/update/delete, loan created/returned/renewed/
marked lost/damaged, reservation lifecycle, fine created/updated/paid/waived,
payment voided, user created/updated/deactivated, role and permission changed,
settings updated, digital access, and report exports.

Audit records carry actor, action, entity, entity id, description, timestamp, IP,
user agent, request id, and before/after state. They are **append-only**,
enforced by a database trigger and by revoking `UPDATE`/`DELETE` from the
application role.

### Settings

Library-level configuration as typed JSON: name, contact details, default loan
duration, loan ceiling, fine rate, grace period, hold duration, renewal limit,
reservation ceiling, borrowing block threshold, membership validity, and job
schedules. Only administrators may change them.

Structural limits (maximum page size, body size, absolute fine ceiling) are
**not** settings — they are hard constants in `config/constants.ts` that cannot be
loosened through the UI.

## Non-functional requirements

**Security.** Argon2id; RBAC with granular permissions; resource-level ownership
checks enforced as query predicates; branch scope; input validation on body, query
and params; rate limiting including a tighter auth limiter; Helmet; explicit CORS
allowlist; HttpOnly cookies; CSRF double-submit on state-changing requests;
refresh rotation with reuse detection; session revocation; audit logging; database
constraints; transactions.

Explicitly prohibited: storing plaintext passwords, trusting frontend roles or
permissions, returning password hashes, exposing secrets, committing `.env`,
exposing database errors, unrestricted production CORS, arbitrary role
assignment, and unauthorized object access.

**Scalability.** Index-backed pagination on every collection. Selective field
projection. No N+1 in a list projection. No denormalised counters unless
measurement justifies them. Redis is optional and introduced only where a
measurable benefit exists — the system runs correctly without it.

**Maintainability.** Thin controllers; business logic in services; data access in
repositories; validation schemas per module. Controllers must not contain a
business rule.

**Testability.** Pure logic (dates, money, ISBN, pagination) is unit-testable with
no database. Authorization is testable as a matrix. Concurrency is testable with
two real connections.

**Accessibility.** Semantic HTML, keyboard navigation, labelled forms, visible
focus, screen-reader-friendly status announcements, WCAG AA contrast, and status
never communicated by colour alone.

**Responsiveness.** Desktop, laptop, tablet, and phone. Staff circulation —
scan member, scan book, borrow, return, renew, search — is prioritised for touch.

**Observability.** Structured JSON logs with a request id on every line.
Health (`/health`) and readiness (`/ready`) probes. No secrets or tokens in logs.

## Explicitly deferred

Named now so their absence is a decision, not a gap:

| Capability                 | Decision                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline circulation writes | Table and state machine exist; no client ships against it in V1. See [Offline strategy](./pwa/offline-strategy.md).                                                             |
| Multi-tenancy              | `libraries` is the hierarchy root so an `organization_id` is additive later. Not implemented now — it would multiply every query and index for a requirement nobody has stated. |
| Real-time push             | Socket.IO/WebSockets are a transport choice. Notifications are already persisted and pollable; the transport can change without a schema change.                                |
| AI features                | Extension points only. Recommendations and smart search must never be a dependency of core circulation.                                                                         |
| Elasticsearch              | PostgreSQL trigram + `tsvector` cover the V1 catalogue. Revisit on measurement.                                                                                                 |

## Traceability

| Requirement group       | Design                                                                                                                     | Implementation                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Deny by default         | [Authorization](./authorization/authorization.md)                                                                          | `middleware/authenticate.ts`, `middleware/authorize.ts` |
| Ownership               | [Ownership model](./authorization/authorization.md#gate-4--ownership)                                                      | `middleware/ownership.ts`                               |
| Branch scope            | [Authorization](./authorization/authorization.md#gate-3--branch-scope)                                                     | `middleware/scope.ts`                                   |
| Policy as data          | [Business rules](./database/business-rules.md)                                                                             | `member_types` columns, `settings` rows                 |
| Concurrency             | [Transactions and concurrency](./security/transactions-and-concurrency.md)                                                 | partial unique indexes in `20260101000100_invariants`   |
| Money integrity         | [Database architecture](./database/database-architecture.md)                                                               | `Decimal(14,2)`, `lib/money.ts`                         |
| Calendar-day arithmetic | [Business rules](./database/business-rules.md#dates-and-time)                                                              | `lib/dates.ts`                                          |
| History retention       | [Database architecture](./database/database-architecture.md#deletion-behaviour-is-chosen-per-relationship-never-defaulted) | `RESTRICT` FKs, append-only triggers, `REVOKE DELETE`   |
| Catalogue integrity     | [Constraints and indexes](./database/constraints-and-indexes.md)                                                           | `lib/isbn.ts`                                           |
