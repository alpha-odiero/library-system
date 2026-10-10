# Table Reference

Every table, its purpose, its important columns, its relationships, its deletion
behaviour, and its security considerations.

Conventions used throughout: **PK** primary key, **FK** foreign key, **UQ**
unique, ⬜ nullable, 🔒 sensitive.

---

## Identity & access

### `roles`

**Purpose.** Authorisation container. Three system roles ship in V1; more are
data, not code.

| Column                      | Type           | Notes                                                      |
| --------------------------- | -------------- | ---------------------------------------------------------- |
| `id`                        | uuid PK        |                                                            |
| `code`                      | varchar(50) UQ | `ADMIN` \| `LIBRARIAN` \| `MEMBER`. Stable, never renamed. |
| `name`                      | varchar(100)   |                                                            |
| `description`               | text ⬜        |                                                            |
| `is_system`                 | boolean        | System roles cannot be deleted by the API.                 |
| `rank`                      | integer        | **UX ordering only.** Never consulted for authorization.   |
| `created_at` / `updated_at` | timestamptz    |                                                            |

**FKs out.** `users.role_id`, `role_permissions.role_id` (CASCADE).
**Indexes.** `code` (UQ).
**Security.** Authorization reads `role_permissions`, not `role.code`. A guard
must never branch on the string `ADMIN`, or adding a role becomes a code change.

### `permissions`

**Purpose.** Atomic capability registry. One row per `<RESOURCE>_<ACTION>`.

| Column        | Type           | Notes                                                        |
| ------------- | -------------- | ------------------------------------------------------------ |
| `id`          | uuid PK        |                                                              |
| `code`        | varchar(80) UQ | `BOOK_VIEW`, `LOAN_RETURN`, `FINE_WAIVE`. Stable identifier. |
| `resource`    | varchar(50)    | Indexed.                                                     |
| `action`      | varchar(50)    | Indexed.                                                     |
| `description` | text           | Surfaced in the admin UI.                                    |

**FKs out.** `role_permissions.permission_id` (CASCADE).
**Indexes.** `code` UQ, `resource`, `action`.
**Security.** Permissions are **resource-scoped, never row-scoped.** "Which rows
this reaches" is decided separately by branch scope and ownership. Conflating the
two produces permissions like `LOAN_VIEW_OTHER_MEMBERS`, which cannot be
reviewed as a list.

### `role_permissions`

**Purpose.** The role → permission mapping. The actual authorization data.

| Column          | Type        | Notes                         |
| --------------- | ----------- | ----------------------------- |
| `role_id`       | uuid PK,FK  |                               |
| `permission_id` | uuid PK,FK  |                               |
| `granted_by`    | uuid FK ⬜  | SET NULL. Who made the grant. |
| `created_at`    | timestamptz |                               |

**Indexes.** Composite PK prevents duplicate grants. Plus `permission_id`,
`granted_by` for reverse lookups.
**Security.** Composite PK means revoking is a `DELETE` and re-granting is an
`INSERT` — both naturally audited by the `role_permissions` history pattern, and
neither can silently double-apply.

### `users`

**Purpose.** Authenticating account. Identity, not library participation.

| Column                               | Type            | Notes                                                            |
| ------------------------------------ | --------------- | ---------------------------------------------------------------- |
| `id`                                 | uuid PK         |                                                                  |
| `email`                              | varchar(255) UQ | Login identifier.                                                |
| `phone`                              | varchar(32) ⬜  |                                                                  |
| `password_hash` 🔒                   | varchar(255)    | Argon2id PHC string. **Never selected into any API projection.** |
| `first_name` / `last_name`           | varchar(100)    | Indexed `(last_name, first_name)` for staff directory.           |
| `status`                             | enum            | `ACTIVE` \| `INACTIVE` \| `SUSPENDED` \| `LOCKED`. Indexed.      |
| `role_id`                            | uuid FK         | RESTRICT — a role in use is never deleted.                       |
| `primary_branch_id`                  | uuid FK ⬜      | SET NULL. Home branch.                                           |
| `email_verified_at`                  | timestamptz ⬜  |                                                                  |
| `must_change_password`               | boolean         | Forces rotation on first login.                                  |
| `failed_login_count`                 | integer         | 🔒 Operational. Never serialised.                                |
| `locked_until`                       | timestamptz ⬜  | 🔒 Never serialised.                                             |
| `last_login_at` / `last_login_ip` 🔒 |                 | IP never leaves the server.                                      |
| `password_changed_at`                | timestamptz ⬜  |                                                                  |
| `created_at` / `updated_at`          | timestamptz     |                                                                  |
| `deleted_at`                         | timestamptz ⬜  | Soft delete.                                                     |

