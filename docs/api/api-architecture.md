# API Architecture

Conventions, the response envelope, versioning, error handling, and pagination.
The endpoint inventory is in [Endpoint map](./endpoint-map.md).

## Base URL and versioning

```
https://<host>/api/v1
```

The version is in the path, not a header. A path version survives a misrouted
request and a cached proxy; a header version does not, and it makes a stale
service worker's behaviour very hard to reason about.

`/api/v1` is mounted by `routes/v1/index.ts`. Health probes sit **outside** it
at `/health` and `/ready`, so an infrastructure check never depends on the API
version being current.

Breaking changes require `/api/v2`. Additive changes — a new optional field, a
new endpoint, a new enum value a client can ignore — do not.

## Request conventions

|              |                                                                         |
| ------------ | ----------------------------------------------------------------------- |
| Content type | `application/json`                                                      |
| Auth         | Cookie-based (`lms_session`), not `Authorization: Bearer`               |
| CSRF         | `x-csrf-token` header matching the `lms_csrf` cookie, on every mutation |
| Dates        | ISO 8601 UTC, e.g. `2026-01-15T09:30:00.000Z`                           |
| Money        | **String**, e.g. `"25.50"` — never a JSON number                        |
| Pagination   | `?page=1&limit=20`                                                      |
| Sorting      | `?sort=createdAt&order=desc`                                            |
| Filtering    | Explicit query parameters, never a free-form filter expression          |
| Trace        | Send `X-Request-Id` to correlate a client-side error with server logs   |

### Why cookie auth rather than `Authorization: Bearer`

A bearer token in a header has to be stored somewhere the JavaScript on the page
can read it, which means `localStorage`, which means any XSS exfiltrates a
long-lived credential. HttpOnly cookies are not reachable by script.

The cost is CSRF, which is why the double-submit check exists and why
`SameSite=Lax` is not optional. That is the correct trade: XSS-based token theft
becomes very hard, and CSRF is fully mitigable.

`Authorization: Bearer` remains supported for the service-to-service case and
for testing tools that cannot hold cookies.

### Why money is a string

JSON numbers are IEEE-754 doubles. `0.1 + 0.2 !== 0.3`, and no currency value
in the world is exactly representable. A fine of `0.01` returned as a JSON number
can arrive at the client as `0.009999999999999998`, and every subsequent
comparison is wrong at exactly the boundary where the code decides whether a
member's account is clear.

