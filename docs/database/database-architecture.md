# Database Architecture

Source of truth: `apps/backend/prisma/schema.prisma`.
Migrations: `apps/backend/prisma/migrations/`.
DBML (dbdiagram.io): [`schema.dbml`](./schema.dbml).

## Design decisions and why they were made

### PostgreSQL + Prisma, not an ORM that guesses

The system holds money, circulation state, and audit history. Every rule that
matters must be enforceable by the database, not only by application code, because
application code can be skipped — by a second API instance, a migration job, a
support engineer with `psql`, or a future feature written by someone who did not
read the docs. Prisma is used because it gives typed queries without hand-rolled
SQL, and because it makes the _intent_ of each table explicit in one reviewable
file. Anything Prisma cannot express goes into
`migrations/20260101000100_invariants/migration.sql`, and a CI check plus a
deploy-time assertion keep that file honest.

### UUID primary keys everywhere

`gen_random_uuid()` (pgcrypto), not sequences. Reasons, in order of importance:

1. **Creation-site independence.** A loan, a fine, a copy and an audit row are
   created on different machines. Sequential IDs invite the assumption that a
   lower ID was created first, and that assumption breaks under concurrency,
   replication lag, and log shipping.
2. **Not enumerable.** A predictable `id` means `/api/v1/members/1042` is a
   walkable directory of every member. UUIDs remove the enumeration surface even
   for a bug that forgets an ownership check. This is defence in depth, not a
   substitute for the check.
3. **Merge-safe.** Offline clients can mint a UUID before a row is ever written,
   which the V2 sync queue depends on (`sync_operations.id` is client-generated
   for exactly this reason — a replayed operation collapses onto one row).

`BigInt` autoincrement is used for the three append-only ledgers
(`copy_status_history`, `loan_status_history`, `audit_logs`) because nothing
joins to them and they grow without bound; a monotonic key is cheaper to index
and makes chronological order inherent.

### `timestamptz` for every instant, plus a library timezone

The instant a loan was issued is an instant (`timestamptz`). Whether a member is
overdue is a **calendar-day** question in the library's timezone. Conflating them
produces a bug that is correct for 21 hours a day and wrong for 3. `lib/dates.ts`
exists solely to keep these apart; see [Business rules](./business-rules.md).

### Money is `Decimal(14,2)` and crosses the wire as a string

No `float`, no `real`, no `double precision`, anywhere near a currency value.
Internally `Prisma.Decimal`; on the wire a fixed 2dp string (`"200.50"`), because
JSON numbers are IEEE-754 doubles and cannot represent `0.01`. The client parses
once, explicitly. `lib/money.ts` routes every conversion through a string so no
intermediate float is ever constructed.

### Deletion behaviour is chosen per relationship, never defaulted