**FKs in.** `roles` (RESTRICT), `branches` (SET NULL).
**FKs out.** ~20 relations — see schema. All attribution columns are SET NULL or
RESTRICT so deleting a user never cascades into circulation history.
**Indexes.** `email` UQ, `role_id`, `status`, `(last_name, first_name)`,
`primary_branch_id`, `deleted_at`.
**Security.**

- `passwordHash` is in `NEVER_SERIALISE_FIELDS`, and `redact()` derives both the
  pino paths and the transport filter from that one list. A field missing from
  that list is a field that leaks.
- `failedLoginCount`, `lockedUntil`, `lastLoginIp` are security telemetry:
  returning them tells an attacker exactly how many guesses they have left.
- `deleted_at` is the only way to remove a user. Sessions cascade so access ends
  immediately; history stays.

### `user_branches`

**Purpose.** Staff ↔ branch scope. Multi-branch librarians today; branch admins
later.

| Column        | Type        | Notes    |
| ------------- | ----------- | -------- |
| `user_id`     | uuid PK,FK  | CASCADE  |
| `branch_id`   | uuid PK,FK  | CASCADE  |
| `assigned_by` | uuid FK ⬜  | SET NULL |
| `created_at`  | timestamptz |          |

**Indexes.** Composite PK; plus `branch_id` (who works here), `assigned_by`.
**Security.** This table _is_ the branch-scope gate. A librarian with no rows is
scoped to nothing; one holding `BRANCH_MANAGE_ALL` bypasses the gate entirely.
Both facts are visible in the admin UI so the scope is never a mystery.

### `sessions`

**Purpose.** Server-side session registry — the source of truth for revocation.

| Column                               | Type        | Notes                                                                |
| ------------------------------------ | ----------- | -------------------------------------------------------------------- |
| `id`                                 | uuid PK     | Also the JWT `sid` claim.                                            |
| `user_id`                            | uuid FK     | CASCADE                                                              |
| `refresh_token_hash` 🔒              | char(64) UQ | SHA-256 of an opaque 256-bit token. **The token is never stored.**   |
| `family_id`                          | uuid        | Rotation lineage. Reuse of a rotated token revokes the whole family. |
| `ip` / `user_agent` / `device_label` |             | Session listing for the user.                                        |
| `issued_at` / `last_used_at`         | timestamptz |                                                                      |
| `expires_at`                         | timestamptz | CHECK `expires_at > issued_at`.                                      |
| `revoked_at` / `revoked_reason`      | ⬜          |                                                                      |

**Indexes.** `refresh_token_hash` UQ, `(user_id, revoked_at)`, `family_id`,
`expires_at`.
**Security.** A JWT alone cannot be revoked; every authenticated request checks
this row. That is why access tokens are capped at 60 minutes (enforced at
startup) — a longer window makes revocation effectively decorative. The refresh
cookie is scoped to `/api/v1/auth` so it is not attached to ordinary API calls.

### `password_reset_tokens` / `email_verification_tokens`

**Purpose.** Single-use, expiring, hashed one-time tokens.

Both store `token_hash` (char(64), UNIQUE), `expires_at`, `used_at`, `user_id`
(CASCADE). Indexed on `user_id` and `expires_at`.
**Security.** Stored hashed, so a database disclosure does not yield a working
reset link. TTLs: 30 minutes for reset, 48 hours for verification.
`used_at` makes replay visibly detectable.

---

## Organisation

### `libraries`

**Purpose.** Top-level tenant anchor and identity of the institution.

`code` UQ, `name`, `legal_name`, `email`, `phone`, `address`, **`timezone`**
(IANA, default `Africa/Nairobi`), `is_active`, `opened_at`-less timestamps.

