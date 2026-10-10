# Entity Relationship Diagram

Two renderings of the same schema:

- **[`schema.dbml`](./schema.dbml)** — importable at [dbdiagram.io](https://dbdiagram.io)
  for visual editing and export to SQL/PNG.
- This page — grouped diagrams, readable without leaving the repository.

Authoritative source remains `apps/backend/prisma/schema.prisma`. If a diagram and
the schema ever disagree, the schema is correct and the diagram is a bug.

## Reading the diagrams

- `||--o{` one-to-many · `||--||` exactly one · `}o--o{` many-to-many
- `[delete: restrict]` the FK blocks deletion of the parent
- The red annotations mark the guarantees that are not obvious from cardinality
  alone.

---

## 1. Identity and access

```
  ┌───────────┐       ┌───────────────────┐       ┌──────────────────┐
  │  roles    │       │ role_permissions  │       │   permissions    │
  │───────────│       │───────────────────│       │──────────────────│
  │ id  PK    │──┐    │ role_id       PK  │   ┌───│ id  PK           │
  │ code UQ   │  └───>│ permission_id PK  │<──┘   │ code UQ          │
  │ is_system │       │ granted_by   FK  │       │ resource         │
  │ rank      │       └───────────────────┘       │ action           │
  └─────┬─────┘                                   └──────────────────┘
        │ 1
        │
        │ n
  ┌─────┴──────────────────────────────────────────────────────┐
  │  users                                                      │
  │──────────────────────────────────────────────────────────────│
  │ id PK · email UQ · password_hash 🔒 · status · role_id FK     │
  │ primary_branch_id FK ⬜ · failed_login_count 🔒 · locked_until │
  │ 🔒 · must_change_password · deleted_at ⬜                     │
  └───┬────────────┬──────────────┬──────────────────────────────┘
      │1           │1             │1
      │            │              │
   ┌──┴──┐      ┌──┴────────┐  ┌──┴───────────────────┐
   │     │      │sessions   │  │ password_reset_tokens│
┌──┴──┐  │      └───────────┘  │ email_verification_  │
│users│  │1                    │   tokens             │
│     │  │n                    └──────────────────────┘
└──┬──┘  │
   │1    │n
   │  ┌──┴─────────────────┐
   │  │ user_branches      │  ◀── staff branch scope
   │  │────────────────────│      (composite PK, CASCADE)
   │  │ user_id       PK FK│
   │  │ branch_id     PK FK│
   │  │ assigned_by   FK ⬜ │
   │  └────────────────────┘
   │
   │1  ❗ user_id is UNIQUE — a user is at most one member
   │   and Member→User is RESTRICT, so history survives.
   ▼
```

**Security notes.** `roles.code` is never consulted for authorization — only
`role_permissions` is, so adding a role is data. `sessions` is the revocation
source of truth: a JWT alone cannot be revoked, which is why access tokens are
capped at 60 minutes at startup.

---

## 2. Organisation and membership

```
  ┌────────────┐ 1     n ┌───────────┐ 1     n ┌───────────┐ 1     n ┌─────────┐
  │ libraries  │────────>│ branches  │────────>│ locations │────────>│ shelves │
  │────────────│ restr.  │───────────│ restr.  │───────────│ restr.  │─────────│
  │ code UQ    │         │ code UQ   │         │ (branch_id│         │ (loc_id,│
  │ timezone   │         │ is_active │         │  code) UQ │         │  code)U│
  └────────────┘         └─────┬─────┘         └───────────┘         └────┬────┘
                               │                                        │
                     ┌─────────┼──────────┬─────────────┐               │
                     │1        │1          │1            │ n             │1
                     │         │           │             │               │
              ┌──────┴──┐  ┌───┴───────┐ ┌─┴───────────┐ │        ┌──────┴──────┐
              │ members │  │book_copies│ │  loans      │ │        │ book_copies │
              │─────────│  │───────────│ │─────────────│ │        │             │
              │membership│ │branch_id  │ │branch_id    │ │        │ shelf_id    │
              │ _num UQ │  │  FK       │ │  FK         │ │        │  FK        │
              │user_id UQ│ │           │ │ (issuing,   │ │        └─────────────┘
              │member_   │ └───────────┘ │  immutable) │ │
              │ type_id  │               └─────────────┘ │
              │home_     │                               │
              │ branch_id│        ┌──────────────┐       │
              │ status   │        │ reservations │       │
              └────┬─────┘        │──────────────│       │
                   │              │ branch_id FK │◀──────┘
                   │1             └──────────────┘
                   │
                   │  ╔══════════════════════════════════════════════╗
                   │  ║  member_types is THE POLICY TABLE             ║
                   │  ║  max loans · duration · renewals · grace      ║
                   │  ║  fine/day · cap · reservation limit · hold    ║
                   │  ║  Loans snapshot member_type_id so a later     ║
                   │  ║  policy edit cannot rewrite history.          ║
                   │  ╚══════════════════════════════════════════════╝
```

**Cardinality.** A member has exactly one home branch and exactly one member type;
a branch holds many members. `member_types.max_active_loans` is compared against
a count of that member's open loans, never assumed.

---

## 3. Catalogue (many-to-many, correctly modelled)

```
              ┌──────────┐        ┌──────────────┐       ┌──────────────┐
              │ authors  │        │ book_authors │       │   books      │
              │──────────│        │──────────────│       │──────────────│
              │ name     │◀──────>│ book_id    PK│◀──────│ id  PK       │
              │ sort_name│  1   n │ author_id  PK│   n 1 │ isbn13 UQ ⬜  │
              └─────┬────┘  restr.│ position     │ restr.│ isbn10 UQ ⬜  │
                    │           │ role         │       │ title        │
                    │           └──────────────┘       │ publisher_id │
                    │                                  │ subjects[]   │
             ┌──────┴───────┐        ┌────────────────┐ │ is_reference_│
             │ book_tags    │        │ book_categories│ │   only       │
             │──────────────│        │────────────────│ │ archived_at  │
             │ book_id   PK │        │ book_id     PK │ └──────┬───────┘
             │ tag_id    PK │        │ category_id PK │        │ 1
             └──────┬───────┘        │ is_primary     │        │
                    │                └────────┬───────┘        │
             ┌──────┴───────┐                 │ n              │ n
             │    tags      │        ┌────────┴────────┐       │
             │──────────────│        │   categories   │       │
             │ name UQ      │        │────────────────|       │
             └──────────────┘        │ parent_id FK ⬜ │◀──┐   │
                                    │ slug UQ        │   │   │ self-referencing
                                    └────────────────┘   └───┘ hierarchy
                                                            (RESTRICT both ways)

                    ┌────────────┐
                    │ publishers │───1──────────────> books
                    │────────────│  RESTRICT
                    │ name UQ    │
                    └────────────┘
```

**Cardinality.**

- A book has many authors; an author has many books → true many-to-many through
  `book_authors` (composite PK, so a duplicate credit is impossible).
- A book has many categories; a category has many books → `book_categories`, with
  a **partial unique index** allowing at most one primary category per book.
- Categories nest. `RESTRICT` on `parent_id` means a parent cannot be deleted out
  from under its children.

---

## 4. Circulation

```
   book_copies                        reservations
        │  1                               │  1
        │                                  │
        │  n                               │  n
   ┌────┴─────┐                    ┌──────┴──────────┐
   │  loans   │                    │    members      │
   │──────────│                    └──────┬──────────┘
   │ copy_id  │  ❗❗❗                   ▲   ▲
   │ book_id  │  uq_loan_one_        ┌────┘   └────┐
   │ member_id│  open_per_copy       │             │
   │ branch_id│  WHERE status IN     │ 1           │ 1
   │ issued_by│  ('ACTIVE','OVERDUE')│             │
   │ member_  │                       │            user_id UQ
   │  type_id │                       │
   │ loaned_at│                       └── members
   │ due_date │
   │ grace_   │                       every loan, fine, reservation
   │  until   │                       is reachable ONLY through the
   │ returned_│                       member's own row — which is what the
   │  at/by   │                       ownership predicate filters on.
   │ status   │
   │ renewal_ │
   │  count   │
   └──┬────┬──┘
      │ 1  │ 1
      │    └────────────┬──────────────────┐
      │                 │                  │
      │n          ┌──────┴───────┐   ┌──────┴──────────┐
┌─────┴──────┐    │ loan_renewals│   │ reservation     │
│  fines     │    │──────────────┘   │  .fulfilled_    │
│────────────│    │ UQ(loan_id,      │  loan_id        │
│ loan_id ⬜  │    │   renewal_      │  (SET NULL)     │
│ amount     │    │   number)       └─────────────────┘
│ waived_amt │    │ CHECK(new > prev)
│ status     │    └─────────────────┘
│ reference  │
│ UQ         │
└─────┬──────┘
      │ 1
      │ n
┌─────┴──────────────────┐
│    fine_payments       │   ❗ APPEND-ONLY. Void = voided_at + voided_by
│────────────────────────│      columns on the same row. Never a delete.
│ fine_id   FK  RESTRICT │      CHECK amount > 0.
│ receipt_  UQ           │      Partial unique index:
│  number                │      one OVERDUE/LATE_RETURN fine per loan.
│ amount    dec(14,2)    │
│ method                 │
│ received_by FK         │
│ voided_at / voided_by  │
└────────────────────────┘

  loan_status_history ──1──▶ loans        (append-only, trigger-protected)
  copy_status_history ──1──▶ book_copies  (append-only, trigger-protected)
```

**The load-bearing constraint.**
`uq_loan_one_open_per_copy` is what makes "two librarians scan COPY-001
simultaneously" safe. `SELECT … FOR UPDATE` gives the friendly error; this index
gives the correctness. They are not substitutes.

---

## 5. Platform

```
   users ──1──▶ notifications      (CASCADE — ephemeral)
        │
        ├──1──▶ audit_logs        (SET NULL on actor_id;
        │                           actor_email / actor_role SNAPSHOTTED so
        │                           history survives the user row;
        │                           append-only trigger + REVOKE)
        │
        └──1──▶ sync_operations   (CASCADE; client-generated PK so a replayed
                                    offline operation collapses onto one row)

   books  ──1──▶ digital_resources ──1──▶ digital_loans ──n──▶ members
            RESTRICT                    RESTRICT              RESTRICT
                                    ❗ partial unique index:
                                      one open loan per (member, resource)

   settings   standalone typed config (key UQ, value json, is_public flag)
```

---

## Cardinality summary

| Relationship                           | Cardinality      | Notes                                                                  |
| -------------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| User → Member                          | 1 : 0..1         | `members.user_id` UNIQUE. A user need not be a member (staff are not). |
| User → Role                            | n : 1            | `users.role_id`                                                        |
| Role ↔ Permission                     | n : n            | via `role_permissions`, composite PK                                   |
| User ↔ Branch                         | n : n            | via `user_branches` — the branch-scope gate                            |
| Library → Branch                       | 1 : n            | RESTRICT                                                               |
| Branch → Location → Shelf              | 1 : n each       | RESTRICT chain                                                         |
| Member → MemberType                    | n : 1            |                                                                        |
| Member → HomeBranch                    | n : 1            |                                                                        |
| Book ↔ Author                         | n : n            | via `book_authors`                                                     |
| Book ↔ Category                       | n : n            | via `book_categories`, one primary                                     |
| Book ↔ Tag                            | n : n            | via `book_tags`                                                        |
| Book → Publisher                       | n : 0..1         | RESTRICT                                                               |
| Book → BookCopy                        | 1 : n            | The intellectual work vs the physical item — never merged              |
| BookCopy → Branch/Location/Shelf       | n : 1 (n : 0..1) | A copy in transit has no location                                      |
| BookCopy → Loan                        | 1 : n over time  | **At most one open loan** (partial unique)                             |
| Member → Loan                          | 1 : n            |                                                                        |
| Member → Reservation                   | 1 : n            | **At most one open hold per title**                                    |
| Reservation → Loan                     | n : 0..1         | SET NULL — a fulfilled hold survives the loan reference                |
| Loan → Fine                            | 1 : n            | One automated overdue fine per loan; many manual fines                 |
| Fine → FinePayment                     | 1 : n            | Append-only; voids are columns                                         |
| User → Notification                    | 1 : n            | CASCADE                                                                |
| User → AuditLog                        | 1 : n            | SET NULL + snapshot                                                    |
| Book → DigitalResource                 | 1 : n            | RESTRICT                                                               |
| DigitalResource → DigitalLoan → Member | n : n            | One open loan per pair                                                 |

---

## Deletion-behaviour map

```
CASCADE  (ephemeral child, no evidentiary value)
  role_permissions · user_branches · sessions · password_reset_tokens
  email_verification_tokens · book_authors · book_categories · book_tags
  notifications · sync_operations

SET NULL  (attribution that stops mattering)
  users.primary_branch_id · user_branches.assigned_by · book.created_by
  loan.returned_by · reservation.fulfilled_loan_id · fines.waived_by
  fines.created_by · fine_payments.voided_by · audit_logs.actor_id
  settings.updated_by · digital_resources.uploaded_by · role_permissions.granted_by

RESTRICT  (anything financial, circulation-related, or evidentiary)
  users.role_id · members.user_id · members.member_type_id · members.home_branch_id
  branches.library_id · locations.branch_id · shelves.location_id
  publishers ← books · authors ← book_authors · categories ← book_categories
  categories.parent_id (self)
  book_copies.book_id/branch_id/location_id/shelf_id
  copy_status_history.copy_id
  loans.copy_id/book_id/member_id/branch_id/issued_by/member_type_id
  loan_status_history.loan_id · loan_renewals.loan_id/renewed_by
  reservations.book_id/member_id/branch_id
  fines.member_id/loan_id · fine_payments.fine_id/received_by/branch_id
  digital_resources.book_id · digital_loans.resource_id/member_id
```

**Why this matters operationally.** `REVOKE DELETE ON loans, fines, fine_payments`
in the invariants migration means the application literally cannot delete
circulation or financial history. It can only move a row to a terminal state.
That is the "historical data is never casually deleted" requirement expressed as
a privilege, not a convention.

Full column detail: [Tables](./tables.md). Constraint and index detail:
[Constraints and indexes](./constraints-and-indexes.md).
