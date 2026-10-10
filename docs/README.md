# Documentation

The documentation set for the Library Management System. 32 documents, indexed
by topic and by audience.

## Start here

| If you want to                  | Read                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Understand what this is and why | [Requirements](./requirements.md)                                                      |
| Understand how it is built      | [Architecture](./architecture.md)                                                      |
| Know what you can call          | [Endpoint map](./api/endpoint-map.md)                                                  |
| Know what you may do            | [Permission matrix](./authorization/permission-matrix.md)                              |
| Contribute code                 | [Testing strategy](./engineering/testing-strategy.md) · [CI/CD](./engineering/cicd.md) |
| Know what comes next            | [Roadmap](./roadmap.md)                                                                |
| Deploy it                       | [Deployment](./operations/deployment.md)                                               |
| Review it for security          | [Security architecture](./security/security-architecture.md)                           |

## Governing principle

> Users should only see and access what they are explicitly authorized to see and
> access.

Everything in this set follows from that. Access is four sequential gates —
authentication, permission, branch scope, ownership — each of which can only
restrict. The backend is the security boundary; the frontend's job is not to
mislead, not to protect.

## By topic

### Foundations

| Document                          | Contents                                                           |
| --------------------------------- | ------------------------------------------------------------------ |
| [Requirements](./requirements.md) | Scope, personas, roles, functional scope, explicit deferrals       |
| [Architecture](./architecture.md) | Monorepo, runtime topology, module map, layering, dependency rules |

### Database

| Document                                                         | Contents                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Database architecture](./database/database-architecture.md)     | Schema design, indexing strategy, migration discipline                 |
| [Entity-relationship diagram](./database/erd.md)                 | Narrative ER walkthrough                                               |
| [Tables](./database/tables.md)                                   | Every table and column                                                 |
| [`schema.dbml`](./database/schema.dbml)                          | Machine-readable schema                                                |
| [Constraints and indexes](./database/constraints-and-indexes.md) | `CHECK`, partial unique, full-text, triggers, grants                   |
| [Business rules](./database/business-rules.md)                   | Circulation, finance, and audit invariants, and where each is enforced |

### Authorization

| Document                                                  | Contents                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Authentication](./authorization/authentication.md)       | Argon2id, JWTs, refresh rotation and reuse detection, sessions, logout, CSRF |
| [Authorization](./authorization/authorization.md)         | The four gates, ownership, branch scope, deny by default                     |
| [Role matrix](./authorization/role-matrix.md)             | `ADMIN`, `LIBRARIAN`, `MEMBER`, and how to add one                           |
| [Permission matrix](./authorization/permission-matrix.md) | All 80 permissions, sensitivity, grants, and ownership semantics             |

### API

| Document                                      | Contents                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| [API architecture](./api/api-architecture.md) | Versioning, envelope, errors, validation, pagination, rate limits, versioning rules |
| [Endpoint map](./api/endpoint-map.md)         | Every endpoint, implemented and planned, with required permissions                  |

> `apps/backend/openapi.json` documents only `/health` and `/ready`. It is
> deliberately partial, and the endpoint map is the human-readable reference.

### Frontend and PWA

| Document                                      | Contents                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| [PWA architecture](./pwa/pwa-architecture.md) | Installability, service worker, caching, versioning, accessibility baseline |
| [Offline strategy](./pwa/offline-strategy.md) | What is cached, what is never cached, and why offline _writes_ are deferred |

### Security

| Document                                                                   | Contents                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Security architecture](./security/security-architecture.md)               | Threat model, controls, password storage, headers, rate limiting, secret handling, checklist |
| [Transactions and concurrency](./security/transactions-and-concurrency.md) | Isolation levels, the unwrap-retry rule, lock ordering, optimistic UI, retry policy          |

### Engineering

| Document                                              | Contents                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| [Testing strategy](./engineering/testing-strategy.md) | Test layers, coverage thresholds, what must be tested, anti-patterns |
| [CI/CD](./engineering/cicd.md)                        | The three jobs, release sequence, branch strategy, known gaps        |

### Operations

| Document                                                   | Contents                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Deployment](./operations/deployment.md)                   | Topology, configuration, the release sequence, rollback, pre-deploy checklist |
| [Backup and recovery](./operations/backup-and-recovery.md) | PITR, retention, **restore drills**, RPO/RTO                                  |
| [Monitoring](./operations/monitoring.md)                   | Logs, health and readiness, metrics to add, alerting, runbooks                |