**FKs out.** `branches.library_id` RESTRICT.
**Security.** `timezone` is security-relevant in a subtle way: fine thresholds are
calendar-day decisions, and getting the zone wrong makes a member overdue three
hours a day.

### `branches`

**Purpose.** A physical location. The unit of staff scope, inventory location, and
report segmentation.

`code` UQ, `name`, contact fields, `is_active` (indexed), `opened_at`.
**FKs in.** `libraries` RESTRICT.
**FKs out.** `locations`, `user_branches`, `members.home_branch_id`,
`book_copies.branch_id`, `loans.branch_id`, `reservations.branch_id`,
`fine_payments.branch_id` — all RESTRICT.
**Indexes.** `code` UQ, `library_id`, `is_active`.
**Security.** Every staff-scoped query filters by the principal's branch scope.
Global (`code` UNIQUE) rather than unique-per-library is deliberate: a branch code
appears on barcodes and labels and is read aloud over the phone.

### `locations`

**Purpose.** A zone or room within a branch (`Main Hall`, `Reference`, `Archives`).

`code`, `name`, `floor`, `is_active`. **UQ `(branch_id, code)`**.
**FKs in.** `branches` RESTRICT. **FKs out.** `shelves`, `book_copies` RESTRICT.

### `shelves`

**Purpose.** A rack. Adds the physical specificity staff need during reshelving,
and optional capacity for over-fill warnings.

`code`, `capacity` ⬜. **UQ `(location_id, code)`**.
**FKs in.** `locations` RESTRICT. **FKs out.** `book_copies` RESTRICT.

---

## Membership

### `member_types`

**Purpose.** **The policy table.** Every borrowing limit, duration, renewal cap,
grace period, fine rate, and hold duration lives here.

| Column                                   | Type             | Notes                                                       |
| ---------------------------------------- | ---------------- | ----------------------------------------------------------- |
| `code`                                   | varchar(30) UQ   | `STUDENT`, `STAFF`, `RESEARCHER`, `PUBLIC`, `CHILD`, `VIP`. |
| `max_active_loans`                       | integer          |                                                             |
| `loan_duration_days`                     | integer          |                                                             |
| `max_renewals` / `renewal_duration_days` | integer          |                                                             |
| `grace_period_days`                      | integer          | Fine starts **after** this, not at `due_date`.              |
| `fine_per_day`                           | decimal(14,2)    |                                                             |
| `max_fine_cap`                           | decimal(14,2) ⬜ | NULL = uncapped.                                            |
| `reservation_limit`                      | integer          |                                                             |
| `hold_duration_days`                     | integer          |                                                             |
| `requires_approval`                      | boolean          |                                                             |
| `is_active`                              | boolean          | Indexed.                                                    |

**CHECK `ck_member_type_policy`.** All counters ≥ 0, both durations > 0,
`fine_per_day` ≥ 0. A policy of "loan duration 0 days" is a configuration bug
that would make every loan instantly overdue; the constraint rejects it at write
time.
**FKs out.** `members`, `loans` RESTRICT.
**Security.** Rules are never hardcoded in controllers. Changing `STUDENT` from 5
to 7 books is an admin action, audited, with no deploy.

### `members`

**Purpose.** Library participation: a person who borrows.

| Column                                             | Type           | Notes                                                                        |
| -------------------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `membership_number`                                | varchar(30) UQ | Member-facing identifier **and the member barcode payload.**                 |
| `user_id`                                          | uuid FK **UQ** | RESTRICT. **At most one member per user.**                                   |
| `member_type_id`                                   | uuid FK        | RESTRICT.                                                                    |
| `home_branch_id`                                   | uuid FK        | RESTRICT. Indexed with `status` — the "active members at this branch" query. |
| `status`                                           | enum           | `ACTIVE` \| `INACTIVE` \| `SUSPENDED` \| `EXPIRED` \| `PENDING`. Indexed.    |
| `joined_at` / `expires_at`                         | timestamptz    | CHECK `expires_at >= joined_at`.                                             |
| `date_of_birth`                                    | date ⬜        | PII. Restricted projection.                                                  |
| `gender`, `address`, `city`, `occupation`, `notes` | ⬜             | PII / free text. `notes` is never shown to members.                          |
| `deleted_at`                                       | timestamptz ⬜ | Soft delete. Indexed.                                                        |

