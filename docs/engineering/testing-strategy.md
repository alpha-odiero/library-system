# Testing Strategy

What is tested, at what layer, and what each layer is for. A test that does not
prevent a specific class of defect is a cost with no return.

## Layers

| Layer         | Scope                                           | Needs a database | Share of the suite |
| ------------- | ----------------------------------------------- | :--------------: | ------------------ |
| Unit          | Pure logic in `src/lib/`                        |        no        | fast, majority     |
| Integration   | A module, real HTTP, real database              |     **yes**      | growing            |
| Contract      | Shared types, envelopes, permission registry    |        no        | small              |
| Security      | The authorization matrix and the route manifest |      partly      | mandatory          |
| Concurrency   | Two real connections racing                     |     **yes**      | mandatory          |
| Accessibility | Component and interaction checks                |        no        | growing            |

**Pure logic is unit-testable with no database, and that is the point.** `lib/dates.ts`,
`lib/money.ts`, `lib/isbn.ts`, `lib/pagination.ts`, and `lib/redact.ts` have no
framework and no Prisma dependency. They are where the subtle correctness lives —
a timezone bug and a floating-point bug are both invisible in a code review and
both expensive in production — and they are exhaustively testable in
milliseconds.

## What exists today

```
apps/backend/src/lib/          dates, money, isbn, pagination, redact, errors
apps/backend/tests/
  ├── authorization.test.ts    Gate 3 and Gate 4 behaviour
  ├── credentials.test.ts      password and credential policy
  ├── members.test.ts          member module integration
  ├── app.test.ts              envelope, health, limits
  ├── helpers.ts               bodyOf(), rawBody()
  ├── setup.ts                 unhandled-rejection guard
  └── security/route-manifest.test.ts   every route is guarded
packages/shared/src/contracts.test.ts    shared contract types
apps/frontend/src/lib/api.test.ts        API client behaviour
```

## Unit tests: the pure library

| File                     | Tests                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `lib/dates.test.ts`      | Calendar-day arithmetic, library timezone, DST, ISO serialisation, duration parsing            |
| `lib/money.test.ts`      | Decimal arithmetic, rounding at scale 2, comparison, sum, min/max, positivity assertions       |
| `lib/isbn.test.ts`       | ISBN-10 and ISBN-13 checksums, normalisation, canonicalisation, rejection of a bad check digit |
| `lib/pagination.test.ts` | Page bounds, offset computation, `MAX_PAGE_SIZE` clamping                                      |
| `lib/redact.test.ts`     | Secret redaction, header and cookie coverage                                                   |
| `lib/errors.test.ts`     | Status and code mapping for every error type                                                   |

### Cases that are worth writing down

These are the ones that catch real defects, and they are documented because the
reason a case exists is more useful than the case itself:

**`isbn.test.ts` — a bad check digit is rejected, not repaired.**

```ts
it('returns null rather than repairing a bad checksum', () => {
  expect(canonicalIsbn13('978-0-13-110362-8')).toBeNull();
});
```

`978-0-13-110362-7` is a real ISBN; `-8` differs only in the check digit. The
library must reject it. Repairing it would create the duplicate catalogue entry
the checksum exists to prevent.

> A note on this case: the fixture originally used the _invalid_ number in the
> "accepts a real number" test, so the suite failed while the implementation was
> correct. The fix was to correct the test data, never the library.

**`dates.test.ts` — a DST transition is not 86 400 000 ms.**

```ts
it('adds calendar days across a DST transition', () => {
  expect(addCalendarDays('2026-03-28', 2, 'Europe/London')).toBe('2026-03-30');
});
```

Europe/London springs forward on 29 March 2026. Two calendar days from the 28th
is the 30th; two `24 * 60 * 60 * 1000` milliseconds is the 29th. This is the
single most common date defect in a system that issues due dates.

**`dates.test.ts` — the library's today, not the server's.**

```ts
it('computes today in the library timezone, not UTC', () => {
  expect(toLibraryDate(new Date('2026-01-15T23:30:00Z'), 'Africa/Nairobi')).toBe('2026-01-16');
});
```

`Africa/Nairobi` is UTC+3, so 23:30 UTC is already the next day locally. A
member should not be overdue a day early because the server runs in UTC.

**`money.test.ts` — decimals, not floats.**

```ts
it('does not accumulate floating-point error', () => {
  expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
});
```

`0.1 + 0.2 !== 0.3` in IEEE-754. The assertion is on the string, because that is
what the wire carries.

**`money.test.ts` — a payment cannot exceed what is outstanding**, and a waiver
cannot exceed the fine. Both are boundary assertions on the exact scale that
decides whether an account is clear.

## Integration tests

A module, exercised through the **real Express app** with a **real database**:
real routes, real guards, real Zod validation, real transactions, real
constraints.

