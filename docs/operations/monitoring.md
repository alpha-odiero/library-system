# Monitoring

Logs, health, and the signals worth alerting on.

## Logging

`pino`, writing JSON to stdout in production and pretty-printed in development.

|                 |                                                                                     |
| --------------- | ----------------------------------------------------------------------------------- |
| Format          | One JSON object per line                                                            |
| Level           | `LOG_LEVEL`, default `info`; `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent` |
| Transport       | stdout, captured by the platform                                                    |
| Development     | `pino-pretty`, colourised                                                           |
| Request logging | `ENABLE_REQUEST_LOGGING`, default on                                                |
| Error tracking  | `SENTRY_DSN`, optional                                                              |

**Structured JSON, not text.** A log line is queryable data, not prose. `level`
is a field (not a string prefix), the timestamp is a field, and
`requestId` is a field — so "every 5xx in the last hour, grouped by route" is a
query rather than a `grep` through prose.

Pretty-printing is development-only. It is a readability feature, and it would
destroy the queryability that production depends on.

## Redaction

**Redaction happens in the logger serializer, not at call sites.**

That location is the point. Redaction applied where a value is logged requires
every developer to remember it at every call site, and one omission puts a
password hash in a log. Applied in the serializer, it cannot be forgotten.

`REDACT_PATHS` in `lib/redact.ts` covers password fields, token fields,
authorization headers, and cookies — `req.headers.authorization` and
`req.headers.cookie` are redacted wholesale, not pattern-matched.

`censor: '[REDACTED]'`.

## What is logged

| Level   | Contents                                              |
| ------- | ----------------------------------------------------- |
| `fatal` | The process cannot continue                           |
| `error` | Unhandled exception, with stack and request context   |
| `warn`  | Rate limit exceeded, 4xx of note, failed login, retry |
| `info`  | Request completion, startup, migrations, job runs     |
| `debug` | Query and service detail                              |
| `trace` | Verbose internal                                      |

### The request line

Every request logs at `info`:

```json
{
  "level": "info",
  "time": "2026-01-15T09:30:00.123Z",
  "requestId": "01JA8…",
  "method": "POST",
  "path": "/api/v1/loans",
  "status": 201,
  "durationMs": 42,
  "userId": "…",
  "roleCode": "LIBRARIAN"
}
```

`requestId` is on the response too, so a user quoting it maps to exactly one
request's log lines.

The principal (`userId`, `roleCode`) is logged because "who did this" is the
first question of every investigation. It is not sensitive: a user id and a role
reveal nothing that the audit log does not already record more thoroughly.

### What is never logged

- Request or response bodies on an auth route.
- Passwords, hashes, tokens, or OTPs.
- Full loan or fine records — the audit log is the record of record.
- Database error internals in a client response (they are logged internally).

## Correlation

```
browser ──X-Request-Id──▶ proxy ──▶ backend ──▶ { requestId on every log line }
   ▲                                                            │
   └──────────────── response body + header ────────────────────┘
```

A client may supply `X-Request-Id`; otherwise one is generated. Either way it
propagates, so a user reporting "it failed at about ten past nine" yields a
single traceable request rather than a search across replicas.

## Health and readiness

| Probe         | Question                | Dependencies                | Failure means                 |
| ------------- | ----------------------- | --------------------------- | ----------------------------- |
| `GET /health` | Is the process running? | **None**                    | Restart the instance          |
| `GET /ready`  | Should it get traffic?  | Database, migration history | Remove from the load balancer |

Separate on purpose. Conflating them causes a real outage: a transient database
blip would fail the liveness probe, and the platform would restart every replica
simultaneously — turning a recoverable database problem into a fleet-wide restart
storm with connection storms during recovery.

`/health` reports `status`, `uptimeSeconds`, `environment`, and `version`, which
is what a deployment gate asserts.

`/ready` returns **503** when the database is unreachable or the migration
history is missing, so an un-migrated or database-less replica never receives
traffic.

Both are excluded from the rate limiter, so a probe cannot exhaust a budget and
manufacture a false outage.

## Error tracking

`config/observability.ts` provides `initObservability()` and `captureException()`.
With `SENTRY_DSN` set, unhandled exceptions and fatal errors are reported with
context; without it, they are logged only.

The application never depends on the error tracker being reachable. An outage in
the tracker must not become an outage in the library — so capture is best-effort
and a failure to report is itself a log line, not a thrown error.