**Indexes.** `membership_number` UQ, `user_id` UQ, `member_type_id`,
`(home_branch_id, status)`, `status`, `deleted_at`.
**Security.**

- `membership_number` doubles as a barcode, so it must be treated as a
  semi-secret: possession of one lets someone attempt to borrow. It is never a
  sufficient credential — the borrow flow requires an authenticated staff session.
- `MEMBER_VIEW` does not imply seeing every member. A member reading their own
  record goes through ownership, and PII columns are excluded from projections
  where not needed.

---

## Catalogue

### `publishers`

`name` UQ, `imprint`, `country`, `website`, `email`. Referenced by `books`
(RESTRICT). A publisher that has published is never deleted — the name is part of
the bibliographic record.

### `authors`

`name`, **`sort_name`** (authority form `"Martin, Robert C."`), `biography`,
`nationality`, `birth_year`, `death_year`.
**Indexes.** `sort_name`, `name`, GIN full-text over `name || sort_name`.
**FKs out.** `book_authors` RESTRICT.
**Security.** `sort_name` exists so catalogue sorting is correct rather than
"sorting by first word", which puts every "The…" title together.

### `categories`

Self-referencing hierarchy (`Technology → Programming → …`): `parent_id` FK
RESTRICT, `name`, `slug` UQ, `description`, `position` (indexed), `is_active`.
**Security.** RESTRICT on delete means a parent cannot vanish under its children —
which would silently re-parent or orphan a subtree. Renaming is safe; the slug is
stable for URLs.

### `tags`

`name` UQ, `label` ⬜. Pure join target, CASCADE both ways.

### `books`

**Purpose.** The intellectual work.

| Column                                                                      | Type              | Notes                                                    |
| --------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- |
| `isbn13` / `isbn10`                                                         | varchar(20) UQ ⬜ | Each independently unique.                               |
| `title`                                                                     | varchar(400)      | Indexed; trigram + `text_pattern_ops` on `lower(title)`. |
| `subtitle` ⬜                                                               | varchar(400)      | Trigram indexed.                                         |
| `description`, `summary` ⬜                                                 | text              | `summary` feeds the weighted full-text index.            |
| `edition`, `language`, `publication_year`, `publication_date`, `page_count` |                   | `language` and `publication_year` indexed for facets.    |
| `publisher_id`                                                              | uuid FK ⬜        | RESTRICT.                                                |
| `cover_image_url`                                                           | varchar(500) ⬜   | CDN URL, not a file path.                                |
| `call_number`                                                               | varchar(50) ⬜    | Shelf-mark. Indexed.                                     |
| `subjects`                                                                  | text[]            | GIN indexed. LCSH-style headings.                        |
| `is_reference_only`                                                         | boolean           | Dictionaries and indexes cannot be borrowed.             |
| `archived_at` / `archived_reason`                                           | ⬜                | `archived_at` indexed; archives are filtered by default. |
| `created_by`                                                                | uuid FK ⬜        | SET NULL.                                                |
| `deleted_at`                                                                | timestamptz ⬜    | Only for a book with no copies and no history.           |

**FKs out.** `book_authors`/`book_categories`/`book_tags` CASCADE (pure joins);
`book_copies`, `loans`, `reservations`, `digital_resources` RESTRICT;
`publishers` RESTRICT.
**Indexes.** `isbn13`/`isbn10` UQ, `title`, `publisher_id`, `publication_year`,
`language`, `archived_at`, `created_by`, `call_number`.
**Security.** Two `UNIQUE`s on nullable ISBN columns coexist because PostgreSQL
treats NULLs as distinct — multiple rows with no ISBN are allowed, one row per
actual ISBN. That is the intended catalogue behaviour.

### `book_authors`

`book_id` + `author_id` composite PK. `position` (catalogued order; 1 = primary),
`role` (`AUTHOR` | `EDITOR` | `TRANSLATOR` | `ILLUSTRATOR`).
**FKs.** CASCADE from book, RESTRICT from author.
**Index.** `author_id` — "all books by this author" is the reverse direction and is
queried constantly.

### `book_categories`

