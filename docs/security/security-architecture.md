# Security Architecture

The controls, where each one lives, and what it defends against. Gate-by-gate
authorization detail lives in
[Authorization](../authorization/authorization.md); this page is the wider model.

## Threat model

| Adversary               | Capability                            | Primary controls                                                                              |
| ----------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Anonymous internet user | Any request they like                 | Deny by default, rate limits, Argon2 cost, CSRF, Helmet, CORS allowlist                       |
| Authenticated member    | A valid session for their own account | Gate 4 ownership predicates, 404-not-403, `_OWN` grants                                       |
| Authenticated librarian | Valid session, broad permissions      | Gate 3 branch scope, no `AUDIT_VIEW`, no `SETTINGS_UPDATE`                                    |
| Compromised session     | Everything the victim can do          | 15-minute access TTL, DB-checked sessions, write/export limiters, audit trail                 |
| Stolen refresh token    | A long-lived bearer credential        | Rotation with reuse detection, family revocation, 404-equivalent failure                      |
| SQL injection           | Arbitrary input on any parameter      | Prisma parameterisation, Zod validation, `REVOKE` on the app role                             |
| XSS                     | Script execution in the origin        | HttpOnly cookies, no `innerHTML` for user data, CSP                                           |
| Malicious insider       | Legitimate access plus intent         | Append-only audit log, no librarian access to audit, four-eyes on `FINE_WAIVE`/`PAYMENT_VOID` |
| Database reader         | The contents of every table           | Hashed passwords, hashed refresh tokens, append-only history                                  |

## Defence in depth

```
  Transport       TLS everywhere; Secure cookies; BREACH-mitigated compression
  ─────────────────────────────────────────────────────────────────────────
  Edge            Helmet headers, explicit CORS allowlist, body size limits
  ─────────────────────────────────────────────────────────────────────────
  Application     rate limits → CSRF → auth → permission → scope → ownership
                  → Zod validation → business rules → typed queries
  ─────────────────────────────────────────────────────────────────────────
  Data            CHECK constraints, partial unique indexes, append-only
                  triggers, REVOKE DELETE, Decimal money, UUID keys
  ─────────────────────────────────────────────────────────────────────────
  Evidence        audit_logs written in the same transaction, immutable
```

The principle: **each layer must be sufficient on its own.** A SQL injection that
succeeds still cannot update an audit row. A missing `WHERE` clause still cannot
delete a payment.

## Transport

TLS is terminated at the proxy. The application sets `Secure` on cookies and
`env.ts` refuses to start in production without it.

**Compression is disabled on authenticated API responses.** BREACH exploits the
fact that compressing a response mixing secrets with attacker-controlled input
leaks information through response size. `app.ts` skips compression whenever a
cookie or `Authorization` header is present on an `/api` path, so the attack has
no oracle.

`app.set('trust proxy', 1)` makes `req.ip` the client's address behind exactly one
proxy. This is load-bearing: the rate limiter keys on `req.ip`, so an incorrect
trust setting means every request appears to come from the proxy and the limiter
becomes global rather than per-client. **Changing the topology means revisiting
this number.**

## Security headers

`middleware/helmet.ts` sets:

| Header                      | Directive                                                                                                                         | Effect                                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`   | `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` | No inline scripts, no plugins, no framing                                                                                                                                                                                                 |
|                             | `style-src 'self' 'unsafe-inline'`                                                                                                | **The one concession.** No CSS is inlined by the build, but `'unsafe-inline'` is retained so an injected `<style>` cannot exfiltrate data through a CSS side channel. Scripts never get an inline allowance - that is where XSS executes. |
|                             | `img-src 'self' data: blob:` + allowed origins                                                                                    | Cover images and local assets                                                                                                                                                                                                             |
|                             | `connect-src 'self'` + allowed origins                                                                                            | The API only                                                                                                                                                                                                                              |
| `Referrer-Policy`           | `no-referrer`                                                                                                                     | Nothing leaks in the `Referer` header                                                                                                                                                                                                     |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                         | Blocks MIME-confusion attacks against the API                                                                                                                                                                                             |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`                                                                                    | Two years, production only                                                                                                                                                                                                                |
| `X-DNS-Prefetch-Control`    | off                                                                                                                               |                                                                                                                                                                                                                                           |

`app.disable('x-powered-by')` and `app.set('etag', false)` remove two trivial
information disclosures: the framework fingerprint, and an `ETag` that would
permit a conditional request against an authenticated endpoint.

## CORS

An **explicit allowlist** built from `FRONTEND_URL` plus any entries in
`CORS_EXTRA_ORIGINS` (comma-separated), with credentials enabled only for a
listed origin. No wildcard, ever.

