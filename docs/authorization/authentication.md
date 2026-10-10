# Authentication

Gate 1: proving who the caller is. Everything downstream — permissions, branch
scope, ownership — is meaningless without it.

Implementation: `middleware/authenticate.ts`,
`modules/auth/token.service.ts`, `modules/auth/session.service.ts`.

## Credentials

|                   | Access token              | Refresh token                    |
| ----------------- | ------------------------- | -------------------------------- |
| Form              | JWT                       | 256-bit opaque random, base64url |
| Default lifetime  | 15 minutes                | 30 days                          |
| Storage           | HttpOnly cookie           | HttpOnly cookie                  |
| Server-side state | Session row must be live  | Session row, by hashed token     |
| Purpose           | Carries every request     | Mints a new access token         |
| Revocable         | Yes — via the session row | Yes — directly                   |

### Why an opaque refresh token rather than a JWT

A refresh token is a long-lived bearer credential checked once every 15 minutes.
Storing it as a JWT means there is nothing to revoke, so logout-everywhere has no
mechanism and theft is undetectable until expiry.

An opaque 256-bit CSPRNG token is checked against a database row on every use,
which buys:

- **Immediate revocation.** `revoked_at` is authoritative; the next request fails.
- **Session listing and per-session revocation** as a real feature.
- **Replay detection** via rotation and families.

### Why SHA-256 for the stored hash

The refresh token is 32 bytes from a CSPRNG. There is no dictionary to attack and
no keyspace small enough to brute-force — a SHA-256 digest is preimage-resistant
by construction. Argon2 would add latency on a hot path and buy nothing.

Passwords are the opposite case: low-entropy, human-chosen, and worth guessing —
so they get Argon2id.

A database disclosure therefore yields no usable credential for either scheme.

### Why `JWT_REFRESH_SECRET` exists

Even with an opaque refresh token, `JWT_SECRET` and `JWT_REFRESH_SECRET` are
separate and `env.ts` **refuses to start if they are equal**. Separating signing
keys means a compromise of the access-token signing path does not also authorise
refresh-token traffic, and an operator cannot accidentally ship one secret for
both by copy-paste.

## The access token

JWT, HS256, carrying `sub`, `email`, `roleCode`, `sessionId`, `branchScope`,
`memberId`, `iat`, `exp`, and a 12-byte random `jti`.

### `jti` is there to be audited, not to be trusted

`jti` makes a token individually identifiable in the logs and in an incident
report — "find every request made with this token". It is **not** a revocation
list; revocation happens against the session row, so `jti` never becomes a
unbounded set that must be checked on every request.

### Short TTL is what makes revocation work

`env.ts` refuses an `ACCESS_TOKEN_TTL` longer than 60 minutes, with the reason
stated in the error: a long-lived access token makes database-backed revocation
meaningless, because a stolen token stays valid until it expires regardless of
what the session table says. Fifteen minutes bounds the exposure of a leaked
token to the session-check interval.

### The session is checked on every request

The token's signature proves it was _issued_ by this system. It does not prove it
is still _valid_. `resolveLiveSession()` loads the session row and returns `null`
if it is revoked or expired.

This costs one indexed lookup per request and buys immediate revocation. That
trade is the right way round for a system where an administrator must be able to
terminate a session and know it worked.

`revokeSession()` is a no-op when the session is already revoked, with the
reason recorded in a comment: logout is idempotent, and an `update` on an
already-revoked row would overwrite the reason a previous reuse detection
recorded.

## Rotation, families, and reuse detection

The single most important property of the refresh flow.

```
  t0        t1                    t2                    t3
  login     refresh               refresh               refresh
  ├─ family F, session S1        ├─ S1 REVOKED          ├─ S2 REVOKED
  │           S2 issued           │  S2 issued           │  S3 issued
  │                                │
  └──────── attacker replays S1 ───┘
                                     ↓
                        whole family F REVOKED
                        both parties logged out
```

`rotateRefreshToken()`:

1. Hashes the presented token and looks up the session, **including revoked
   ones**.
2. If `revoked_at` is set, this token has already been rotated. That is either a
   replay or a theft, and the two are indistinguishable — so it revokes the
   **entire family** and returns `SESSION_REVOKED`.
3. Otherwise, marks the current session `ROTATED` **conditionally**:
   `updateMany({ where: { id, revokedAt: null } })`. If the count is not 1,
   another request rotated it first, and the caller gets the same reuse error.
   The conditional is what makes rotation safe under concurrency.
4. Creates a new session in the same family and returns a new refresh token.

**Step 3 is the load-bearing detail.** Without the `revokedAt: null` condition,
two concurrent refreshes both read a live session and both mint tokens, producing
a legitimate second session that reuse detection can never see.

### The cost of reuse detection, stated honestly