`book_id` + `category_id` composite PK, `is_primary`.
**Partial unique index** `uq_book_one_primary_category` — at most one primary
category per book, while allowing any number of secondary ones.

### `book_tags`

`book_id` + `tag_id` composite PK. CASCADE both ways.

---

## Inventory

### `book_copies`

**Purpose.** The physical item.

| Column                                    | Type             | Notes                                                                                         |
| ----------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `book_id`                                 | uuid FK          | RESTRICT.                                                                                     |
| `branch_id`                               | uuid FK          | RESTRICT.                                                                                     |
| `location_id` / `shelf_id`                | uuid FK ⬜       | RESTRICT. A copy may be in transit with no location.                                          |
| `accession_number`                        | varchar(50) UQ   | Trigram indexed.                                                                              |
| `barcode`                                 | varchar(64) UQ   | Trigram indexed.                                                                              |
| `qr_token`                                | varchar(64) UQ   | **Independent opaque value.**                                                                 |
| `condition`                               | enum             | `NEW`…`DAMAGED`. Orthogonal to `status`.                                                      |
| `status`                                  | enum             | `AVAILABLE` \| `BORROWED` \| `RESERVED` \| `LOST` \| `DAMAGED` \| `MAINTENANCE` \| `REMOVED`. |
| `acquisition_date` / `acquisition_source` |                  | `PURCHASE` \| `DONATION` \| `TRANSFER` \| `REFUND` \| `LOST_REPLACEMENT`.                     |
| `purchase_price` / `replacement_cost`     | decimal(14,2) ⬜ | CHECK non-negative.                                                                           |
| `removed_at` / `removed_reason`           | ⬜               | CHECK: removal requires a reason.                                                             |

**Indexes.** `accession_number`/`barcode`/`qr_token` UQ; `(book_id, status)` and
`(branch_id, status)` are the two availability queries; `location_id`, `shelf_id`,
`status`, `removed_at`.
**Security.**

- `qr_token` is separate from `accession_number` on purpose. If the QR payload
  were derived from a sequential accession number, anyone holding one copy could
  enumerate the entire inventory from a photo. An opaque token makes a QR code
  a capability, not a catalogue listing.
- Trigram indexes on `barcode`/`accession_number` are for scanner tolerance, and
  they do widen the search surface: a barcode query can return near-misses. Every
  barcode lookup must resolve to exactly one copy before any state change.

### `copy_status_history`

**Purpose.** Append-only trail of every status/condition transition. Answers "when
was COPY-001 reported lost, and by whom?" without overwriting `book_copies`.

`bigserial` PK, `copy_id` FK RESTRICT, `from_status`/`to_status`,
`from_condition`/`to_condition`, `reason`, `changed_by`, `changed_at`,
`request_id`.
**Immutability.** `BEFORE UPDATE OR DELETE` trigger raises `restrict_violation`;
the app role is additionally REVOKEd those privileges.
**Index.** `(copy_id, changed_at)`.

---

## Circulation

### `loans`

**Purpose.** One borrowing. **Never deleted.**

| Column                        | Type           | Notes                                                       |
| ----------------------------- | -------------- | ----------------------------------------------------------- |
| `copy_id`                     | uuid FK        | RESTRICT.                                                   |
| `book_id`                     | uuid FK        | RESTRICT. **Denormalised** for reporting.                   |
| `member_id`                   | uuid FK        | RESTRICT.                                                   |
| `branch_id`                   | uuid FK        | RESTRICT. Issuing branch, immutable after creation.         |
| `issued_by`                   | uuid FK        | RESTRICT. Staff attribution.                                |
| `member_type_id`              | uuid FK        | RESTRICT. **Policy snapshot.**                              |
| `loaned_at` / `due_date`      | timestamptz    | CHECK `due_date >= loaned_at`.                              |
| `grace_until`                 | timestamptz ⬜ | `due_date + grace_period_days`. Fine starts here.           |
| `returned_at` / `returned_by` | ⬜             | CHECK `returned_at >= loaned_at`.                           |
| `status`                      | enum           | `ACTIVE` \| `RETURNED` \| `OVERDUE` \| `LOST` \| `DAMAGED`. |
| `renewal_count`               | integer        | CHECK ≥ 0. Mirrors the renewal ledger.                      |
| `last_renewed_at`             | timestamptz ⬜ |                                                             |
| `lost_at` / `damaged_at`      | timestamptz ⬜ |                                                             |
| `notes`                       | text ⬜        |                                                             |