Not mocked repositories. The point is to prove the wiring — a guard attached, a
predicate in the query, a constraint firing — and a mock proves none of it.

```ts
const res = await request(app)
  .post('/api/v1/members')
  .set('Cookie', [`lms_session=${librarianToken}`])
  .set('x-csrf-token', csrf)
  .send({ firstName: 'Amina', lastName: 'Otieno', email: 'amina@example.org' });

expect(res.status).toBe(201);
```

### Isolation

Integration tests need a real database and real isolation between tests. The
setup for that is not yet in place; `tests/setup.ts` currently only guards
against unhandled rejections.

It needs:

- a **separate test database** (`lms_test`, already pointed at in CI);
- a **per-suite transaction** that is rolled back, or a truncate between tests in
  dependency order;
- **deterministic seeds** — `db:seed` is idempotent, so roles and permissions are
  available without hand-built fixtures.

CI points `DATABASE_URL` at `lms_test` while migrating `lms`, which is the right
separation: the migration is proven against a clean database, and the tests cannot
leave the migrated one dirty. Tracked in [Roadmap](../roadmap.md).

## Security tests

These are not "extra" tests. They are how the authorization model is verified.

### `authorization.test.ts` — the gates

Covers Gate 3 and Gate 4 directly:

| Area   | Asserted                                                                                                                                                                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 3 | `null` scope is every branch; a scoped principal sees only assigned branches; out-of-scope is **403, not 404**; an all-branch principal gets no `where` clause; an empty scope refuses to guess a branch                                                                                                        |
| Gate 4 | A member's query is scoped to their own record; a staff principal with **no member profile matches nothing**; staff get the unrestricted filter; another member's record is **404**; a staff caller holding a broad permission still gets 404 on an `_OWN` route; `assertCanModifyOwn` short-circuits for staff |

The last two are the interesting ones, because they encode the reasoning in
`ownership.ts`: a 403 there would leak existence _and_ point staff at the wrong
problem.

### `security/route-manifest.test.ts` — deny by default

Enumerates the mounted Express router stack and asserts that **every** path under
`/api/v1` outside `PUBLIC_ROUTES` is protected.

This is what makes deny-by-default enforced rather than stated. Adding a route
and forgetting its guard **fails the build** — it is not a review comment that
someone can acknowledge and move past.

### What each new endpoint requires

| Test                         | Assertion                        |
| ---------------------------- | -------------------------------- |
| Anonymous                    | 401                              |
| Authenticated, no permission | 403                              |
| Wrong role                   | 403                              |
| Out-of-scope branch          | 403                              |
| Not your record              | **404**                          |
| Happy path                   | 200/201                          |
| Validation failure           | 400 with the field path          |
| Error never leaks internals  | no SQL, no stack, no column name |

The **404-not-403** case is per `_OWN` route and is the one most often omitted.
It is the assertion that prevents an enumeration oracle.

## Concurrency tests

Two real connections, genuinely concurrent, asserting on **final database state**.

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

**Assert on the state, not the status codes.** A test asserting only "one returned
409" passes even if the other wrote a row it then rolled back for an unrelated
reason. The invariant is one open loan in the database.

Required cases as circulation lands:

| Case                                | Guarantee                                  |
| ----------------------------------- | ------------------------------------------ |
| Two borrows of one copy             | `uq_loan_one_open_per_copy`                |
| Two borrows past the ceiling        | `max_active_loans` not exceeded            |
| Two renewals at the ceiling         | `UNIQUE (loan_id, renewal_number)`         |
| Two fulfilments of one reservation  | `uq_reservation_position_live`             |
| Two overdue assessments of one loan | `uq_fine_one_overdue_per_loan`             |
| Two refreshes on one token          | Family revocation, exactly one new session |

## Frontend tests

`src/lib/api.test.ts` — 18 tests in four groups, all transport-level:

| Group                   | Asserts                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| credentials and caching | `credentials: 'include'` always, `cache: 'no-store'`, credentials omitted for the liveness probe only, `Accept: application/json`, the `/api/v1` prefix applied — and health outside it                                                 |
| CSRF protection         | No header on a safe method, the cookie echoed in the header on every unsafe method, a URL-encoded token decoded, a missing token failing loudly rather than sending a blank header, unrelated cookies ignored                           |
| error handling          | `ApiError` preserving the code, 401 flagged for routing to login, field-level validation details preserved, a non-JSON error body not surfaced, a malformed success envelope rejected rather than cast, 204 treated as an empty success |
| `isPaginated`           | Narrows a list response with `meta`; does not narrow a single resource                                                                                                                                                                  |

| session recovery | A single-flight refresh shared by concurrent 401s, a protected request replayed exactly once after refresh, `skipRefresh` honoured, no retry after a failed refresh, no retry on an auth endpoint, transport failure surfaced as `NetworkError` rather than treated as a 401 |

