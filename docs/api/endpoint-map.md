# Endpoint Map

Every endpoint, with its guards. **Implemented routes are the ones that exist in
the code today**; planned routes are listed separately and are not callable.

Conventions and the response envelope are in
[API architecture](./api-architecture.md).

## Legend

| Symbol | Meaning                                                       |
| ------ | ------------------------------------------------------------- |
| 🔓     | Public — on the `PUBLIC_ROUTES` allowlist                     |
| 🔒     | `requireAuth()` only                                          |
| 🔑     | `requireAuth()` + named permission(s)                         |
| 👤     | Gate 4 applies: result restricted to the caller's own records |
| ⬜     | Planned — not implemented                                     |

`PUBLIC_ROUTES` is the audit surface. Adding an entry there is a security
decision, reviewed as one.

---

## System — implemented

Outside `/api/v1`, so probes never depend on the API version.

| Method | Path      | Guards | Notes                                                                                       |
| ------ | --------- | ------ | ------------------------------------------------------------------------------------------- |
| `GET`  | `/health` | 🔓     | Liveness. Process is up. Never touches the database.                                        |
| `GET`  | `/ready`  | 🔓     | Readiness. Database reachable. Fails the probe, not the process, when the database is down. |

## API root — implemented

| Method | Path      | Guards | Notes                     |
| ------ | --------- | ------ | ------------------------- |
| `GET`  | `/api/v1` | 🔓     | API name, version, status |

---

## Authentication — implemented

`auth` declares its own guards per route. It is the only module that may be
anonymous, because it is where a request _becomes_ authenticated.

### Public

| Method | Path                           | Guards                    | Notes                                                        |
| ------ | ------------------------------ | ------------------------- | ------------------------------------------------------------ |
| `GET`  | `/api/v1/auth/csrf`            | 🔓                        | Sets the readable CSRF cookie, returns the token             |
| `POST` | `/api/v1/auth/login`           | 🔓 · authRateLimit · CSRF | Sets `lms_session`, `lms_refresh`, `lms_csrf`                |
| `POST` | `/api/v1/auth/register`        | 🔓 · authRateLimit · CSRF | Self-registration; member type and policy from config        |
| `POST` | `/api/v1/auth/refresh`         | 🔓 · authRateLimit · CSRF | Rotates the refresh token; reuse detection applies           |
| `POST` | `/api/v1/auth/forgot-password` | 🔓 · authRateLimit · CSRF | Always responds identically, whether or not the email exists |
| `POST` | `/api/v1/auth/reset-password`  | 🔓 · authRateLimit · CSRF | Burns the one-time token; revokes all sessions               |
| `POST` | `/api/v1/auth/verify-email`    | 🔓 · authRateLimit · CSRF | Burns the one-time token                                     |

### Authenticated

| Method   | Path                               | Guards    | Notes                                                             |
| -------- | ---------------------------------- | --------- | ----------------------------------------------------------------- |
| `POST`   | `/api/v1/auth/logout`              | 🔒 · CSRF | Revokes the current session; idempotent                           |
| `POST`   | `/api/v1/auth/logout-all`          | 🔒 · CSRF | Revokes every live session; returns the count                     |
| `GET`    | `/api/v1/auth/me`                  | 🔒        | The principal: user, role, permissions, `branchScope`, `memberId` |
| `GET`    | `/api/v1/auth/sessions`            | 🔒 · 👤   | Own sessions only                                                 |
| `DELETE` | `/api/v1/auth/sessions/:sessionId` | 🔒 · 👤   | Revokes one own session                                           |
| `POST`   | `/api/v1/auth/change-password`     | 🔒 · CSRF | Rejects reuse; revokes all sessions                               |

### Development only