**Indexes.** `(copy_id, status)` — the availability check; `(member_id, status)` —
"my loans" and the borrowing-limit count; `(status, due_date)` — overdue sweep;
`(branch_id, status)` — branch reporting; `(book_id, loaned_at)` — most-borrowed;
`issued_by`; `(member_id, loaned_at)`.
**Concurrency.** Partial unique index `uq_loan_one_open_per_copy` on
`(copy_id) WHERE status IN ('ACTIVE','OVERDUE')`. Two librarians scanning the
same copy cannot both succeed — the loser gets a 409, not a second loan.
**Security.** `renewal_count` is redundant with the renewal ledger on purpose: the
ledger is the evidence, the counter is the fast read, and the unique
`(loan_id, renewal_number)` keeps them consistent under a race.

### `loan_status_history`

`bigserial` PK, `loan_id` FK RESTRICT, from/to status, `reason`, `changed_by`,
`changed_at`, `request_id`. Append-only via trigger. Indexed `(loan_id, changed_at)`.

### `loan_renewals`

**Purpose.** Append-only renewal ledger. Never a `renewal_count` increment alone.

`loan_id` FK RESTRICT, `renewed_by` FK RESTRICT, `renewed_at`,
`previous_due_date`, `new_due_date`, `renewal_number`, `previous_status`,
`reason`.
**Constraints.** UQ `(loan_id, renewal_number)`; CHECK
`new_due_date > previous_due_date`.
**Security.** The unique constraint makes the renewal limit **race-proof**: two
simultaneous renewals of the last-permitted renewal cannot both insert the same
ordinal, so the second is rejected by the database regardless of what the service
checked.
**Indexes.** `loan_id`, `renewed_by`.

### `reservations`

**Purpose.** The waiting list. Targets a **title**.

| Column                                         | Type        | Notes                                                           |
| ---------------------------------------------- | ----------- | --------------------------------------------------------------- |
| `book_id`                                      | uuid FK     | RESTRICT.                                                       |
| `member_id`                                    | uuid FK     | RESTRICT.                                                       |
| `branch_id`                                    | uuid FK ⬜  | RESTRICT. Preferred pickup branch.                              |
| `position`                                     | integer     | CHECK > 0. FIFO among live holds.                               |
| `status`                                       | enum        | `ACTIVE` \| `READY` \| `FULFILLED` \| `CANCELLED` \| `EXPIRED`. |
| `reserved_at`                                  | timestamptz |                                                                 |
| `notified_at` / `ready_at` / `hold_expires_at` | ⬜          | CHECK: `READY` requires `ready_at` **and** `hold_expires_at`.   |
| `fulfilled_at` / `fulfilled_loan_id`           | ⬜          | FK SET NULL.                                                    |
| `cancelled_at` / `cancel_reason`               | ⬜          |                                                                 |

**Indexes.** `(book_id, status, position)` — the queue read;
`(member_id, status)` — "my reservations"; `(status, hold_expires_at)` — expiry
sweep; `branch_id`, `fulfilled_loan_id`.
**Partial unique indexes.**

- `uq_reservation_one_open_per_member_book` on `(member_id, book_id) WHERE status IN ('ACTIVE','READY')` — no duplicate hold.
- `uq_reservation_position_live` on `(book_id, position) WHERE status IN ('ACTIVE','READY')` — two concurrent "next in queue" computations cannot claim the same slot.
  **Security.** `position` and `hold_expires_at` are member-visible (it is their
  place in line and their deadline) but never writable by the member; both are
  computed server-side inside the transaction that creates the hold.

---

## Finance

> Nothing in this section is ever deleted. Corrections are reversals with
> recorded reasons.

### `fines`

**Purpose.** An assessed charge.

