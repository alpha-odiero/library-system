# Database Constraints and Indexes

Two enforcement layers, both load-bearing:

1. **Prisma schema** (`prisma/schema.prisma`) — models, types, relations,
   ordinary unique constraints and indexes.
2. **Invariants migration** (`prisma/migrations/20260101000100_invariants/migration.sql`)
   — everything Prisma cannot express: partial unique indexes, CHECK constraints,
   append-only triggers, trigram and full-text GIN indexes, runtime grants.

Layer 2 is verified after every deploy (`scripts/deploy.ts`) and covered by the
database test suite. The deploy gate exists because `prisma migrate deploy` exits
`0` even for SQL that silently did nothing.

---

## §A — CHECK constraints

Money and state invariants. Application validation gives good errors; these
guarantee the rule even when the writer is not the API.

| Name                            | Table           | Rule                                                                          | Why                                                                                                                            |
| ------------------------------- | --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ck_fines_non_negative`         | `fines`         | `amount >= 0 AND waived_amount >= 0 AND waived_amount <= amount`              | A waiver can never exceed the assessment, and a fine can never be negative.                                                    |
| `ck_payment_positive`           | `fine_payments` | `amount > 0`                                                                  | Voiding uses `voided_at`, never a negative row.                                                                                |
| `ck_copy_prices_non_negative`   | `book_copies`   | both prices `NULL` or `>= 0`                                                  | A negative purchase price is a data-entry error that would corrupt any acquisition-cost report.                                |
| `ck_member_type_policy`         | `member_types`  | counters `>= 0`, durations `> 0`, `fine_per_day >= 0`, cap `NULL` or `>= 0`   | "Loan duration 0 days" would make every loan instantly overdue. Rejected at write time.                                        |
| `ck_loan_dates`                 | `loans`         | `due_date >= loaned_at`                                                       |                                                                                                                                |
| `ck_loan_return_after_issue`    | `loans`         | `returned_at IS NULL OR returned_at >= loaned_at`                             |                                                                                                                                |
| `ck_loan_renewal_count`         | `loans`         | `renewal_count >= 0`                                                          | Defence in depth: the ledger's unique constraint is the real guarantee; this stops a bad `UPDATE` desynchronising the counter. |
| `ck_renewal_extends_due_date`   | `loan_renewals` | `new_due_date > previous_due_date`                                            | A renewal that shortens a loan is a bug or an attack.                                                                          |
| `ck_member_dates`               | `members`       | `expires_at IS NULL OR expires_at >= joined_at`                               |                                                                                                                                |
| `ck_reservation_position`       | `reservations`  | `position > 0`                                                                | Queue positions are 1-based.                                                                                                   |
| `ck_payment_void_complete`      | `fine_payments` | `voided_at` and `voided_by` are both set or both null                         | A void must record who and when, atomically.                                                                                   |
| `ck_fine_waiver_complete`       | `fines`         | `waived_amount = 0 OR (waived_at IS NOT NULL AND waiver_reason IS NOT NULL)`  | A waived fine is always answerable in an audit.                                                                                |
| `ck_copy_removal_complete`      | `book_copies`   | `removed_at IS NULL OR removed_reason IS NOT NULL`                            | Withdrawing stock requires a reason.                                                                                           |
| `ck_reservation_ready_complete` | `reservations`  | `status <> 'READY' OR (ready_at IS NOT NULL AND hold_expires_at IS NOT NULL)` | A ready hold must have a notification instant and a deadline.                                                                  |
| `ck_session_dates`              | `sessions`      | `expires_at > issued_at`                                                      |                                                                                                                                |

---

## §B — Partial UNIQUE indexes: the concurrency guarantees

These are non-bypassable. Even if a service forgets its business check, the
database refuses the write.

| Name                                           | Table             | Predicate                                                                                        | Prevents                                                                               |
| ---------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `uq_loan_one_open_per_copy`                    | `loans`           | `(copy_id) WHERE status IN ('ACTIVE','OVERDUE')`                                                 | **Double-borrowing.** Two librarians scanning COPY-001: exactly one succeeds.          |
| `uq_reservation_one_open_per_member_book`      | `reservations`    | `(member_id, book_id) WHERE status IN ('ACTIVE','READY')`                                        | Duplicate active holds on the same title.                                              |
| `uq_digital_loan_one_open_per_member_resource` | `digital_loans`   | `(member_id, resource_id) WHERE returned_at IS NULL`                                             | Duplicate concurrent entitlements.                                                     |
| `uq_fine_one_overdue_per_loan`                 | `fines`           | `(loan_id) WHERE loan_id IS NOT NULL AND type IN ('OVERDUE','LATE_RETURN') AND status <> 'VOID'` | The overdue sweep assessing the same fine twice on a retry or a double-triggered cron. |
| `uq_book_one_primary_category`                 | `book_categories` | `(book_id) WHERE is_primary = true`                                                              | Two "primary" classifications.                                                         |
| `uq_reservation_position_live`                 | `reservations`    | `(book_id, position) WHERE status IN ('ACTIVE','READY')`                                         | Two concurrent "next in queue" computations claiming the same slot.                    |

### Note on `fines.loan_id`

It is **not** globally unique. A loan legitimately carries many manual
`DAMAGE`/`OTHER` fines across its lifetime; a global unique on `loan_id` would
silently cap a loan at one fine and make a second damage charge impossible. The
guarantee actually wanted — one automated overdue assessment per loan — is a
partial unique index instead.

---

## §C — Append-only immutability

```sql
CREATE OR REPLACE FUNCTION raise_immutable_violation() RETURNS TRIGGER …
  RAISE EXCEPTION 'Table "%" is append-only: % is not permitted. …'