The refresh-and-retry path is covered in `apps/frontend/src/lib/api.test.ts`
(25 tests), alongside the transport cases above. `format.test.ts` covers the
money, calendar-date, instant, and relative-date helpers, including the two
conventions most likely to be broken by a well-meaning change: a calendar date
never crossing a UTC boundary, and a decimal fine string never becoming a float.

Branch reads are tested in `apps/backend/tests/branches.test.ts` at the schema and
predicate level rather than against a live database: an unknown query parameter is
rejected instead of ignored, `q` is trimmed and length-bounded, a malformed id
fails before Prisma, an all-branch scope yields `{}` while an empty scope yields an
`in: []` that matches nothing, and the scope filter composes with a caller's own
filter instead of replacing it. The route-manifest test covers the
permission gate. These are the questions worth pinning; a database test would prove
them later and prove less.

Component and route tests are **not yet present**. When they are, the priorities
are: route guards render the 403 page rather than the feature; navigation
reflects the permission list; forms show server-side validation details; and
loading and empty states announce themselves to a screen reader.

Status badges pair a colour with a word, so state is never conveyed by colour
alone. That pattern is in `components/ui/Badge.tsx` and in the loading and empty
states, which is where it should be copied from now on.

There is **no end-to-end harness**. The frontend previously carried a
`test:e2e` script pointing at Playwright, which was never installed and had no
tests or CI job; it was removed rather than left as a command that fails.

## Accessibility testing

| Level         | Tool                          | Catches                                                  |
| ------------- | ----------------------------- | -------------------------------------------------------- |
| Automated     | `axe-core` in component tests | Missing labels, contrast, landmark and heading structure |
| Keyboard      | Manual, plus focus assertions | Trap, invisible focus, wrong order                       |
| Screen reader | Manual, periodic              | Announcement, context, status changes                    |
| Automated     | Lighthouse                    | Baseline scores                                          |

**Automation catches roughly a third of real accessibility defects.** The
keyboard and screen-reader passes are not optional extras — focus management and
status announcement are where accessibility actually fails, and no automated tool
evaluates them.

## Coverage

Thresholds configured in `apps/backend/vitest.config.ts`:

| Metric     | Threshold |
| ---------- | --------- |
| Statements | 70%       |
| Branches   | 65%       |
| Functions  | 70%       |
| Lines      | 70%       |

**These are floors to catch untested files, not a target to optimise toward.**
Coverage percentage is not a measure of test quality, and chasing it produces
tests that execute lines without asserting anything.

The real questions a reviewer should ask are: does the failing path assert the
_state_ and not just the status, does an authorization test cover the negative
case, and would this test fail if the guard were removed.

`src/server.ts` is excluded because it only starts a process; type files and test
files are excluded because they contain no logic.

## Test configuration

`apps/backend/vitest.config.ts` sets the whole environment explicitly:

|             |                                                                                        |
| ----------- | -------------------------------------------------------------------------------------- |
| Environment | `NODE_ENV=test`, `LOG_LEVEL=silent`                                                    |
| Database    | `postgresql://…@localhost:5433/lms_test`                                               |
| Timezone    | `Africa/Nairobi` — an explicit non-UTC zone, so a timezone bug cannot pass by accident |
| Currency    | `KES`                                                                                  |
| Argon2      | `8192 / 1 / 1` — reduced cost for speed, **never** in production                       |
| Rate limits | effectively disabled                                                                   |
| Secrets     | fixed test-only strings                                                                |

Three of those deserve comment:

- **`TIMEZONE: 'Africa/Nairobi'`** is the most valuable line in the file. Running
  the suite in UTC would let a library-timezone bug pass everywhere and appear
  only in production.
- **Reduced Argon2 cost** is correct for test speed and is scoped to `NODE_ENV=test`
  by `env.ts`. If it were ever reachable in production, password hashing would be
  effectively disabled.
- **Rate limits disabled** so a suite is never throttled by its own volume.

## What a test must not do

| Anti-pattern                                       | Why                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| Mock the repository and assert the mock was called | Proves nothing about the query, the predicate, or the constraint |
| Assert only on a status code                       | A 409 passes while the database is wrong                         |
| Share state between tests                          | Order-dependent, fails only in CI                                |
| `expect(true).toBe(true)`                          | Costs runtime, catches nothing                                   |
| Sleep instead of waiting for a condition           | Slow and flaky                                                   |
| Mock the clock in a timezone test                  | Removes the thing under test                                     |
| Skip in CI                                         | A skipped test is worse than an absent one                       |

## Related

- [CI/CD](./cicd.md) — where these run
- [Authorization](../authorization/authorization.md) — what must be tested
- [Transactions and concurrency](../security/transactions-and-concurrency.md) — the concurrency tests