### Planning

| Document                | Contents                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- |
| [Roadmap](./roadmap.md) | Phases A–G, the gates each phase must pass, named gaps, deferred capabilities |

## By audience

### New contributor

[Architecture](./architecture.md) → [Authorization](./authorization/authorization.md) →
[Testing strategy](./engineering/testing-strategy.md) → [Endpoint map](./api/endpoint-map.md#adding-an-endpoint)

### API consumer

[API architecture](./api/api-architecture.md) →
[Endpoint map](./api/endpoint-map.md) →
[Permission matrix](./authorization/permission-matrix.md) →
[Authentication](./authorization/authentication.md)

### Frontend developer

[Architecture](./architecture.md#frontend-folder-structure) →
[PWA architecture](./pwa/pwa-architecture.md) →
[Authorization](./authorization/authorization.md) →
[Offline strategy](./pwa/offline-strategy.md)

### Database engineer

[Database architecture](./database/database-architecture.md) →
[Constraints and indexes](./database/constraints-and-indexes.md) →
[Business rules](./database/business-rules.md) →
[Transactions and concurrency](./security/transactions-and-concurrency.md)

### DevOps / operator

[Deployment](./operations/deployment.md) →
[Backup and recovery](./operations/backup-and-recovery.md) →
[Monitoring](./operations/monitoring.md) →
[CI/CD](./engineering/cicd.md)

### Security reviewer

[Security architecture](./security/security-architecture.md) →
[Authentication](./authorization/authentication.md) →
[Transactions and concurrency](./security/transactions-and-concurrency.md) →
[Business rules](./database/business-rules.md)

### Product owner

[Requirements](./requirements.md) →
[Roadmap](./roadmap.md#named-gaps) →
[Business rules](./database/business-rules.md) →
[Deferred capabilities](./roadmap.md#deliberately-deferred)

## Conventions

**Implemented versus planned is stated explicitly.** A route that is designed but
not built is marked _planned_ in the [endpoint map](./api/endpoint-map.md) and
absent from `openapi.json`. A partial document reads as a complete one.

**A rule names its enforcement point.** Business rules are stated together with
_where_ they are enforced — a `CHECK` constraint, a trigger, the authorization
layer, or a transaction. A rule with no enforcement point is a wish.

**Claims are marked as verified, reported, or planned.**

| Marker       | Meaning                                                  |
| ------------ | -------------------------------------------------------- |
| **Verified** | Read directly from the code or schema in this repository |
| **Reported** | Stated by the system at runtime but not verified here    |
| **Planned**  | Designed, not implemented                                |

This matters for an operations document: "PostgreSQL 16 in production" is a
_planned_ topology, while "36 models in the schema" is _verified_.

**Constraints are quoted by name.** `ck_loan_dates`, `uq_loan_one_open_per_copy`,
`loan_renewals_loan_id_renewal_number_key` — a specific name can be grepped, and a
paraphrase cannot. Every identifier in this set is verified against
`schema.prisma` or the migrations.

## Known documentation gaps

Named so they are tracked rather than assumed:

| Gap                                                                      | Where it should be                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `openapi.json` covers only `/health` and `/ready`                        | [API architecture](./api/api-architecture.md)                |
| Frontend has no router; manifest shortcuts point to unimplemented routes | [Roadmap](./roadmap.md#three-frontend-gaps-to-close-first)   |
| No production deployment exists yet                                      | [Deployment](./operations/deployment.md#production-topology) |
| No metrics pipeline                                                      | [Monitoring](./operations/monitoring.md#metrics)             |
| Test coverage reflects the modules that exist, not the planned surface   | [Testing strategy](./engineering/testing-strategy.md)        |
| No administrator bootstrap procedure for production                      | [Roadmap](./roadmap.md#named-gaps)                           |
| No API versioning or deprecation policy for `/api/v1` yet                | [API architecture](./api/api-architecture.md)                |

## Contributing to the docs

- **Every code change may need a doc change.** A new endpoint updates the endpoint
  map; a new permission updates the permission matrix; a new constraint updates
  the constraints table; a changed env var updates `.env.example` and the
  configuration reference.
- **Quote the identifier.** A permission name, a constraint name, a table name, a
  status code. A paraphrase cannot be verified against the code.
- **Say where it is enforced.** Every rule in these documents has a place it is
  checked, and that place should be named.
- **Do not document intent as fact.** If it is not in the code, mark it _planned_.