```

Triggers: `audit_logs_no_update_delete`, `loan_status_history_no_update_delete`,
`copy_status_history_no_update_delete`.

Two independent mechanisms, deliberately:

- The **trigger** makes it a database property for every role, including a
  superuser with direct table access.
- The **grant revocation** (§E) removes the privileges from the application role,
  so the app cannot even attempt the operation.

A trigger owned by the same role that writes the rows is one dropped statement
away from being useless. Relying on either alone would leave a gap.

---

## §D — Search and reporting indexes

Search is database-backed. Nothing fetches thousands of rows into JavaScript and
filters there.

| Name                               | Definition                                                                       | Serves                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `idx_book_copies_barcode_trgm`     | GIN `(barcode gin_trgm_ops)`                                                     | Scanner-tolerant barcode lookup                                  |
| `idx_book_copies_accession_trgm`   | GIN `(accession_number gin_trgm_ops)`                                            | Scanner-tolerant accession lookup                                |
| `idx_books_title_trgm`             | GIN `(title gin_trgm_ops)`                                                       | Typo-tolerant title search                                       |
| `idx_books_subtitle_trgm`          | GIN `(subtitle gin_trgm_ops)`                                                    |                                                                  |
| `idx_books_fulltext`               | GIN over `setweight(tsvector(title),'A') \|\| (subtitle,'B') \|\| (summary,'C')` | Ranked catalogue search; `simple` config so accented names match |
| `idx_authors_fulltext`             | GIN over `tsvector(name \|\| sort_name)`                                         | Author search                                                    |
| `idx_books_subjects_gin`           | GIN `(subjects)`                                                                 | Subject-heading lookup on the array                              |
| `idx_books_title_lower`            | B-tree `(lower(title) text_pattern_ops)`                                         | Prefix / case-insensitive title match                            |
| `idx_fines_member_status_assessed` | `(member_id, status, assessed_at)`                                               | Outstanding balance per member; revenue over time                |
| `idx_loans_open_due_date`          | `(due_date, grace_until) WHERE status IN ('ACTIVE','OVERDUE')`                   | Overdue sweep touches only open loans                            |
| `idx_reservations_ready_hold`      | `(hold_expires_at) WHERE status = 'READY'`                                       | Hold-expiry sweep                                                |

**Extensions.** `pg_trgm` and `unaccent` are created _inside the migration_, so
`prisma migrate deploy` works against a managed PostgreSQL instance where no
bootstrap script runs. Both ship in `pg_catalog` on every supported provider, so
it is a no-op there. The deploy gate asserts both exist.

### A note on trigram indexes and authorization

Trigram indexes make barcode and title search fast and typo-tolerant. They also
mean a search can legitimately return **near-misses**. Two consequences:

1. A barcode search must resolve to exactly one copy before any state change. A
   partial read of "the copy that looks like COPY-001" is not a copy.
2. Search results are still authorization-scoped. A branch-scoped librarian's
   catalogue search returns only copies in their branches, and the scope
   predicate is part of the same query as the `WHERE` clause — never a post-filter.

---

## §E — Runtime grants

Applied when the application role `lms_app` exists (a no-op locally and in CI):

```sql
REVOKE UPDATE, DELETE ON audit_logs, loan_status_history, copy_status_history FROM lms_app;
REVOKE DELETE ON loans, fines, fine_payments FROM lms_app;
```

This encodes the historical-data rule at the privilege level: the application
**cannot** delete a loan, a fine, or a payment, even if a future service tries to.
Circulation and finance rows move to terminal states; they are never removed.

---

## Index design notes

- **Composite index order follows the query.** `(member_id, status)` serves both
  "my active loans" and the borrowing-limit count. `(book_id, status)` and
  `(branch_id, status)` are the two availability aggregations.
- **Every foreign key that is filtered on has an index.** Prisma does not create
  these automatically for every relation, and an unindexed FK is a sequential
  scan on every join and every `RESTRICT` check.
- **Soft-delete columns are indexed** (`users.deleted_at`, `members.deleted_at`,
  `books.archived_at`) because every list query filters on them.
- **Deterministic pagination.** Sort fields are allowlisted per resource and every
  sort gets a stable tie-breaker, because rows either side of a page boundary
  will otherwise swap between requests and a member sees duplicates.
- **No index on `low`-cardinality booleans alone.** `is_active` and `status` are
  indexed where they lead a composite with a selective column.

## Growth and maintenance

| Threshold                           | Action                                                              |
| ----------------------------------- | ------------------------------------------------------------------- |
| `audit_logs` > ~50M rows            | Partition by month. Append-only, so it is a mechanical operation.   |
| Any table > ~50M rows               | Review index bloat; `REINDEX CONCURRENTLY` in a maintenance window. |
| Trigram indexes write amplification | Accepted: catalogue writes are low-volume, and reads dominate.      |

Autovacuum settings follow PostgreSQL defaults. The audit table's append-only
pattern produces dead tuples from long-running report queries; if autovacuum
becomes the bottleneck it is tuned per environment, not in the schema.
