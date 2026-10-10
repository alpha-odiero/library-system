# Business Rules

The invariants a library will actually break if they are left to application
code. Each rule states **where it is enforced** — a rule enforced only in a
service is a rule that will be bypassed by the next service, the admin script,
or the migration that was run by hand.

Enforcement is layered deliberately:

| Layer                | Role                                             | Why                                          |
| -------------------- | ------------------------------------------------ | -------------------------------------------- |
| Service              | Readable rule, good error message, orchestration | Where the _reason_ lives                     |
| `CHECK` constraint   | Coherence of a single row                        | Cannot be forgotten, cannot be raced         |
| Partial unique index | "At most one of these" under concurrency         | Cannot be raced by any number of connections |
| Trigger / `REVOKE`   | Append-only history                              | Not expressible in Prisma                    |
| Test                 | The guarantee that the layer above holds         | Proves the rule rather than asserting it     |

Structural notes are in [Constraints and indexes](./constraints-and-indexes.md);
the datamodel is in [Tables](./tables.md).

## Borrowing

### A member may borrow only if all of these hold

| #   | Rule                                                                                   | Enforcement                     |
| --- | -------------------------------------------------------------------------------------- | ------------------------------- |
| B1  | The member record is `ACTIVE`                                                          | service                         |
| B2  | The membership has not expired (`expires_at` null or future, compared in library time) | service, via `lib/dates.ts`     |
| B3  | Open fine balance is below the member type's `max_fines` blocking threshold            | service                         |
| B4  | Active loan count is below the member type's `max_active_loans`                        | service, inside the transaction |
| B5  | The copy is `AVAILABLE`                                                                | service + partial unique index  |
| B6  | The copy's `condition` permits lending                                                 | service                         |
| B7  | The member has no live reservation on a _different_ copy of this title                 | service                         |

These are checked **inside the same transaction** that writes the loan. Checking
them before opening a transaction is a check-then-act race: two staff terminals
scanning the same member both pass B4, and the ceiling is exceeded.

### Ceilings and windows come from `member_types`, never from code

