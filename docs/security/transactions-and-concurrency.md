# Transactions and Concurrency

Where atomicity is owned, which isolation level each operation needs, and the
pattern for circulation under concurrent scanning.

## The rules

1. **Services open transactions. Repositories never do.** A repository that
   opens its own transaction cannot compose with another, and the layer boundary
   becomes conditional.
2. **A transaction boundary is a business decision.** It goes where "these either
   all happen or none do" is meaningful — issuing a loan, taking a payment.
3. **Checks happen inside the transaction, not before it.** A check before the
   transaction is a race waiting for a second user.
4. **Correctness that must hold under any number of concurrent connections lives
   in the database**, as a partial unique index or a `CHECK` constraint.

Rules 3 and 4 are the ones that get violated by accident, because a
check-then-act implementation reads perfectly well.

## `withTransaction`

`config/database.ts`:

```ts
export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number; // 10_000
    timeout?: number; // 20_000
    isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  },
): Promise<T>;
```

`maxWait` and `timeout` are set **explicitly**, and the reason is the important
part: Prisma's default transaction timeout is 5 seconds, and a contended row lock
surfaces as a timeout rather than a queue. With a 10 s acquisition window and a
20 s execution budget, a briefly-contended lock waits; a genuinely deadlocked one
fails as a lock timeout, which the error handler can report as a retryable 409
instead of an opaque 500.

### Which isolation level for which operation

| Operation                                               | Level                                            | Why                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Single-row read, no write                               | `ReadCommitted` (default)                        | PostgreSQL's default is correct                                                          |
| Loan issue, return, renewal                             | `ReadCommitted` **+ partial unique index**       | The index gives the guarantee; `Serializable` would add retry storms for no extra safety |
| Reservation queue position                              | `ReadCommitted` + partial unique index           | Same                                                                                     |
| Fine assessment                                         | `ReadCommitted` + `uq_fine_one_overdue_per_loan` | Same                                                                                     |
| Balance-changing operations (`Serializable` candidates) | `Serializable`                                   | Only if a read must not change under a concurrent write                                  |
| Reports, exports, search                                | `ReadCommitted`                                  | Slight staleness is acceptable and desirable for throughput                              |

**Default to `ReadCommitted` and add a constraint.** Serializable isolation is
the intuitive answer and the wrong default: it converts a lost update into a
serialization failure that the caller must retry, and a library with several
lending terminals produces those failures regularly. A partial unique index
produces the same correctness with no retries — the loser gets a constraint
violation, which is deterministic and reportable.

Reach for `Serializable` only when a **read** must not change underneath a
concurrent write and no constraint can express it.

### Retrying a serialization failure

With `Serializable`, a caller must retry on `40001`/`40P01`. With the default
level plus an index, a constraint violation is a real conflict the user needs to
know about, not a transient failure to retry blindly. Retry only the former, with
a bounded attempt count and jittered backoff.

## The check-then-act race

The canonical example, and the reason rule 3 exists:

```ts
// ✗ WRONG — two staff terminals both pass the ceiling check
const active = await prisma.loan.count({
  where: { memberId, returnedAt: null },
});
if (active >= memberType.maxActiveLoans) throw forbidden();

await prisma.loan.create({ data: { … } });
```

Between the `count` and the `create`, the other terminal's transaction commits.
Both requests saw `active = 2` against a limit of 3, and the member ends with 4
loans.

```ts
// ✓ RIGHT — the check is inside the transaction
await withTransaction(async (tx) => {
  const active = await tx.loan.count({ where: { memberId, returnedAt: null } });
  if (active >= memberType.maxActiveLoans) throw forbidden();

  const copy = await tx.bookCopy.findFirst({ where: { bookId, status: 'AVAILABLE' } });
  if (!copy) throw conflict('No copy of this title is available');

  await tx.bookCopy.update({
    where: { id: copy.id, status: 'AVAILABLE' },   // ← conditional
    data: { status: 'BORROWED' },
  });
  await tx.loan.create({ data: { … } });
  await tx.loanStatusHistory.create({ data: { … } });
  await tx.auditLog.create({ data: { … } });
});
```

The count and the write share one snapshot, so no third party can insert between
them.

## Circulation under concurrent scanning