A user who opens the app in two tabs and refreshes at the same moment can trigger
family revocation and be logged out of both. This is a deliberate choice: the
alternative — tolerating a possible replay — means a stolen token is
indistinguishable from a fast user. The frontend serialises refreshes through a
single in-flight promise to avoid the common case, and the user re-authenticates
in the rare case that slips through.

### `family_id` is lineage

Each rotation creates a **new row** rather than updating in place, and
`family_id` links the chain. This preserves the history needed to answer "how
many times was this session refreshed, and when did it start" — and it means a
revoke is a set operation on the lineage rather than a guess.

## One-time tokens

Password reset and email verification use the same shape:
`generateOneTimeToken()` returns `{ token, tokenHash }` — the raw value is
returned to the caller once, and only the SHA-256 hash is stored. Consumption is
a `burnOneTimeTokenCycles()` routine, so a token cannot be spent twice.

## Passwords

**Argon2id at the OWASP baseline**, sourced from config so it can be tuned per
environment:

| Parameter   | Default             | Env                  |
| ----------- | ------------------- | -------------------- |
| Memory cost | 19 MiB (19,456 KiB) | `ARGON2_MEMORY_COST` |
| Time cost   | 2                   | `ARGON2_TIME_COST`   |
| Parallelism | 1                   | `ARGON2_PARALLELISM` |

Why Argon2id over bcrypt:

- **Memory-hard.** bcrypt is GPU-friendly; Argon2id's cost is in memory
  bandwidth, which is what commodity GPUs are worst at.
- **No 72-byte input limit**, so bcrypt silently truncates long passphrases —
  two different passphrases sharing a 72-byte prefix would authenticate each
  other.
- **OWASP's current first recommendation.**

`argon2id` is imported as a _number_ in this library, not a hashing function.
Getting that import wrong compiles cleanly and fails at runtime, so the import is
deliberate and commented.

### Policy

`PASSWORD_POLICY` in `config/constants.ts`, enforced by
`validatePasswordStrength()` in `modules/auth/password.service.ts` and covered by
`credentials.test.ts`:

| Rule              | Value                                  | Why                                                                                                                                               |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimum length    | 12                                     | Length is the property that actually resists guessing                                                                                             |
| Maximum length    | 128                                    | Argon2 has no ceiling, so an unbounded input is a memory-exhaustion primitive — hashing a 10 MB "password" costs ~10 MB per attempt               |
| Character classes | lowercase + uppercase + digit required | A middle path: NIST SP 800-63B advises against composition rules, but the library's policy takes them without a "must look like a password" regex |
| Denylist          | `COMMON_DENYLIST`, exact **and** stem  | See below                                                                                                                                         |
| Reuse             | Rejected against the current password  | The single most effective defence after a stuffing attempt has already succeeded                                                                  |
| Cost drift        | `needsRehash()` on login               | Re-hash on a successful login when the stored digest used weaker parameters                                                                       |

`validatePasswordStrength()` throws with **every** failure at once, so the client
shows all problems in one round trip rather than one per attempt.

Password strength feedback is safe only because it is computed server-side. A
client-side strength meter is trivially bypassed and creates the false
impression that a check exists.

### The stem check, and why exact match is nearly useless here

With a 12-character minimum, most conventional denylist entries (`password123`,
`trustno1`, `qwerty123`) never reach the list — the length rule already refuses
them. The check that matters is the **stem**: the password with every
non-letter stripped.

The dominant real-world pattern is a dictionary word with digits and symbols
appended, because that is precisely what every "add a special character" rule
teaches users to produce: `password123456!`, `Dragon1`, `qwerty2024`.
`P@ssw0rd` reduces to `psswrd`; `password123456!` reduces to `password`. One
lookup catches the whole family.

The cost is a false positive or two — `Sunshine#2026` reduces to `sunshine` and is
refused. That is the intended trade: the user picks another passphrase, versus
accepting every word-plus-digits mutation of a known leaked password.

**Known limitation, stated plainly:** the set is 23 entries. A production
deployment should replace it with a breach corpus loaded at boot and reject any
value present in a breach database. `isCommonPassword()` cannot do that today
because it must stay synchronous and offline-testable, and the system has no
outbound dependency on a breach API.

### Argon2 verification returns false, never throws

`verifyPassword()` catches every failure and returns `false`. Distinguishing "no
such user" from "wrong password" in the error would turn login into an account
enumeration oracle, because the timings differ even when the messages do not.

### Timing equalisation on unknown accounts

```ts
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$…';

export async function burnVerificationCycles(): Promise<void> { … }
```

A request for an unknown email would otherwise return in ~1 ms while a real
account costs a 19 MiB Argon2 allocation — a remote, reliable enumeration signal
with no error message required. Spending the same work on both paths removes the
signal. The elapsed work is the point; the result is discarded.