`max_active_loans`, `loan_duration_days`, `max_renewals`, `renewal_duration_days`,
`grace_period_days`, `fine_per_day`, `max_fine_amount`, `max_reservations`,
`hold_duration_days`. Coherence is database-enforced by `ck_member_type_policy`,
so a nonsensical policy (a fine cap below a single day's fine) cannot be saved.

### Due date

```
due_date = toLibraryDay(loaned_at) + loan_duration_days
```

Calendar days in `TIMEZONE`, never a UTC arithmetic helper. A loan issued at
23:30 local is due 14 calendar days later, and a member in a different timezone
does not shift their due date by running the app in another one.

`ck_loan_dates` enforces `due_date >= loaned_at`, and `ck_loan_return_after_issue`
enforces `returned_at >= loaned_at` — the two ways a loan can become
temporally impossible.

## Renewal

| #   | Rule                                                   | Enforcement                       |
| --- | ------------------------------------------------------ | --------------------------------- |
| R1  | The caller may renew (`LOAN_RENEW`)                    | Gate 2                            |
| R2  | The loan is open — not returned, lost, or damaged      | service                           |
| R3  | `renewal_count < member_type.max_renewals`             | service, inside the transaction   |
| R4  | The loan is not overdue past the grace period          | service                           |
| R5  | No other member holds a live reservation on this title | service                           |
| R6  | The due date moves strictly forward                    | **`ck_renewal_extends_due_date`** |

**Why R6 needs a constraint.** "Renewal" that shortens a due date is always a
bug — a timezone slip or a race on the new due date. The service computes the
date; the constraint refuses to store an extension that goes backwards. The
service gives a good error; the constraint makes the bug unrepresentable.

**Why R3 needs a constraint too.** The renewal ledger has
`UNIQUE (loan_id, renewal_number)`. Two concurrent renewals on the same loan
would both read `renewal_count = 2`, both write number 3, and one would fail on
the unique index. The service catches that and re-reads, returning "this loan was
just renewed" instead of a 500.

Every renewal is a row in `renewals`. The loan's `renewal_count` is a
convenience; the ledger is the truth.

## Returns and exceptions

| #   | Rule                                                                              | Enforcement                        |
| --- | --------------------------------------------------------------------------------- | ---------------------------------- |
| T1  | A return sets `returned_at` and moves the copy to `AVAILABLE` (or its next state) | one transaction                    |
| T2  | Overdue days are calendar days in library time, after the grace period            | `overdueDays()`                    |
| T3  | An overdue fine is created at most once per loan                                  | **`uq_fine_one_overdue_per_loan`** |
| T4  | Marking a copy lost creates a replacement-cost fine                               | one transaction                    |
| T5  | Marking a copy damaged records the condition and creates a fine                   | one transaction                    |
| T6  | A returned copy with a live reservation goes to `RESERVED`, not `AVAILABLE`       | service                            |
| T7  | Every status transition writes `copy_status_history`                              | service, same transaction          |

T3 is a partial unique index rather than a service flag, because "already fined"
checked as `fines.findFirst(...)` is precisely the check-then-act race that T3
exists to make impossible: the daily overdue job and a staff member pressing
"assess fine" would otherwise both create one.

### Copy state machine

```
                ┌──────────────┐
   reserve ───▶│  RESERVED    │◀─── fulfilled
                └──────┬───────┘
                       │ borrow
   available ──────────▼──── borrow ─────▶ [AVAILABLE]
   (T6)                 │
                       ▼
                    BORROWED ──return──▶ (AVAILABLE | RESERVED)
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     OVERDUE        mark lost      mark damaged
        │              │              │
        │              ▼              ▼
    return            LOST          DAMAGED
        │           (terminal)     (repaired → AVAILABLE)
        ▼
   return → AVAILABLE | RESERVED
```

`LOST`, `DAMAGED`, `MAINTENANCE`, and `REMOVED` are **terminal or
repair-triggered**: leaving them requires a documented workflow, not a generic
status update. `ck_copy_removal_complete` requires a removal reason and removal
timestamp together, so a copy cannot be "removed" with no explanation.

`REMOVED` is not a hard delete. The copy row survives with its history, because
"what happened to accession 4471" is a question the audit trail must be able to
answer.

## Reservations

| #   | Rule                                                                | Enforcement                                       |
| --- | ------------------------------------------------------------------- | ------------------------------------------------- |
| H1  | Reservations are held against a **book**, not a copy                | schema (`book_id`, no `copy_id` on the live path) |
| H2  | A member may hold at most one live reservation per title            | **`uq_reservation_one_open_per_member_book`**     |
| H3  | Queue position is a positive integer, contiguous from 1             | service + **`uq_reservation_position_live`**      |
| H4  | Hold duration comes from member type or library settings            | service                                           |
| H5  | Marking a reservation `READY` assigns a specific available copy     | service                                           |
| H6  | A hold expiring returns its copy to `AVAILABLE`                     | scheduled job                                     |
| H7  | Moving to `READY` requires copy id **and** ready timestamp together | **`ck_reservation_ready_complete`**               |

**H1 is the single most consequential design decision in circulation.** A
reservation on a title means the member gets the next copy of that title. If the
reservation bound to a copy at request time, the member would be holding a copy
that is on loan to someone else, transferred to another branch, or lost — and the
queue position would be meaningless. The specific copy is assigned only when the
hold becomes `READY`.

**H2 and H3 are partial unique indexes**, not service checks, for the same reason
as the loan ceiling: a queue position must be unique among live holds, and two
staff members serving holds at two terminals must not produce two position 1s.

## Fines and payments

| #   | Rule                                                         | Enforcement                         |
| --- | ------------------------------------------------------------ | ----------------------------------- |
| F1  | A fine is non-negative                                       | **`ck_fines_non_negative`**         |
| F2  | A payment is strictly positive                               | **`ck_payment_positive`**           |
| F3  | Waiving requires an actor and a reason                       | **`ck_fine_waiver_complete`**       |
| F4  | Voiding requires an actor and a reason                       | **`ck_payment_void_complete`**      |
| F5  | Amounts balance to two decimal places, computed in `Decimal` | `lib/money.ts`                      |
| F6  | A copy's prices are non-negative                             | **`ck_copy_prices_non_negative`**   |
| F7  | Paid + waived + outstanding = original                       | service, asserted on every mutation |
| F8  | Receipt numbers are unique and sequential                    | service                             |
| F9  | Payments are never deleted                                   | `REVOKE DELETE ... FROM lms_app`    |

**F5 is not a formatting concern, it is correctness.** IEEE-754 cannot represent
`0.01`; `0.1 + 0.2 !== 0.3` in every language that uses doubles. A fine computed
by multiplying a daily rate by a day count, then reduced by a payment, and
compared for equality against zero, will be wrong at the boundary — which is
exactly where the code decides whether a member's account is cleared.

F7 is checked after every adjustment so the ledger cannot drift. If it does not
balance, the service throws and the transaction rolls back rather than writing a
row that cannot be reconciled.

**F9 is why voiding is a column and not a delete.** The money trail must be
reconstructable: what was charged, what was taken, what was waived, by whom, and
why. Deleting a payment destroys the evidence that the amount was never actually
collected.

## Catalogue integrity

| #   | Rule                                                              | Enforcement                                        |
| --- | ----------------------------------------------------------------- | -------------------------------------------------- |
| C1  | ISBN-10 and ISBN-13 are checksum-validated and stored canonically | `lib/isbn.ts`, service, `CHECK (length(...) = 13)` |
| C2  | One title may be the primary category                             | **`uq_book_one_primary_category`**                 |
| C3  | A book has many authors; an author has many books                 | `book_authors` join                                |
| C4  | A book has at most one ISBN-10 and at most one ISBN-13            | column-wise uniqueness                             |
| C5  | A copy's barcode and QR token are unique                          | unique indexes                                     |
| C6  | Deleting a book with copies is refused                            | FK `RESTRICT`                                      |

**C1 is what stops duplicate titles.** Without canonicalisation, `978-0-13-110362-7`,
`9780131103627`, and `978 0 13 110362 7` are three different strings and three
search results for one book. Canonicalisation at the boundary — including
rejection, not repair, of a bad checksum — is what makes the catalogue
trustworthy. A checksum failure is reported as invalid input; the system never
guesses the intended digit, because a guessed digit creates the duplicate the
check was meant to prevent.

**C6 is `RESTRICT`, not `CASCADE`.** Deleting a catalogue record that has
circulation history would delete the reason a fine exists. Retiring a book is a
status change.

## Access control invariants

The full model is in [Authorization](../authorization/authorization.md); the
non-negotiable parts:

| #   | Rule                                                                 | Enforcement                                                                  |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A1  | No request reaches a resource without an authenticated identity      | `requireAuth()`; `security/route-manifest.test.ts` fails the build otherwise |
| A2  | No operation runs without an explicit permission grant               | `requirePermission()`; absence is a denial                                   |
| A3  | A staff member may act only inside their branch scope                | Gate 3                                                                       |
| A4  | A member may act only on their own resources                         | Gate 4, a `WHERE` predicate in the query                                     |
| A5  | A resource the caller may not see is reported as **404**, not 403    | service                                                                      |
| A6  | 401 means unauthenticated; 403 means authenticated but not permitted | `error-handler.ts`                                                           |

**A5 is a deliberate information-disclosure decision.** Returning 403 for a
record that exists and 404 for one that does not lets any authenticated member
enumerate the member table by watching status codes. Both cases answer 404.

## Audit immutability

| #   | Rule                                                                     | Enforcement                                             |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| L1  | `audit_logs` rows cannot be updated                                      | trigger `audit_logs_no_update_delete` + `REVOKE UPDATE` |
| L2  | `audit_logs` rows cannot be deleted                                      | same trigger + `REVOKE DELETE`                          |
| L3  | `loan_status_history` and `copy_status_history` are append-only          | triggers + `REVOKE UPDATE, DELETE`                      |
| L4  | `loans`, `fines`, and `fine_payments` rows cannot be deleted             | `REVOKE DELETE`                                         |
| L5  | An audit row is written in the same transaction as the action it records | service discipline, asserted by tests                   |

L1–L4 use a shared `raise_immutable_violation()` function. The trigger handles
the application role; the `REVOKE` handles a role that somehow bypasses it.
**The right to erase history is a privilege granted to a DBA during an incident,
not a capability of the running application.**

L5 is the one that needs a test rather than a constraint: a mutation committed
without its audit row is individually valid SQL. Every state-changing service
method asserts that the audit row exists when the transaction commits.

## Dates and time

| #   | Rule                                                                   | Enforcement             |
| --- | ---------------------------------------------------------------------- | ----------------------- |
| D1  | Overdue, due dates, and day counts are **calendar days** in `TIMEZONE` | `lib/dates.ts`          |
| D2  | Storage is `timestamptz`; serialisation is ISO 8601 UTC                | schema, `toIso()`       |
| D3  | A library's "today" is computed in its timezone, not the server's      | `toLibraryDate()`       |
| D4  | Session and token expiry compare instants                              | `ck_session_dates`      |
| D5  | Membership expiry is not before joining                                | **`ck_member_dates`**   |
| D6  | Nothing computes a day difference with raw millisecond subtraction     | code review, unit tests |

**D1 and D3 are the same bug wearing different clothes.** A server in UTC
calculating a library in `Africa/Nairobi` (UTC+3) reports a member as overdue one
day early or late. `startOfLibraryDay()` exists so that no code has to
reimplement it.

Day arithmetic is `addCalendarDays()`, which adds to the calendar date and
re-normalizes through the library zone. `14 * 24 * 3600 * 1000` is not the same
operation: it is 13 or 15 calendar days across a daylight-saving transition.

## What is deliberately _not_ enforced here

- **Structural limits** — maximum page size, request body size, absolute fine
  ceiling. These live in `config/constants.ts`. They are not settings and cannot
  be loosened through the settings page.
- **Cosmetic validation** — trimming whitespace, normalising case for display.
  Zod's job, not the database's.
- **Cross-entity narrative rules** — "a book with no copies should not appear in
  the catalogue". That is a query concern, not a constraint.