`env.ts` refuses to start when production is configured with a wildcard origin —
a credentialed wildcard is equivalent to having no CORS policy at all while
looking like one. It also requires production `FRONTEND_URL` to be `https://`.

The target deployment is same-origin behind a proxy, so CORS is not on the
production hot path.

## Input validation

Three layers, each catching what the others cannot:

| Layer                                  | Catches                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| Zod schemas (`middleware/validate.ts`) | Shape, type, format, bounds, unknown keys — with a field path in the 400 |
| Prisma                                 | Injection — every value is a bound parameter                             |
| `CHECK` constraints and indexes        | The impossible, regardless of which code path wrote it                   |

Validation runs before the controller, so no service receives an unvalidated
value and no handler has to re-check what the schema guaranteed.

Body limits live in `LIMITS` in `config/constants.ts` — **not** settings. An
administrator must not be able to raise the body limit through the settings page.

## Authentication and sessions

Covered in [Authentication](../authorization/authentication.md). In summary:

- Argon2id at the OWASP baseline; passwords never stored, logged, or returned.
- 15-minute access token, validated against a live session row on every request.
- Opaque 256-bit refresh token, SHA-256 hashed at rest, rotated on every use.
- Reuse of a rotated token revokes the entire session family.
- HttpOnly + `SameSite=Lax` + `Secure` cookies; double-submit CSRF.
- Four rate-limit tiers; `/health` and `/ready` exempt so probes cannot trip them.

## Secrets

- `.env` is git-ignored. `.env.example` documents every variable with no values.
- `config/env.ts` validates the whole environment with Zod at import time, so a
  missing or malformed value **fails startup** rather than defaulting into an
  insecure state.
- Two startup messages are deliberately printed **raw to stderr**: the Argon2
  parameters in use, and a warning when `COOKIE_SECURE` is false. These are
  operator-facing — an operator should never have to guess whether their
  configuration loaded.
- `JWT_SECRET` must be ≥ 32 characters and must **differ** from
  `JWT_REFRESH_SECRET`; the process refuses to start if they are equal.
- `ACCESS_TOKEN_TTL` must be ≤ 60 minutes, so database-backed revocation is
  actually effective.
- `NODE_ENV=production` requires `COOKIE_SECURE=true`.

## Logging and redaction

`lib/redact.ts` produces redacted clones for the logger, so a password hash or a
token cannot reach a log even if a caller passes a whole object.

The rules:

- Never log a request or response body on an auth route.
- Never log a token, a password, a hash, or an OTP.
- Log the **request id** on everything, so an incident can be reconstructed
  without logging the payload.
- Log the principal (`userId`, `roleCode`) and the action on every mutation.

An audit log that records successes only cannot show a spike in failures — and a
spike in 403s is a signal.

## Authorization

Four gates, documented in full in
[Authorization](../authorization/authorization.md):

1. Authentication — who is this?
2. Permission — may they perform this action?
3. Branch scope — may they touch this branch?
4. Ownership — is this record theirs?

Enforced by: an inverted router default, a closed `PermissionCode` union checked
at compile time, and `tests/security/route-manifest.test.ts`, which enumerates the
mounted router and fails the build if any route is reachable unguarded.

### Why not PostgreSQL row-level security

RLS was considered and rejected:

- Prisma does not emit `SET LOCAL app.current_user`, so every transaction would
  need a hand-written prelude the ORM cannot see;
- an RLS policy that only holds when the connection is set up correctly **fails
  open** — the worst possible direction for a security control;
- the application already owns identity and session state, so the database would
  need a second copy of it.

The defence is instead composed where the facts live: a predicate in every query,
built from reviewed helpers, covered by an executed matrix.

## Data-level defences

| Control                                                      | Where                                   |
| ------------------------------------------------------------ | --------------------------------------- |
| `CHECK` constraints for money and state coherence            | `20260101000100_invariants`             |
| Partial unique indexes for "at most one open"                | same                                    |
| Append-only triggers on history tables                       | same, via `raise_immutable_violation()` |
| `REVOKE UPDATE, DELETE` on history; `REVOKE DELETE` on money | same, from `lms_app`                    |
| `RESTRICT` on foreign keys that protect history              | schema                                  |
| UUID keys (non-enumerable, client-mintable)                  | schema                                  |
| `Decimal(14,2)` for money, string on the wire                | schema + `lib/money.ts`                 |

See [Constraints and indexes](../database/constraints-and-indexes.md) and
[Business rules](../database/business-rules.md).

## The `lms_app` role

The application connects as a role that has **no** `UPDATE`/`DELETE` on history
tables and no `DELETE` on `loans`, `fines`, or `fine_payments`.