Plaintext passwords are never stored, logged, or returned. Redaction happens in
`lib/redact.ts` and is applied to the logger, so a new field added to a user
object cannot leak by omission.

`invalidCredentials()` returns one message, one code, one status. Every
unauthenticateable path — unknown email, wrong password, deleted account,
unverified email — goes through it.

## Cookies

| Attribute  | Value                     | Why                                                                                 |
| ---------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `HttpOnly` | on both credentials       | JavaScript cannot read them, so XSS cannot exfiltrate them                          |
| `SameSite` | `Lax`                     | Sends on top-level navigation, not cross-site POST — the first line of CSRF defence |
| `Secure`   | required in production    | `env.ts` fails startup otherwise                                                    |
| `Domain`   | `COOKIE_DOMAIN`, optional | Omitted by default: host-only is both the default and the safer behaviour           |

Names and paths come from `COOKIE_NAMES` and `COOKIE_PATHS` in
`config/constants.ts`:

| Cookie  | Name          | `Path`         | `HttpOnly` |
| ------- | ------------- | -------------- | :--------: |
| Access  | `lms_session` | `/`            |    yes     |
| Refresh | `lms_refresh` | `/api/v1/auth` |    yes     |
| CSRF    | `lms_csrf`    | `/`            |   **no**   |

Two deliberate asymmetries:

- **The access cookie is path `/`, not `/api/v1/auth`.** It authenticates every
  API request, not just the auth endpoints. Scoping it to `/auth` would have
  stopped it reaching the handlers that need it.
- **The refresh cookie is scoped to `/api/v1/auth`.** It is only ever presented
  to the refresh endpoint, so narrowing its path removes it from every other
  request — including logs and error reports that record request headers.

The CSRF cookie is deliberately **not** `HttpOnly`: the client must read it and
echo it in a header.

`env.ts` prints a startup warning when `COOKIE_SECURE` is false and **refuses to
start** in production. `clearAuthCookies()` clears each cookie with the same
`path` it was set with, because a cookie cannot be cleared from a different path.

## CSRF

Cookies are sent automatically by the browser, so every state-changing request
carries the caller's credentials whether or not the frontend intended it. The
defence is **double-submit**:

1. `GET /api/v1/auth/csrf` returns `{ csrfToken }` and sets the readable `lms_csrf`
   cookie. Login also sets it.
2. The client reads the cookie and sends it as `x-csrf-token`.
3. `verifyCsrf()` requires cookie and header to match on every
   `POST`/`PUT`/`PATCH`/`DELETE`.

`GET`/`HEAD`/`OPTIONS` are exempt, because they are safe by definition and must
not mutate state — exempting them is what lets a bookmarked `GET` work at all.
Anything that mutates still needs a token.

Names are configurable (`CSRF_COOKIE_NAME`, `CSRF_HEADER_NAME`) so the defaults
can change without touching the middleware.

An attacker on another origin can cause the cookie to be sent but **cannot read
it**, so cannot produce a matching header. `SameSite=Lax` is the second layer;
double-submit is the one that does not depend on browser behaviour.

Comparison is constant-time.

## Rate limiting

`middleware/rate-limit.ts`, on `express-rate-limit`. **Four tiers**, because one
global limit is either too tight for the catalogue or too loose for
authentication:

| Tier              | Default                               | Key              | Purpose                                           |
| ----------------- | ------------------------------------- | ---------------- | ------------------------------------------------- |
| `globalRateLimit` | `RATE_LIMIT_MAX` (300) per 15 min     | IP               | Volumetric abuse against the process              |
| `authRateLimit`   | `AUTH_RATE_LIMIT_MAX` (10) per 15 min | IP **+** email   | Credential attacks                                |
| `writeRateLimit`  | max(30, global/5) per 15 min          | user id, else IP | A compromised session cannot bulk-publish         |
| `exportRateLimit` | 20 per 15 min                         | user id, else IP | Report generation is the most expensive read path |

Details that matter:

- **`/health` and `/ready` are skipped** by the global limiter, so a monitoring
  probe cannot exhaust the budget and produce a false outage.
- **IPv6 keys use `ipKeyGenerator`**, which normalises to a /64 subnet. Keying on
  the raw address would let one host rotate its own address space to reset its
  counter.
- **The auth limiter uses `skipSuccessfulRequests`.** Only failures consume
  budget, so a legitimate user who signs in repeatedly is never penalised, while
  a spray of failures still exhausts it.
- **The auth key is lower-cased and capped at 120 characters**, so `A@x.com` and
  `a@x.com` share one budget and a 10 MB string cannot inflate the key store. The
  unvalidated body is re-narrowed from `unknown` before use.
- **Write and export limiters key on the authenticated user** where available, so
  users behind shared NAT egress do not consume each other's budget.