| Method | Path                                  | Guards                    | Notes                                                                                                                                                                |
| ------ | ------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/auth/dev/verification-token` | 🔓 · authRateLimit · CSRF | **Non-production only.** Minted only when `REQUIRE_EMAIL_VERIFICATION` is on and the environment is not production. Not in the production `PUBLIC_ROUTES` allowlist. |

---

## Members — implemented

Mounted behind router-level `requireAuth()`.

| Method   | Path                  | Guards                | Notes                                            |
| -------- | --------------------- | --------------------- | ------------------------------------------------ |
| `GET`    | `/api/v1/members/me`  | 🔒 · 👤               | The caller's own member record                   |
| `GET`    | `/api/v1/members`     | 🔑 `MEMBER_VIEW`      | Paginated; branch-scoped; ownership-filtered     |
| `GET`    | `/api/v1/members/:id` | 🔑 `MEMBER_VIEW` · 👤 | 404 when out of scope or not visible             |
| `POST`   | `/api/v1/members`     | 🔑 `MEMBER_CREATE`    | Membership number issued server-side             |
| `PATCH`  | `/api/v1/members/:id` | 🔑 `MEMBER_UPDATE`    | Status transitions are branch-scoped             |
| `DELETE` | `/api/v1/members/:id` | 🔑 `MEMBER_DELETE`    | **Soft** delete — the row and its history remain |

## Member types — implemented

| Method  | Path                                  | Guards                  | Notes                                       |
| ------- | ------------------------------------- | ----------------------- | ------------------------------------------- |
| `GET`   | `/api/v1/member-types`                | 🔑 `MEMBER_TYPE_VIEW`   | Paginated; held by every role               |
| `GET`   | `/api/v1/member-types/:id`            | 🔑 `MEMBER_TYPE_VIEW`   | Includes the borrowing policy               |
| `POST`  | `/api/v1/member-types`                | 🔑 `MEMBER_TYPE_MANAGE` | Policy validated by `ck_member_type_policy` |
| `PATCH` | `/api/v1/member-types/:id`            | 🔑 `MEMBER_TYPE_MANAGE` | Same constraint                             |
| `POST`  | `/api/v1/member-types/:id/deactivate` | 🔑 `MEMBER_TYPE_MANAGE` | Retire without affecting existing loans     |

## Settings — partial

| Method | Path                      | Guards | Notes                                               |
| ------ | ------------------------- | ------ | --------------------------------------------------- |
| `GET`  | `/api/v1/settings/public` | 🔓     | Branding and policy display values only; no secrets |

The administrative endpoints (`SETTINGS_VIEW`, `SETTINGS_UPDATE`) are
**deliberately absent** rather than ungated. They ship with the admin module.

---

## Planned — not implemented

Listed so the target surface is reviewable. **None of these are callable**, and
nothing here should be read as a promise of current behaviour.

### Users and roles ⬜

| Method   | Path                                          | Guards | Permission        |
| -------- | --------------------------------------------- | ------ | ----------------- |
| `GET`    | `/api/v1/users`                               | 🔑     | `USER_VIEW`       |
| `GET`    | `/api/v1/users/:id`                           | 🔑     | `USER_VIEW`       |
| `POST`   | `/api/v1/users`                               | 🔑     | `USER_CREATE`     |
| `PATCH`  | `/api/v1/users/:id`                           | 🔑     | `USER_UPDATE`     |
| `DELETE` | `/api/v1/users/:id`                           | 🔑     | `USER_DELETE`     |
| `POST`   | `/api/v1/users/:id/deactivate`                | 🔑     | `USER_DEACTIVATE` |
| `GET`    | `/api/v1/users/:id/branches`                  | 🔑     | `USER_UPDATE`     |
| `PUT`    | `/api/v1/users/:id/branches`                  | 🔑     | `USER_UPDATE`     |
| `GET`    | `/api/v1/roles`                               | 🔑     | `ROLE_VIEW`       |
| `GET`    | `/api/v1/permissions`                         | 🔑     | `PERMISSION_VIEW` |
| `POST`   | `/api/v1/roles/:id/permissions`               | 🔑     | `ROLE_UPDATE`     |
| `DELETE` | `/api/v1/roles/:id/permissions/:permissionId` | 🔑     | `ROLE_UPDATE`     |
| `GET`    | `/api/v1/audit-logs`                          | 🔑     | `AUDIT_VIEW`      |
| `GET`    | `/api/v1/audit-logs/export`                   | 🔑     | `AUDIT_EXPORT`    |
| `GET`    | `/api/v1/settings`                            | 🔑     | `SETTINGS_VIEW`   |
| `PATCH`  | `/api/v1/settings`                            | 🔑     | `SETTINGS_UPDATE` |

### Organisation ⬜

| Method        | Path                             | Guards | Permission                          |
| ------------- | -------------------------------- | ------ | ----------------------------------- |
| `GET`/`POST`  | `/api/v1/libraries`              | 🔑     | `LIBRARY_VIEW` / `LIBRARY_MANAGE`   |
| `GET`/`PATCH` | `/api/v1/libraries/:id`          | 🔑     | `LIBRARY_VIEW` / `LIBRARY_MANAGE`   |
| `GET`/`POST`  | `/api/v1/branches`               | 🔑     | `BRANCH_VIEW` / `BRANCH_MANAGE`     |
| `GET`/`PATCH` | `/api/v1/branches/:id`           | 🔑     | `BRANCH_VIEW` / `BRANCH_MANAGE`     |
| `GET`/`POST`  | `/api/v1/branches/:id/locations` | 🔑     | `LOCATION_VIEW` / `LOCATION_MANAGE` |
| `GET`/`POST`  | `/api/v1/branches/:id/shelves`   | 🔑     | `SHELF_VIEW` / `SHELF_MANAGE`       |

### Catalogue ⬜

| Method                 | Path                        | Guards | Permission                                  |
| ---------------------- | --------------------------- | ------ | ------------------------------------------- |
| `GET`/`POST`           | `/api/v1/books`             | 🔑     | `BOOK_VIEW` / `BOOK_CREATE`                 |
| `GET`/`PATCH`/`DELETE` | `/api/v1/books/:id`         | 🔑     | `BOOK_VIEW` / `BOOK_UPDATE` / `BOOK_DELETE` |
| `POST`                 | `/api/v1/books/:id/archive` | 🔑     | `BOOK_ARCHIVE`                              |
| `GET`                  | `/api/v1/books/search`      | 🔑     | `BOOK_VIEW`                                 |
| `GET`/`POST`           | `/api/v1/authors`           | 🔑     | `AUTHOR_VIEW` / `AUTHOR_MANAGE`             |
| `GET`/`POST`           | `/api/v1/categories`        | 🔑     | `CATEGORY_VIEW` / `CATEGORY_MANAGE`         |
| `GET`/`POST`           | `/api/v1/publishers`        | 🔑     | `PUBLISHER_VIEW` / `PUBLISHER_MANAGE`       |
| `GET`/`POST`           | `/api/v1/tags`              | 🔑     | `TAG_VIEW` / `TAG_MANAGE`                   |

### Inventory ⬜

| Method                 | Path                          | Guards | Permission                                  |
| ---------------------- | ----------------------------- | ------ | ------------------------------------------- |
| `GET`/`POST`           | `/api/v1/copies`              | 🔑     | `COPY_VIEW` / `COPY_CREATE`                 |
| `GET`/`PATCH`/`DELETE` | `/api/v1/copies/:id`          | 🔑     | `COPY_VIEW` / `COPY_UPDATE` / `COPY_DELETE` |
| `GET`                  | `/api/v1/copies/scan/:token`  | 🔑     | `COPY_VIEW`                                 |
| `POST`                 | `/api/v1/copies/:id/status`   | 🔑     | `COPY_UPDATE`                               |
| `GET`                  | `/api/v1/members/scan/:token` | 🔑     | `MEMBER_VIEW`                               |

`/copies/scan/:token` must resolve to exactly one copy before any state change.
Search is typo-tolerant, so a scan can return near-misses; acting on an ambiguous
result is how the wrong book gets issued.

### Circulation ⬜

| Method | Path                             | Guards | Permission          |
| ------ | -------------------------------- | ------ | ------------------- |
| `GET`  | `/api/v1/loans`                  | 🔑     | `LOAN_VIEW` · 👤    |
| `GET`  | `/api/v1/loans/:id`              | 🔑     | `LOAN_VIEW` · 👤    |
| `POST` | `/api/v1/loans`                  | 🔑     | `LOAN_CREATE`       |
| `POST` | `/api/v1/loans/:id/return`       | 🔑     | `LOAN_RETURN`       |
| `POST` | `/api/v1/loans/:id/renew`        | 🔑     | `LOAN_RENEW`        |
| `POST` | `/api/v1/loans/:id/mark-lost`    | 🔑     | `LOAN_MARK_LOST`    |
| `POST` | `/api/v1/loans/:id/mark-damaged` | 🔑     | `LOAN_MARK_DAMAGED` |
| `GET`  | `/api/v1/renewals/:id`           | 🔑     | `LOAN_VIEW`         |

`LOAN_VIEW_OWN` and `LOAN_RENEW_OWN` are the member-facing variants; the paths are
the same and Gate 4 decides what a member may see.

### Reservations ⬜

| Method       | Path                              | Guards | Permission                                     |
| ------------ | --------------------------------- | ------ | ---------------------------------------------- |
| `GET`/`POST` | `/api/v1/reservations`            | 🔑     | `RESERVATION_VIEW` / `RESERVATION_CREATE` · 👤 |
| `POST`       | `/api/v1/reservations/:id/cancel` | 🔑     | `RESERVATION_CANCEL` · 👤                      |
| `POST`       | `/api/v1/reservations/:id/fulfil` | 🔑     | `RESERVATION_FULFIL`                           |
| `POST`       | `/api/v1/reservations/:id/expire` | 🔑     | `RESERVATION_FULFIL`                           |

### Finance ⬜

| Method       | Path                           | Guards | Permission                        |
| ------------ | ------------------------------ | ------ | --------------------------------- |
| `GET`        | `/api/v1/fines`                | 🔑     | `FINE_VIEW` · 👤                  |
| `GET`        | `/api/v1/fines/:id`            | 🔑     | `FINE_VIEW` · 👤                  |
| `POST`       | `/api/v1/fines`                | 🔑     | `FINE_CREATE`                     |
| `PATCH`      | `/api/v1/fines/:id`            | 🔑     | `FINE_UPDATE`                     |
| `POST`       | `/api/v1/fines/:id/waive`      | 🔑     | `FINE_WAIVE`                      |
| `GET`/`POST` | `/api/v1/payments`             | 🔑     | `PAYMENT_VIEW` / `PAYMENT_CREATE` |
| `GET`        | `/api/v1/payments/:id/receipt` | 🔑     | `PAYMENT_VIEW` · 👤               |
| `POST`       | `/api/v1/payments/:id/void`    | 🔑     | `PAYMENT_VOID`                    |

### Notifications ⬜

| Method   | Path                              | Guards | Permission                     |
| -------- | --------------------------------- | ------ | ------------------------------ |
| `GET`    | `/api/v1/notifications`           | 🔑     | `NOTIFICATION_VIEW_OWN` · 👤   |
| `POST`   | `/api/v1/notifications/:id/read`  | 🔑     | `NOTIFICATION_VIEW_OWN` · 👤   |
| `POST`   | `/api/v1/notifications/read-all`  | 🔑     | `NOTIFICATION_VIEW_OWN` · 👤   |
| `DELETE` | `/api/v1/notifications/:id`       | 🔑     | `NOTIFICATION_DELETE_OWN` · 👤 |
| `POST`   | `/api/v1/notifications/broadcast` | 🔑     | `NOTIFICATION_BROADCAST`       |

### Reports ⬜

| Method | Path                          | Guards               | Permission              |
| ------ | ----------------------------- | -------------------- | ----------------------- |
| `GET`  | `/api/v1/reports/dashboard`   | 🔑                   | `REPORT_VIEW`           |
| `GET`  | `/api/v1/reports/loans`       | 🔑                   | `REPORT_VIEW`           |
| `GET`  | `/api/v1/reports/members`     | 🔑                   | `REPORT_VIEW`           |
| `GET`  | `/api/v1/reports/inventory`   | 🔑                   | `REPORT_VIEW`           |
| `GET`  | `/api/v1/reports/fines`       | 🔑                   | `REPORT_VIEW_FINANCIAL` |
| `GET`  | `/api/v1/reports/analytics/*` | 🔑                   | `REPORT_VIEW`           |
| `GET`  | `/api/v1/reports/export`      | 🔑 · exportRateLimit | `REPORT_EXPORT`         |

Financial reports require `REPORT_VIEW_FINANCIAL`, which no non-admin role holds.
See [Role matrix](../authorization/role-matrix.md).

### Digital resources ⬜

| Method | Path                                   | Guards | Permission       |
| ------ | -------------------------------------- | ------ | ---------------- |
| `GET`  | `/api/v1/digital-resources`            | 🔑     | `DIGITAL_VIEW`   |
| `POST` | `/api/v1/digital-resources`            | 🔑     | `DIGITAL_MANAGE` |
| `GET`  | `/api/v1/digital-resources/:id`        | 🔑     | `DIGITAL_VIEW`   |
| `POST` | `/api/v1/digital-resources/:id/access` | 🔑     | `DIGITAL_ACCESS` |

`/access` records an entitlement consumption and returns a short-lived signed URL
(`SIGNED_URL_TTL_SECONDS`, default 300). Only a storage key is persisted, never a
public URL.

### Offline sync ⬜

| Method | Path                | Guards | Notes                                                                        |
| ------ | ------------------- | ------ | ---------------------------------------------------------------------------- |
| `POST` | `/api/v1/sync/push` | 🔑     | Not implemented. `sync_operations` exists; no client ships against it in V1. |
| `GET`  | `/api/v1/sync/pull` | 🔑     | See [Offline strategy](../pwa/offline-strategy.md)                           |

---

## Adding an endpoint

The order matters, because several of these steps exist to stop a specific
mistake.

1. **Declare the route** on the module router, with `requirePermission(...)` and
   `validate({...})` **on the same declaration**.
2. **Add schemas** to `<module>.schemas.ts` — body, query, and params. Params must
   be UUID-validated.
3. **Implement the service** with the rule, the ownership predicate, the branch
   predicate, and the transaction boundary.
4. **Implement the repository** — queries only.
5. **Keep the controller thin.** Validate, call one service, shape the response.
6. **Add audit logging** inside the same transaction, if the action is
   security- or business-relevant.
7. **Add tests**: a permission case per role, and an ownership case if the route
   is `_OWN`.
8. **Do not add it to `PUBLIC_ROUTES`** unless it genuinely serves anonymous
   callers. That list is reviewed as a security surface.

`tests/security/route-manifest.test.ts` enumerates the mounted router and fails
if a new route is reachable without a guard — so step 1 cannot be skipped.

## What the OpenAPI document covers

`apps/backend/openapi.json` currently documents `/health` and `/ready` only.
That is a deliberate choice — a partial OpenAPI file reads as "this API is
documented", which is worse than a clear scope boundary. Expanding it is tracked
in [Roadmap](../roadmap.md); until then, this page is the reference.