This is the second layer behind the triggers: the trigger handles the ordinary
case, the `REVOKE` handles a role that somehow bypasses it. The right to erase
history is a privilege granted to a DBA during an incident — not a capability of
the running application.

`scripts/deploy.ts` asserts these grants exist after migrating, so a restore from
a backup that lost them fails the deploy rather than silently running with a
weaker posture.

## File and object storage

Digital resources store a **storage key**, never a public URL. Access is authorized
and served through a short-lived signed URL (`SIGNED_URL_TTL_SECONDS`, default
300). A digital file must not become public by accident.

Upload path is validated by content type and size, and the upload route requires
`DIGITAL_MANAGE`.

## Denial of service

| Vector                            | Control                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| Flood                             | Global rate limit                                          |
| Login flood                       | Auth rate limit, keyed by IP **and** email; Argon2 cost    |
| Password reset flood              | Auth rate limit                                            |
| Bulk writes from a stolen session | Write rate limit, keyed by user id                         |
| Expensive report generation       | Export rate limit, 20 per window                           |
| Huge request body                 | `MAX_JSON_BODY_BYTES` on the parsers                       |
| Huge "password"                   | `PASSWORD_POLICY.MAX_LENGTH` (128)                         |
| Slow query                        | Capped page size; indexes on every filtered column         |
| Deep pagination                   | `MAX_PAGE_SIZE` cap; `OFFSET` cost accepted and documented |

A limiter that fails open on a dependency outage is not a limiter, so rate
limiting has no external dependency: `express-rate-limit`'s in-memory store. The
known trade — counters are per process — is recorded in
[Roadmap](../roadmap.md).

## Dependency and supply chain

- `npm ci` in CI: the lockfile is authoritative, nothing is resolved fresh.
- `npm audit` runs in CI.
- Dependencies are pinned exactly in `package.json`; upgrades are deliberate,
  reviewed, and accompanied by a passing test run.
- `argon2` is a native module, so `npm ci` needs a build toolchain in CI and
  in the runtime environment.

### Accepted advisories

`npm audit` currently reports four high-severity advisories and no criticals. All
four are in Prisma's CLI internals and none is reachable from a request, recorded
here rather than left to be rediscovered on every audit.

| Package                   | Advisory                                                   | Why it is accepted                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prisma` (direct, dev)    | affected through `@prisma/config` from 6.13.0-dev.1 onward | No patched stable release exists. The only resolution npm offers is a **downgrade** to 6.12.0, which moves backwards and would give up fixes added since.                      |
| `@prisma/config` (trans.) | via `deepmerge-ts`, `effect`                               | Loaded by `prisma generate`, `migrate`, `db:validate`, `db:drift`, and `db:invariants`. These are developer and CI commands; they are not in the backend runtime request path. |

Two points worth stating precisely, because "dev dependency" is often used to wave
this away without checking:

- The Prisma **query engine** does load in the deployed service, but the affected
  packages are `@prisma/config`, `deepmerge-ts`, and `effect` — CLI configuration
  and RPC plumbing, not `@prisma/client`. `npm ls` shows `@prisma/client` free of
  advisories.
- `deepmerge-ts`'s stack exhaustion needs attacker-controlled recursive object
  graphs. Nothing in this codebase parses configuration from a request, so there
  is no path to it even if a future route did.

The condition to revisit: a stable Prisma release that clears the advisory. Until
then this is a known, dated, and scoped acceptance — not an oversight. If that
release arrives, the upgrade is a deliberate change with a full test run, exactly
as any other dependency bump here.

## Security checklist

Before marking any endpoint complete:

- [ ] Guards declared **on the route**, not applied by convention.
- [ ] The permission exists in `packages/shared/src/permissions.ts`.
- [ ] Ownership predicate in the query if the route is `_OWN`.
- [ ] Branch predicate in the query if the route touches branch data.
- [ ] Out-of-scope records return **404**, not 403.
- [ ] Validation on body, query, **and** params.
- [ ] Audit row written in the same transaction, for anything sensitive.
- [ ] No secret in the response, the log, or the error message.
- [ ] Money returned as a string.
- [ ] Tests: one case per role, plus the ownership case.

Before deploying:

- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` differ, both ≥ 32 characters.
- [ ] `COOKIE_SECURE=true` in production.
- [ ] `ACCESS_TOKEN_TTL` ≤ 60 minutes.
- [ ] `DATABASE_URL` uses `lms_app`, not a superuser.
- [ ] `REVOKE` grants present — `scripts/deploy.ts` asserts them.
- [ ] `CORS_ORIGINS` is an explicit list, never `*`.
- [ ] Backups configured and **a restore rehearsed** — see
      [Backup and recovery](../operations/backup-and-recovery.md).