- **All limiters are disabled under `NODE_ENV=test`**, so a suite is never
  throttled by its own volume.

429 responses set `Retry-After` and return the standard error envelope.

**These numbers are deliberately loose.** They guard against runaway clients, not
determined attackers. The primary control against guessing is that Argon2id makes
each attempt cost 19 MiB of memory and ~50 ms, so an unthrottled attacker still
needs a prohibitively long time. Rate limits are a force multiplier on that, not
the defence itself.

### A known limitation: per-process counters

`express-rate-limit`'s default store is in-memory, so limits are **per instance**.
Behind two replicas behind a load balancer, an attacker gets twice the budget by
distributing requests across them.

That is an accepted V1 trade: it weakens the guard against volumetric abuse while
leaving the actual authentication cost intact. A shared store is the fix when a
multi-instance deployment makes the gap material — recorded in
[Roadmap](../roadmap.md), not silently ignored.

## Logout

| Action             | Effect                                           |
| ------------------ | ------------------------------------------------ |
| `POST /logout`     | Revokes the current session, clears both cookies |
| `POST /logout-all` | Revokes every live session for the user          |

Both are idempotent. `revokeAllForUser()` is also called on password change,
password reset, and deactivation — changing a password must log out every other
device, or the point of changing it is lost.

Revoked session rows are retained for 30 days by `purgeStaleSessions()`
(`SESSION_PURGE_CRON`) rather than deleted immediately, so a replay within the
window is still detected as a replay.

## Session listing

`GET /auth/sessions` returns live, unexpired sessions so a user can spot a device
they do not recognise. Each entry carries `id`, `current`, `ip`, `userAgent`,
`createdAt`, `lastUsedAt`, and `expiresAt`.

The raw token is never returned — only its SHA-256 hash is stored, and that is
not in this projection.

## What `GET /auth/me` returns

```json
{
  "userId": "…",
  "email": "…",
  "roleCode": "LIBRARIAN",
  "memberId": null,
  "permissions": ["LOAN_CREATE", "LOAN_VIEW", "…"],
  "branchScope": ["…", "…"],
  "sessionId": "…"
}
```

The permission list drives frontend navigation gating — and frontend gating is
**UX only**. The backend resolves permissions from the database on every request
and never trusts this response. See
[Authorization](./authorization.md#frontend-visibility-is-not-security).

`branchScope: null` is preserved rather than collapsed to `[]`, because `null` is
what enables a branch picker to show every branch; collapsing it would silently
turn an all-branch administrator into a no-branch user.

Note the omissions: no `passwordHash`, no `refreshTokenHash`. The response is
built from `AuthPrincipal` rather than from the database `User` row, so the safe
shape is the default and leaking a hash would require adding the field to the
principal — not merely forgetting to redact it. `PublicUserDto` in
`packages/shared/src/api.ts` covers the separate staff-directory shape for the
same reason.

## Configuration reference

| Variable                 | Default        | Notes                                                        |
| ------------------------ | -------------- | ------------------------------------------------------------ |
| `JWT_SECRET`             | —              | **required**, ≥ 32 characters                                |
| `JWT_REFRESH_SECRET`     | —              | **required**, ≥ 32 characters, must differ from `JWT_SECRET` |
| `ACCESS_TOKEN_TTL`       | `15m`          | ≤ 60 minutes, enforced                                       |
| `REFRESH_TOKEN_TTL_DAYS` | 30             | 1–365                                                        |
| `ARGON2_MEMORY_COST`     | 19456          | KiB                                                          |
| `ARGON2_TIME_COST`       | 2              |                                                              |
| `ARGON2_PARALLELISM`     | 1              |                                                              |
| `RATE_LIMIT_MAX`         | 300            | per window, per IP                                           |
| `RATE_LIMIT_WINDOW_MS`   | 900000         | 15 minutes                                                   |
| `AUTH_RATE_LIMIT_MAX`    | 10             | per window, per IP                                           |
| `COOKIE_SECURE`          | `false`        | must be `true` in production                                 |
| `COOKIE_DOMAIN`          | unset          | host-only by default                                         |
| `CSRF_COOKIE_NAME`       | `lms_csrf`     |                                                              |
| `CSRF_HEADER_NAME`       | `x-csrf-token` |                                                              |

Every one is validated by a Zod schema at import time. A missing or malformed
value **fails startup** rather than defaulting into an insecure state, and the
secrets are printed raw to stderr as an operator-facing message so nobody has to
guess whether they loaded.

## Authentication is necessary, not sufficient

A valid session proves _who_. It says nothing about _what they may do_. That is
Gates 2, 3, and 4 — see [Authorization](./authorization.md).

The most common real-world defect is not a broken login. It is a valid session
on a route with no permission check, which is why
`security/route-manifest.test.ts` walks the router and fails the build when a
route is added without a guard.