| Column                                      | Type           | Notes                                                            |
| ------------------------------------------- | -------------- | ---------------------------------------------------------------- |
| `reference`                                 | varchar(40) UQ | `FNE-2026-000123`. Human-facing.                                 |
| `member_id`                                 | uuid FK        | RESTRICT.                                                        |
| `loan_id`                                   | uuid FK ⬜     | RESTRICT, **not unique** — one loan may carry many damage fines. |
| `type`                                      | enum           | `OVERDUE` \| `LOST` \| `DAMAGE` \| `LATE_RETURN` \| `OTHER`.     |
| `amount`                                    | decimal(14,2)  |                                                                  |
| `waived_amount`                             | decimal(14,2)  | Default 0.                                                       |
| `status`                                    | enum           | `OUTSTANDING` \| `PARTIAL` \| `PAID` \| `WAIVED` \| `VOID`.      |
| `description`                               | varchar(500)   |                                                                  |
| `days_overdue`                              | integer        | Recorded at assessment; never recomputed on read.                |
| `assessed_at` / `due_date`                  |                |                                                                  |
| `waived_at` / `waived_by` / `waiver_reason` | ⬜             |                                                                  |
| `created_by`                                | uuid FK ⬜     | SET NULL.                                                        |

**CHECKs.** `ck_fines_non_negative`: `amount >= 0 AND 0 <= waived_amount <= amount`.
`ck_fine_waiver_complete`: a non-zero waiver **must** carry `waived_at` and
`waiver_reason`.
**Partial unique index.** `uq_fine_one_overdue_per_loan` on `(loan_id) WHERE
type IN ('OVERDUE','LATE_RETURN') AND status <> 'VOID'`.
**Security.**

- The waiver constraint exists because waiving a fine is the one finance action
  with no compensating record. Requiring a reason and a timestamp means a waived
  fine is always answerable in an audit.
- `FINE_WAIVE` is `sensitive: true` in the registry and is **not** granted to
  anyone whose role does not need it. It is separated from `FINE_UPDATE` so a
  role can adjust a description without being able to erase a debt.
- `days_overdue` and `amount` are stored, not computed on read. A member's record
  must not change retroactively because a rate was edited.

### `fine_payments`

**Purpose.** Append-only receipts. **A payment is never deleted or edited — a
void is a new set of columns on the same row.**

`fine_id` FK RESTRICT, `receipt_number` varchar(40) UQ, `amount` decimal(14,2),
`method` enum (`CASH` \| `MPESA` \| `BANK` \| `CARD` \| `OTHER`), `reference` ⬜
(M-PESA confirmation code), `paid_at`, `received_by` FK RESTRICT, `branch_id` FK
⬜, `notes`, `voided_at`/`voided_by`/`void_reason`.
**CHECKs.** `ck_payment_positive`: `amount > 0` — a negative "payment" is a
withdrawal and must be a void, never a negative row.
`ck_payment_void_complete`: a void records both _who_ and _when_, atomically.
**Indexes.** `receipt_number` UQ; `(fine_id, paid_at)` — the balance calculation;
`paid_at` — revenue over time; `received_by` — cashier reconciliation;
`method` — payment-mix reporting.
**Security.** Outstanding balance is
`amount − waived_amount − Σ(non-voided payments)`, computed in Decimal and
bounded by `MAX_PAYMENT_AMOUNT`. Overpayment is a 422, not a silent change.
Receipt numbers are generated server-side from a sequence with a period prefix;
a client-supplied receipt number is a receipt-forgery vector.

---

## Platform

### `notifications`

**Purpose.** In-app notifications, and the fan-out point for future channels.

`user_id` FK **CASCADE** (ephemeral), `type` enum, `title`, `message`,
`data` json (deep-link payload — never secrets), `channel` varchar(30)
(`IN_APP` now; `EMAIL`/`SMS`/`PUSH` are provider rows, not schema changes),
`action_url`, `read_at`, `created_at`.
**Indexes.** `(user_id, read_at, created_at)` — the unread badge; `(type, created_at)` — sweeps.
**Security.** `data` is redacted before write, and `channel` selects a provider
rather than bypassing one. A notification is addressed to a `user_id` derived
server-side from the event's subject, never from request input — otherwise a
librarian could address a notification to an arbitrary member by posting an id.

### `audit_logs`

**Purpose.** Append-only accountability record.