Money crosses the wire as a string and is parsed with `lib/money.ts` into
`Decimal(14,2)`. See [Business rules](../database/business-rules.md#fines-and-payments).

## The response envelope

Every response has the same three top-level keys.

**Success**

```json
{
  "success": true,
  "data": { "…": "…" },
  "requestId": "01JA8…"
}
```

**Collection**

```json
{
  "success": true,
  "data": {
    "items": [{ "…": "…" }],
    "pagination": { "page": 1, "limit": 20, "total": 348, "totalPages": 18 }
  },
  "requestId": "01JA8…"
}
```

**Error**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "Must be a valid email address" }]
  },
  "requestId": "01JA8…"
}
```

`requestId` is on every response, success or failure. A user reporting "it didn't
work" can quote it, and it matches exactly one line-group in the logs.

`sendOk()` and `sendCreated()` in `lib/response.ts` are the only writers of a
success envelope, so the shape cannot drift between modules.

## Error handling

One handler — `middleware/error-handler.ts` — writes every failure response. A
module that catches its own error and shapes a response is a module that has
discovered a new status code.

Errors are typed and carry a **stable machine code** alongside the human
message. Codes are shared with the frontend through `packages/shared/src/errors.ts`
with their status mapping, so the client can branch on `code` and never on a
message string.

| Code                  | Status | When                                              |
| --------------------- | ------ | ------------------------------------------------- |
| `VALIDATION_ERROR`    | 400    | Body, query, or params failed validation          |
| `UNAUTHENTICATED`     | 401    | No credentials, or invalid/expired                |
| `INVALID_CREDENTIALS` | 401    | Login failed — deliberately indistinguishable     |
| `SESSION_REVOKED`     | 401    | Reused refresh token, or session terminated       |
| `FORBIDDEN`           | 403    | Authenticated, lacking the permission             |
| `NOT_FOUND`           | 404    | No such record, **or** not visible to this caller |
| `CONFLICT`            | 409    | Uniqueness or state conflict                      |
| `PAYLOAD_TOO_LARGE`   | 413    | Body over the limit                               |
| `TOO_MANY_REQUESTS`   | 429    | Rate limited; `Retry-After` is set                |
| `INTERNAL_ERROR`      | 500    | Unhandled                                         |

### Unknown errors never leak internals

The handler logs the real error with its stack and returns a generic
`INTERNAL_ERROR`. Database messages are never returned: a Prisma error can
contain table and column names, a constraint name, and sometimes a value.

`details` is populated only for `VALIDATION_ERROR`, where the information is the
caller's own input. It is deliberately absent for server errors.

### 404 for "not yours"

A record the caller may not see returns 404, not 403. A 403/404 distinction is an
enumeration oracle. See
[Authorization](../authorization/authorization.md#404-not-403-and-why).

## Validation

Zod schemas in each module's `<module>.schemas.ts`, applied by
`middleware/validate.ts` to body, query, **and** params.

| Input    | Rule                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------- |
| `body`   | Required for `POST`/`PATCH`/`PUT`. `.strict()` so unknown keys are rejected rather than silently dropped. |
| `params` | UUID format for every id — a non-UUID id fails as 400, never reaches Prisma.                              |
| `query`  | Integers coerced with explicit bounds. `limit` is capped in code, not trusted from the client.            |

Validation runs **before** the controller, so no handler ever sees an
unvalidated value and no service has to re-check what the schema guaranteed.

Where a schema and the database could disagree, the schema is the friendlier
error and the `CHECK` constraint is the guarantee. Both exist: the schema
returns 400 with a field path, the constraint prevents the impossible write.

## Pagination

Every collection endpoint is paginated. No endpoint returns an unbounded list —
not as a convenience, and not "because the table is small".

```
GET /api/v1/members?page=1&limit=20&sort=createdAt&order=desc
```

| Parameter | Default | Rules                                    |
| --------- | ------- | ---------------------------------------- |
| `page`    | 1       | ≥ 1                                      |
| `limit`   | 20      | 1–100, capped in code by `MAX_PAGE_SIZE` |

`MAX_PAGE_SIZE` lives in `config/constants.ts` and is **not a setting**. An
administrator must not be able to set page size to 100,000 through the settings
page and turn every list endpoint into a full table scan.

Offset pagination is used rather than cursor pagination because the maximum is
capped and the collections are not unbounded. Cursor pagination is the right
answer for a feed that grows without limit; that is a different endpoint.

The cost is known and accepted: `OFFSET n` degrades on deep pages. For
administrative list views over tens of thousands of rows that is acceptable, and
the alternative's complexity is not worth paying everywhere.

## Rate limits

Four tiers, applied per route as appropriate. See
[Authentication](../authorization/authentication.md#rate-limiting).

| Tier   | Applies to                            |
| ------ | ------------------------------------- |
| global | everything except `/health`, `/ready` |
| auth   | login, refresh, password endpoints    |
| write  | mutations                             |
| export | report and CSV generation             |

Exceeding a limit returns `429` with `Retry-After`.

## CORS

`middleware/cors.ts` uses an **explicit allowlist** from `FRONTEND_URL`. There is
no wildcard, ever, and credentials are enabled only for a listed origin.

The target deployment is same-origin behind a proxy that forwards `/api`, so CORS
is not on the hot path in production. The allowlist exists for split-host
development and for platforms that cannot proxy.

`env.ts` refuses to start when production is configured with a wildcard origin,
because a credentialed wildcard is indistinguishable from no CORS at all.

## Authorization on every route

Every route declares its guards at the mount point:

```ts
router.use('/members', requireAuth(), membersRouter); // router-level
router.get('/', requirePermission('MEMBER_VIEW'), list); // route-level
```

`auth` is the deliberate exception: it is where anonymous requests are legitimate,
so it declares guards per route rather than inheriting one. Every module after it
inherits `requireAuth()`.

The full model is in [Authorization](../authorization/authorization.md);
`tests/security/route-manifest.test.ts` enumerates the mounted router and fails
the build if any route outside `PUBLIC_ROUTES` is reachable without a guard.

## The OpenAPI document

`apps/backend/openapi.json`, regenerated by `npm run openapi:generate`. CI
regenerates it and fails if the committed file differs, so the document cannot
silently rot.

**It currently documents `/health` and `/ready` only.** That is intentional. The
generator was written to publish only what it could describe completely rather
than emit a partial document that looks authoritative — an OpenAPI file covering
two of thirty endpoints reads as "this API is documented" when it is not.

Expanding it is tracked in [Roadmap](../roadmap.md). Until then this
documentation set is the endpoint reference, and
[Endpoint map](./endpoint-map.md) is the inventory.

## Middleware order

`app.ts` assembles the stack. **The order is a contract**, because several pairs
are order-dependent:

```
requestId          every log line and response carries it
  ↓
helmet             security headers
  ↓
cors               before any route work, so errors are also CORS-correct
  ↓
requestLogger
  ↓
compression        BREACH-mitigated: skipped on authenticated /api responses
  ↓
body parsers       with size limits, before rate limiting reads the body
  ↓
globalRateLimit
  ↓
/health  /ready    outside /api/v1, so probes never need a token
  ↓
/api/v1            per-router guards
  ↓
notFound
  ↓
errorHandler       last, and the only failure-response writer
```

Three ordering dependencies worth naming:

- **Body parsing precedes the rate limiter.** The auth limiter keys on the
  submitted email, so it must be able to read the body. The size limit therefore
  has to come first — which is why limits live on the body parsers.
- **`errorHandler` is last.** Express only treats a 4-argument function as error
  middleware when it is registered after the routes that can throw.
- **Compression precedes the body parsers but is skipped for authenticated
  API responses.** Compressing a response that mixes secrets with
  attacker-controlled input over TLS is what the BREACH attack exploits. Any
  request carrying a cookie or an `Authorization` header to `/api` is served
  uncompressed; only public, unauthenticated responses compress.

## Controller contract

```ts
export const listMembers = asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;
  const result = await membersService.list(principal(req), { page, limit });
  sendOk(res, result);
});
```

A controller:

- reads **validated** input (`req.validated`), never raw `req.body`;
- calls exactly one service;
- shapes the response with `sendOk`/`sendCreated`;
- contains **no business rule** and opens **no transaction**.

`asyncHandler` wraps the promise so a rejection reaches `errorHandler` instead of
becoming an unhandled rejection that never produces a response.

Anything a controller does that is not on that list belongs in the service, where
it can be tested without HTTP and reused by another caller.

## Related

- [Endpoint map](./endpoint-map.md) — every endpoint, with guards
- [Authorization](../authorization/authorization.md) — gates
- [Architecture](../architecture.md#layering-rules) — layering rules