## Metrics

**Not implemented.** There is no Prometheus client and no metrics endpoint.

This is a named gap rather than an oversight, and the reason is worth stating:
the signals that matter most here are already available without a metrics
pipeline.

| Wanted signal                        | Available today from                  |
| ------------------------------------ | ------------------------------------- |
| Request rate, error rate, latency    | Log aggregation over the request line |
| Rate limiting                        | `ratelimit.exceeded` warn lines       |
| Authentication failures              | `warn` lines on failed login          |
| Authorization failures               | 403s in the request line              |
| Job execution                        | Job run lines                         |
| Database health                      | `/ready`                              |
| **What changed, and who changed it** | `audit_logs` — already queryable      |

The first production dashboard should be built from logs and `audit_logs`, both
of which exist and work. A metrics pipeline is worth adding when a question
appears that logs cannot answer efficiently — high-cardinality percentiles being
the usual one. Recorded in [Roadmap](../roadmap.md).

## Alerting

Only alerts that are actionable at 3 a.m. Everything else is a dashboard.

| Alert                    | Condition                                       | Why it is worth waking someone                                                 |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| **Database unreachable** | `/ready` failing on all instances               | Nothing works. Highest severity.                                               |
| **Backup overdue**       | No successful backup within the expected window | The failure mode where nobody discovers the problem until the day it is needed |
| **Error rate spike**     | 5xx above baseline for 5 minutes                | Something is broken for users                                                  |
| **Migration missing**    | `/ready` reports no migration history           | A deploy went wrong; traffic should be pulled                                  |
| **Disk saturation**      | Database volume above threshold                 | Backups and WAL archiving fail first                                           |
| **Certificate expiry**   | Within 30 days                                  | Predictable, total outage                                                      |

Explicitly **not** alerts:

- Individual 4xx — a member mistyping a password is not an incident.
- A single failed login — that is the system working.
- A burst of 403s — usually a staff member who has been re-scoped. Worth watching,
  worth a question, not a page.
- Slow queries without user impact.

The 403 case is worth one note: a _sustained_ rise in 403s for one user can
indicate a stale session or a revoked grant they have not noticed. That is a
support question, not an on-call page.

## Operational queries

Built on `audit_logs`, which is append-only and indexed.

| Question                      | Query                                            |
| ----------------------------- | ------------------------------------------------ |
| What changed in the last day? | `audit_logs` by `created_at`                     |
| Who issued this loan?         | `action = 'LOAN_CREATED'`, `entity_id` = loan id |
| Who changed a member type?    | `action = 'MEMBER_TYPE_UPDATED'`                 |
| Which grants were modified?   | `action` in the role/permission set              |
| Failed logins                 | `action = 'LOGIN_FAILED'`                        |
| Reconcile after a restore     | `created_at` > the restore point                 |

Every row carries actor, action, entity, entity id, description, timestamp, IP,
user agent, request id, and before/after state.

**The audit log is the operational database for "what happened".** Building a
metrics pipeline does not change that; it answers "how much is happening", which
is a different question.

## Retention

| Data                                         | Retention                                                            |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `audit_logs`                                 | **Indefinite** — see [Backup and recovery](./backup-and-recovery.md) |
| `loan_status_history`, `copy_status_history` | Indefinite                                                           |
| Sessions                                     | 30 days after revocation (`SESSION_PURGE_CRON`)                      |
| Application logs                             | Per platform policy                                                  |
| Error-tracker events                         | Per plan                                                             |

Session rows are the only thing purged on a timer, and they are retained for 30
days after revocation rather than deleted immediately — a replay inside that
window must still be detectable as a replay.

## What an incident looks like

The path this documentation is written to support:

```
User reports a failure, quoting a requestId
  ↓
grep the logs for that requestId        → what happened, on which instance
  ↓
check the audit log for that entity     → what changed, and who authorized it
  ↓
check /ready and error rate             → is it us, the database, or a deploy
  ↓
fix, or roll back the code              → migrations are forward-only
  ↓
reconcile if a restore was involved
```

Every one of those steps uses something that already exists. That is the design
goal: an incident is resolved from the request id the user already has.

## Related

- [Deployment](./deployment.md) — health gates in the deploy sequence
- [Backup and recovery](./backup-and-recovery.md) — backup age alerting
- [Security architecture](../security/security-architecture.md) — what is never logged
- [Business rules](../database/business-rules.md#audit-immutability)