This is the system's hardest concurrency problem and it has three simultaneous
requests for the same book. The guarantee: **exactly one loan succeeds.**

### The pattern

1. **Begin the transaction.**
2. **Re-read state inside it.** Never trust a value read before the transaction
   opened.
3. **Claim the copy conditionally.** `updateMany({ where: { id, status:
'AVAILABLE' } })`. If `count !== 1`, another transaction won — return 409.
4. **Insert the loan.** The partial unique index is the backstop.
5. **Write history and audit** in the same transaction.
6. **Commit.**

### Why conditional updates rather than read-then-write

```ts
const copy = await tx.bookCopy.findUnique({ where: { id } });
if (copy.status !== 'AVAILABLE') throw conflict();
await tx.bookCopy.update({ where: { id }, data: { status: 'BORROWED' } });
```

Two transactions both read `AVAILABLE` and both write `BORROWED`. Both succeed.
The check is separated from the write by an arbitrary amount of time.

```ts
const { count } = await tx.bookCopy.updateMany({
  where: { id, status: 'AVAILABLE' },
  data: { status: 'BORROWED' },
});
if (count !== 1) throw conflict('This copy was just issued to another member');
```

The predicate is part of the write. PostgreSQL evaluates it against the row
version it is about to update, and exactly one transaction can win. `updateMany`
rather than `update` because `update` would throw on a missing row but gives no
count.

This is the same `count === 1` idiom already used in `rotateRefreshToken()`, and
for the same reason.

### Row locking, and when to reach for it

`SELECT … FOR UPDATE` serialises transactions on a row, which gives a good error
message — "this loan was just renewed" — instead of a constraint violation. It is
worth using where a **friendly conflict** matters and the lock scope is known
narrowly:

| Operation              | Lock target                        | Reason                                                                    |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| Renewal                | the open loan row                  | The user should be told "already renewed", not "unique constraint failed" |
| Return                 | the open loan row                  | Two returns of one loan should report one conflict                        |
| Reservation fulfilment | the reservation row + the copy row | Queue position and copy assignment must move together                     |

Row locking is **not** a substitute for a unique index. It cannot express
"exactly one open loan per copy across the whole table" — only that these
particular two transactions conflicted. The index is the invariant; the lock is
ergonomics.

Lock ordering must be consistent (always loan before copy, never the reverse) or
two transactions can deadlock. Deadlocks surface as `40P01` and must be retried
with bounded backoff.

### The guarantees the database provides

| Guarantee                                     | Mechanism                                                       |
| --------------------------------------------- | --------------------------------------------------------------- |
| One open loan per copy                        | `uq_loan_one_open_per_copy` — partial unique                    |
| One live hold per member per title            | `uq_reservation_one_open_per_member_book` — partial unique      |
| Unique queue position among live holds        | `uq_reservation_position_live` — partial unique                 |
| One overdue fine per loan                     | `uq_fine_one_overdue_per_loan` — partial unique                 |
| One open digital loan per member per resource | `uq_digital_loan_one_open_per_member_resource` — partial unique |
| One primary category per book                 | `uq_book_one_primary_category` — partial unique                 |
| A renewal always extends the due date         | `ck_renewal_extends_due_date` — `CHECK`                         |
| Money is non-negative                         | `ck_fines_non_negative`, `ck_payment_positive` — `CHECK`        |

These cannot be raced by any number of connections, from any code path, including
a hand-run script. That is why they exist and why a service-level "check" is never
the answer.

## Idempotency

Retries, double-taps, and flaky networks produce the same request twice. Two
mechanisms:

**Idempotent by construction.** `revokeSession()` uses
`updateMany({ where: { id, revokedAt: null } })` and treats `count === 0` as
success — logging out twice is not an error.

**Idempotency keys.** For genuinely non-idempotent financial operations, an
`Idempotency-Key` header is recorded with the operation and its result; a repeat
returns the original outcome. Applies to `POST /payments` in particular: a member
tapping "Pay" twice must not create two payments. Tracked in
[Roadmap](../roadmap.md).

## Transaction boundaries by operation

