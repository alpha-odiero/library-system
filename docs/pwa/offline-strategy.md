# Offline Strategy

What happens when a circulation transaction is attempted with no network. The
current answer is "it is refused", and this document explains why that is the
correct answer for a library — and what would have to be true to change it.

## Current state: offline writes are not supported

No circulation write is queued, retried, or replayed. A loan, return, renewal,
reservation, fine, or payment requires a live server.

The frontend is offline-capable in exactly one sense: **the app shell opens**
without a network, because `sw.js` caches it. Once a user reaches a screen that
needs data, the request fails and the failure is shown honestly.

This is a deliberate design decision, documented here so it reads as a decision
rather than a gap.

## Why caching API responses is forbidden

`/api/**` is never cached by the service worker, and must never be. See
[PWA architecture](./pwa-architecture.md#the-rule-it-exists-to-enforce).

Four reasons, each independently sufficient:

1. **Cross-member disclosure.** A shared device at a circulation desk with a
   cached `GET /api/v1/members/me` shows the previous user's loan history to
   whoever picks it up next.
2. **Resurrecting closed state.** A cached loan list shows a book as on loan after
   it has been returned. The member is told to bring back a book they already
   returned.
3. **Money that is wrong.** A stale fine balance either blocks a member who has
   paid, or invites one to be charged again.
4. **Branch scope.** A cached response computed under one branch scope is still in
   the cache when the same device is used by someone with a different scope.

None of these are fixed by a short TTL. They are fixed by not caching.

## Why queuing offline writes is a different decision

Offline _writes_ do not leak data, and for a warehouse with unreliable
connectivity they are genuinely valuable. So the question is not whether to build
them — it is what the system must be able to answer when a queued transaction
arrives after it may already have happened.

Consider a librarian in a basement archive with no signal, scanning a book back
in. They queue a RETURN. Thirty seconds later the signal returns, and three
things may have happened meanwhile:

- another terminal already processed that return;
- the member was fined for the overdue loan in the interval;
- a hold for another member was fulfilled using that copy.

The queued operation was formed against a **stale world**. Applying it
unconditionally duplicates a return and double-fines. Rejecting it leaves the
real state correct and the librarian with a queue full of work they did
themselves.

Both outcomes are bad. Which is worse depends on the library, and that is a
policy question — which is why this is deferred rather than designed.

## What the schema already provides

`sync_operations` exists, complete and unused. That is intentional: it makes the
deferred feature additive rather than a redesign, and it costs nothing while empty.

```prisma
model SyncOperation {
  id              String    @id @db.Uuid
  userId          String    @map("user_id") @db.Uuid
  deviceId        String    @map("device_id") @db.VarChar(100)
  operationType   String    @map("operation_type")   // BORROW | RETURN | RENEW | RESERVE
  payload         Json
  clientTimestamp DateTime  @map("client_timestamp")
  baseVersion     String?   @map("base_version")    // optimistic-concurrency token
  syncStatus      String    @default("PENDING")    // PENDING | SYNCING | SUCCESS | FAILED | CONFLICT
  resultId        String?   @map("result_id")
  failureCode     String?   @map("failure_code")
  failureReason   String?   @map("failure_reason")
  syncedAt        DateTime? @map("synced_at")
  createdAt       DateTime  @default(now())
}
```

Three design decisions are already encoded:

**`deviceId`** distinguishes queues per device, so a failed retry does not replay
onto a different machine.

**`baseVersion`** is the optimistic-concurrency token from the copy record when
the operation was queued. This is what makes a stale operation _detectable_
rather than silently wrong — the server compares it, and a mismatch is a
`CONFLICT` rather than a bad write. The mechanism is designed in; only the policy
for handling the conflict is undecided.

**`syncStatus = CONFLICT` is a first-class outcome**, distinct from `FAILED`. A
conflict needs a human to reconcile it; a failure is transient and retryable.
Collapsing them would mean a librarian cannot tell "try again" from "someone else
already did this".

Indexes on `(userId, syncStatus)`, `(deviceId)`, and `(syncStatus, createdAt)`
support the three queries that matter: this user's pending queue, this device's
operations, and the operations an operator must reconcile.

## What would have to be true before shipping it

Not a plan — the preconditions, so that "add offline support" cannot become a
demand that overrides them.

### 1. The database guarantees must come first

Every circulation operation already has the constraint that makes a replay
detectable:

| Operation | Guarantee                                                                 |
| --------- | ------------------------------------------------------------------------- |
| BORROW    | `uq_loan_one_open_per_copy`                                               |
| RESERVE   | `uq_reservation_one_open_per_member_book`, `uq_reservation_position_live` |
| Fine      | `uq_fine_one_overdue_per_loan`                                            |
| Renewal   | `UNIQUE (loan_id, renewal_number)`                                        |

**A duplicate becomes a `CONFLICT`, never a duplicate loan.** That is the
foundation, and it is why the constraints are built now and the client comes
later.

### 2. Every operation must be idempotent

A queued operation may be delivered more than once. Each must be safe to apply
twice, identified by the client-generated `id`:

- read `sync_operations` for an existing record with that id and return its
  stored `resultId`;
- otherwise apply, then store the result.

Without this, a network retry after a successful write is indistinguishable from
a first attempt.

### 3. Money is not queued

**Payments are never queued offline.** Recording a payment is a financial act
against a balance that must be exactly right; a queued payment arriving after
the fine was waived, adjusted, or paid elsewhere is a reconciliation incident
for a human.

Fines may be calculated offline and reconciled server-side; payments may not be
created offline. This line should not move without a finance sign-off.

### 4. Conflicts surface to a human

A `CONFLICT` needs an owner and a resolution path. That means an operations
screen listing conflicted operations with enough context — the queued payload,
the current server state, the timestamps — for someone to decide what actually
happened.

An operations screen nobody looks at is the same as silently dropping the
operation.

### 5. The audit trail stays truthful

Each operation writes its audit row when it is **applied**, with the sync
operation id recorded. An operation applied late still gets a truthful audit
entry saying it was applied late, with the client timestamp alongside the server
one.

The rule from [Business rules](../database/business-rules.md#audit-immutability)
holds unchanged: an audit row is written in the same transaction as the action.

## The model, when it is built

```
  PENDING ──────► SYNCING ──────┬──► SUCCESS    resultId recorded
     │              │            │
     │              │            └──► CONFLICT   baseVersion mismatch
     │              │                        → operator reconciles
     │              └──► PENDING (retryable failure: network, 5xx, lock timeout)
     │
     └──► FAILED   permanent rejection: business rule violated
                 (member blocked, copy unavailable, ceiling reached)
```

**`FAILED` and `CONFLICT` are terminal** and require a human. `PENDING` and
`SYNCING` are the machine's problem.

Retry policy is bounded and backoff-jittered. An operation is never retried
indefinitely: a `PENDING` row older than a configured window is escalated to
`FAILED` so the queue cannot grow silently.

Validation order on the server matters: **business rules first, then
concurrency.** A queued borrow whose member has since hit their loan ceiling is
`FAILED` with a clear reason, not `CONFLICT` with a version mismatch. The user
needs "this member now has 3 loans" rather than "the record changed".

## What the client would do

| Concern              | Approach                                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| Queue storage        | IndexedDB, not `localStorage` — async, transactional, not size-limited to ~5 MB |
| Queue identity       | Client-minted UUID for `sync_operations.id`                                     |
| Precondition capture | `baseVersion` from the copy record at scan time                                 |
| Ordering             | Per-copy FIFO; operations on different copies may run in any order              |
| Idempotency key      | `sync_operations.id`, sent as `Idempotency-Key`                                 |
| User feedback        | "Queued — will sync when you are back online", with a visible queue count       |
| Conflict UX          | Name the conflict and the current state; never silently drop                    |

The user-facing requirement is that **a queued operation is always visible and
never silently lost.** A librarian who scans a book and sees nothing must be able
to find the operation.

## Why the answer is "no" for V1

| Factor               | Assessment                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Data value           | A circulation write is correct only against a live view of copy state, loans, and member standing |
| Frequency            | Most branches have connectivity; the failure mode is concentrated in basements and archives       |
| Wrong-write cost     | High — duplicate loans, double fines, incorrect holds                                             |
| Mitigation available | Strong: constraints make replays detectable rather than harmful                                   |
| Complexity           | Substantial: idempotency, conflict UI, an operations queue, and a policy for who resolves what    |
| Already available    | The schema, the constraints, and the UUID keys that make it safe                                  |

Deferring costs almost nothing today — the table exists, the constraints exist,
and the client UUID convention is already in use. Building it prematurely would
cost a conflict-resolution policy nobody has agreed on, and would put a
synchronisation layer in front of circulation code that has not been written yet.

When a library tells us its branches cannot use the system without it, the
preconditions above are already met and the work is additive.

## Related

- [PWA architecture](./pwa-architecture.md) — installability and the cache rules
- [Transactions and concurrency](../security/transactions-and-concurrency.md) — the guarantees a replay relies on
- [Roadmap](../roadmap.md) — when this is revisited