| Behaviour  | Where                                                                                                                                                                                                              | Why                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CASCADE`  | purely ephemeral children: `role_permissions`, `user_branches`, `sessions`, reset/verification tokens, `book_authors`, `book_categories`, `book_tags`, `notifications`, `sync_operations`                          | They have no meaning once the parent is gone, and keeping them would be a leak, not history.                                                           |
| `RESTRICT` | anything with evidentiary or financial weight: `books`←copies/loans/reservations, `members`←loans/fines, `loans`←renewals/fines/payments, `audit_logs`←actor, `authors`←book_authors, `categories`←parent/children | A payment must never be able to lose its loan. A book must never be deleted out from under its loans.                                                  |
| `SET NULL` | attribution that is informational once the person is gone: `audit_logs.actor_id`, `fine.waived_by`, `book.created_by`, `loan.returned_by`, `settings.updated_by`                                                   | Keep the record, drop the dangling FK. Snapshotted strings (`actor_email`, `actor_role`) mean audit history stays readable even after the row is gone. |

### Book and BookCopy are separate entities

`books` is the intellectual work; `book_copies` is a physical item. One row with
a `copy_count` integer cannot answer "which copy is at MAIN-03-117", cannot hold
per-copy condition or damage history, and makes "lost copy" indistinguishable from
"lost book". They are never merged.

### Reservations target a title, not a copy

A hold says "I want _Clean Code_". The specific copy is assigned only when the
hold becomes `READY`. Binding to a copy up front is wrong because the copy a
member expects can be lost, transferred, or already on loan by the time the hold
is served — and a system that must "repair" such a hold has a bug.

### Status and condition are orthogonal on a copy

`status` is circulation state (`AVAILABLE`, `BORROWED`, `LOST`, `DAMAGED`,
`MAINTENANCE`, `REMOVED`). `condition` is physical state (`NEW` … `DAMAGED`).
A copy can be `AVAILABLE` + `POOR`. Collapsing them loses the ability to lend a
poor-condition book while still tracking that it needs attention.

### Policy lives in `member_types`, configuration in `settings`

Every borrowing limit, duration, renewal cap, grace period, fine rate and hold
duration is a column on `member_types` — never an `if` in a controller. `settings`
holds library-level configuration (name, contact, default policy, job schedule)
as typed JSON so it can change without a deploy.

Loans snapshot `member_type_id` so a later policy edit cannot rewrite the meaning
of history. The fine assessed today records the rate that applied today, in the
fine's own columns.

### Soft delete for anything a person can see

`users`, `members`, `books` carry `deleted_at`; books additionally carry
`archived_at`/`archived_reason`. Circulation and finance rows are never deleted at
all — they move to a terminal status (`RETURNED`, `PAID`, `VOID`, `FULFILLED`,
`EXPIRED`). Deleting a loan would delete the fact that a fine was owed.

### Append-only where the record is evidence

`audit_logs`, `loan_status_history`, `copy_status_history` are protected by a
`BEFORE UPDATE OR DELETE` trigger that raises, and the application role is
further `REVOKE`d those privileges. Two mechanisms, because a trigger owned by
the same role that writes the rows is one dropped statement away from being
useless.

### Denormalisation that earns its place

- `loans.book_id` — reachable from `copy.book_id`, but "most borrowed books"
  becomes `(book_id, loaned_at)` index scan instead of a three-table join. At
  10⁵ copies and years of loans this is the difference between a report that
  loads and one that times out.
- `loans.member_type_id` — the policy snapshot described above.
- `audit_logs.actor_email` / `actor_role` — survives user deletion.

There is no denormalised count anywhere. Availability is computed by aggregation
over `book_copies`, or maintained by a `book_inventory` projection introduced
only if measurement shows the aggregation is too slow.

## Table inventory

36 tables in 7 groups. Nothing exists without a stated reason; the full
column-by-column reference is in [Tables](./tables.md).

### Identity & access (8)

`roles`, `permissions`, `role_permissions`, `users`, `user_branches`, `sessions`,
`password_reset_tokens`, `email_verification_tokens`

### Organisation (4)

`libraries`, `branches`, `locations`, `shelves`

### Membership (2)

`member_types`, `members`

### Catalogue (8)

`publishers`, `authors`, `categories`, `tags`, `books`, `book_authors`,
`book_categories`, `book_tags`

### Inventory (2)

`book_copies`, `copy_status_history`

### Circulation (4)

`loans`, `loan_status_history`, `loan_renewals`, `reservations`

### Finance (2)

`fines`, `fine_payments`

### Platform (6)

`notifications`, `audit_logs`, `settings`, `digital_resources`, `digital_loans`,
`sync_operations`

## Forward-compatibility, deliberately bounded

- **Multi-tenancy.** `libraries` is a single row in V1 and the root of the
  organisation hierarchy. A future `organization_id` is an additive column plus
  a scope predicate; no table needs reshaping. Multi-tenancy is _not_ implemented
  now — it would multiply every query and every index for a requirement nobody
  has stated.
- **Offline sync.** `sync_operations` exists with its full state machine now, so
  the client/server contract is settled before any device writes to it. No client
  code ships against it in V1.
- **Digital library.** `digital_resources` + `digital_loans` exist because the
  security requirements differ from physical copies (entitlement, signed URLs) and
  retrofitting them onto `book_copies` later would be a rewrite.
- **New permissions.** Adding a permission is an `INSERT` plus a seed run. No
  migration, no engine change.

## Migrations

- Development: `prisma migrate dev` (may reset — never against anything real).
- Production: `npm run db:deploy`, which runs `prisma migrate deploy` and then
  **asserts the invariants are present**. A migration that exits 0 while having
  silently done nothing is the failure mode that matters, so the deploy gate
  checks `pg_indexes`, `pg_extension`, and `_prisma_migrations` by name.
- `prisma db push` is never used for production.
- `npm run db:drift` replays migrations into a throwaway shadow database and
  diffs against the datamodel, turning "someone edited the schema without a
  migration" into a CI failure. Its scope limit is documented in the script:
  Prisma cannot see CHECK constraints, partial indexes, or triggers, so those are
  covered by the database tests instead.

## Scaling posture

Target: 10⁴ books, 10⁵ copies, 5·10⁴ members, thousands of daily transactions.

| Concern          | Approach                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read volume      | Index-backed pagination everywhere; no query returns an unbounded set.                                                                                                                                                 |
| Write contention | Circulation writes touch one copy row; row locks plus partial unique indexes serialise correctly at any replica count.                                                                                                 |
| Reporting        | Reads run against indexes built for the access pattern (`idx_loans_open_due_date`, `idx_fines_member_status_assessed`). Heavy analytics get a replica or a summary table introduced on measurement, not pre-emptively. |
| Audit growth     | `audit_logs` is append-only and grows forever; partition by month once it exceeds ~50M rows. Documented, not built.                                                                                                    |
| Search           | PostgreSQL trigram + `tsvector` GIN indexes cover the V1 catalogue. Elasticsearch is not introduced unless measurement justifies it.                                                                                   |

Connection pooling is `DATABASE_URL` (pooled, possibly PgBouncer) versus
`DIRECT_URL` (direct, for migrations that need DDL). Prisma cannot run DDL
through a transaction-pooler.