| Operation          | One transaction covering                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Issue loan         | re-read member + type, count active loans, check fines, claim copy, create loan, history, audit         |
| Return loan        | claim loan, compute overdue days, assess fine, update copy status, resolve reservations, history, audit |
| Renew loan         | lock loan, check renewal ceiling, check reservations, extend due date, ledger row, history, audit       |
| Fulfil reservation | lock reservation, claim copy, mark ready/fulfilled, update queue positions, create loan, audit          |
| Take payment       | lock fine, verify amount ≤ outstanding, insert payment, update fine balance, receipt number, audit      |
| Waive fine         | lock fine, verify reason present, record waived amount and actor, audit                                 |
| Register member    | create user, create member, assign membership number, member-type validation, audit                     |
| Create member type | validate policy coherence, persist, audit                                                               |

In each case the audit row is inside the same transaction as the action, so a
committed change always has its evidence and a rolled-back change never leaves an
orphan record.

## Deadlocks and retries

| Cause                                   | Handling                                              |
| --------------------------------------- | ----------------------------------------------------- |
| Inconsistent lock order                 | Fix by ordering — always acquire in the same sequence |
| `40P01` deadlock                        | Retry, bounded attempts, jittered backoff             |
| `40001` serialization failure           | Retry, bounded attempts, jittered backoff             |
| `40P01`/`40001` after retries exhausted | 409 with `retryable: true`, never a 500               |
| Lock acquisition timeout                | 409 `CONFLICT`, not a hang                            |
| Unique violation                        | A real conflict. Report it; do not retry              |

A unique violation is **not** a transient failure. Retrying it wastes time and
hides a genuine business conflict — two people cannot both borrow the same copy,
and telling the second one "try again" will simply fail again.

## Testing concurrency

Moot, and therefore the point:

```ts
it('issues exactly one loan when two staff scan the same copy', async () => {
  const results = await Promise.allSettled([
    issueLoan(adminToken, memberId, copyId),
    issueLoan(librarianToken, memberId, copyId),
  ]);

  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await prisma.loan.count({ where: { copyId, returnedAt: null } })).toBe(1);
});
```

Both calls are genuinely concurrent, on separate connections, through the real
service layer. The assertion is on the **final database state**, not on the
status codes — because a test that only asserts "one returned 409" passes even if
the other one wrote a row it then rolled back for unrelated reasons.

The same shape covers: two renewals against the renewal ceiling, two fulfilment
attempts on one reservation, and two overdue assessments on one loan.

## Optimistic concurrency for user-facing edits

Row locks protect circulation invariants. For ordinary edits — a member's phone
number, a book's description — a `version` column and a conditional update is
better: no held locks, and the caller is told "someone else changed this" instead
of silently overwriting.

```ts
const { count } = await tx.book.updateMany({
  where: { id, version: expectedVersion },
  data: { description, version: { increment: 1 } },
});
if (count !== 1) throw conflict('This record was changed by someone else');
```

Cheaper, more informative, and it cannot deadlock.

## Anti-patterns

| Anti-pattern                                 | Why it is wrong                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Check, then act, in separate statements      | The race, every time                                                                    |
| `findUnique` then compare in JS              | The row is already read; also leaks existence                                           |
| Transaction per repository call              | Cannot compose two writes atomically                                                    |
| `Serializable` as a blanket default          | Converts lost updates into retry storms                                                 |
| Relying on the service to enforce uniqueness | One script, one migration, one missed path                                              |
| Catching the unique violation and retrying   | It is a business conflict, not a flake                                                  |
| Nested `withTransaction`                     | The inner one is not the outer's transaction; the illusion is worse than no transaction |
| `Promise.all` over writes to the same rows   | Unpredictable lock order, deadlock-prone                                                |

**Nested transactions are the subtle one.** Prisma's interactive transactions do
not nest; an inner `withTransaction` opens a second real transaction on a second
connection and can deadlock against its own parent. If a service needs two units
of work, the caller opens one transaction and passes `tx` down.

## Related

- [Business rules](../database/business-rules.md) — the rules and where each is enforced
- [Constraints and indexes](../database/constraints-and-indexes.md) — the index rationale
- [Testing strategy](../engineering/testing-strategy.md) — how concurrency is tested
- [Architecture](../architecture.md#layering-rules) — why services own transactions