`bigserial` PK, `actor_id` FK SET NULL, **`actor_email`** and **`actor_role`**
snapshotted, `action` enum (50 values), `entity_type`, `entity_id`, `description`,
`before` json, `after` json, `ip`, `user_agent`, `request_id`, `created_at`.
**No `updated_at` by design** — immutability is the point.
**Immutability.** `BEFORE UPDATE OR DELETE` trigger raises; app role REVOKEd
`UPDATE, DELETE`.
**Indexes.** `(actor_id, created_at)`, `(entity_type, entity_id)`, `(action, created_at)`, `created_at`.
**Security.**

- The snapshotted `actor_email`/`actor_role` mean the log stays readable after
  the user row is soft-deleted.
- `before`/`after` are produced by `diffForAudit()`, which emits **only changed
  fields** and runs them through `redact()`. Storing a full object would put
  password hashes and national IDs into a table that is deliberately exportable.
- `LOGIN_FAILED` is logged with a null-safe actor, so a brute-force attempt is
  recorded even against an email that does not exist.
- The trigger fires for every role including a superuser with direct table
  access. "Administrators cannot edit the audit log" is a database property here,
  not a permission.

### `settings`

**Purpose.** Typed runtime configuration.

`key` varchar(100) UQ, `value` json, `value_type` enum (`string`|`number`|`boolean`|`json`),
`category` (indexed), `description`, `is_public` (default false),
`updated_by` FK SET NULL, timestamps.
**Security.** `is_public` is the gate on `GET /api/v1/settings/public`, the only
settings route reachable without authentication. It is a _tiny_, explicitly
marked set — library name, contact details. Every other row requires
`SETTINGS_VIEW`, and mutation requires `SETTINGS_UPDATE`. A policy accidentally
marked public here would be served pre-login, so the flag is reviewed per row and
`SETTINGS_INVALID` (422) is returned when a public value fails its type check.
Settings changes are audited with a before/after diff.

### `digital_resources`

**Purpose.** A digital file attached to a book (PDF, EPUB, preview, external link).

`book_id` FK RESTRICT, `type` enum, `title`, **`storage_key`** 🔒 (private object
key — **never a URL**), `mime_type`, `size_bytes`, `access_level` enum (`MEMBER` \|
`LOAN_HOLDER` \| `STAFF` \| `PUBLIC`), `is_active`, `uploaded_by` FK SET NULL.
**Indexes.** `(book_id, is_active)`, `access_level`.
**Security.**

- Only the storage key is persisted. Serving is `authorize → short-lived signed
URL`; there is no predictable public path to a file. `storageKey` is in
  `NEVER_SERIALISE_FIELDS`.
- `access_level = PUBLIC` still means "any authenticated member", not
  "anyone on the internet" — the API is not anonymous.
- `DIGITAL_ACCESS` is a separate permission from `DIGITAL_VIEW` because reading
  an entitlement and consuming it are different acts; conflating them either
  over-grants or mislabels the audit trail.

### `digital_loans`

**Purpose.** Entitlement to a digital resource.

`resource_id` FK RESTRICT, `member_id` FK RESTRICT, `issued_at`, `expires_at`,
`returned_at`, `status` varchar(30).
**Partial unique index** `uq_digital_loan_one_open_per_member_resource` on
`(member_id, resource_id) WHERE returned_at IS NULL`.
**Security.** `LOAN_HOLDER` access requires an open digital loan, checked in the
same query as the ownership predicate — never fetched-then-filtered.

### `sync_operations`

**Purpose.** V2 offline circulation queue. Schema settled now; no client writes to
it in V1.

`id` **client-generated uuid PK** (a replayed operation collapses onto one row),
`user_id` FK CASCADE, `device_id`, `operation_type`, `payload` json,
`client_timestamp`, `base_version` (optimistic-concurrency token captured at
queue time), `sync_status` (`PENDING`|`SYNCING`|`SUCCESS`|`FAILED`|`CONFLICT`),
`result_id`, `failure_code`, `failure_reason`, `synced_at`, `created_at`.
**Indexes.** `(user_id, sync_status)`, `device_id`, `(sync_status, created_at)`.
**Security.** `CONFLICT` is a first-class terminal state. A stale `base_version`
is reported back to the device rather than silently overwritten, so offline
circulation can never clobber a server-side change the device never saw.
