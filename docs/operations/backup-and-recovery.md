# Backup and Recovery

What is backed up, what it costs, and how it is proven to work.

## The headline

**An untested backup is not a backup.** It is a hypothesis.

Every procedure below is worthless until a restore has been performed from a real
backup and the resulting database has been verified. A restore drill on a schedule
is part of this document, not an optional extra.

## What must be backed up

| Data                                 | In PostgreSQL? | Backed up by                              |
| ------------------------------------ | -------------- | ----------------------------------------- |
| All application tables               | yes            | PostgreSQL backup                         |
| `audit_logs`                         | yes            | PostgreSQL backup — **and never deleted** |
| Files (PDF/EPUB covers and previews) | **no**         | Object storage versioning                 |
| Secrets                              | **no**         | Secret manager, with its own rotation     |

The critical observation is that **the database and object storage are backed up
by different mechanisms with different recovery characteristics**, and a restore
that only covers one of them produces an inconsistent system. Object storage must
have versioning and its own lifecycle policy; it does not get the database's
point-in-time recovery.

### Retention is the requirement, not the default

Loans, fines, payments, and audit logs are retained **indefinitely**. Not because
storage is free — because a library's obligation to be able to answer "what
happened to this member in 2019" does not expire.

This is why the schema refuses to delete this data: `REVOKE DELETE` from
`lms_app`, append-only triggers on history, and `RESTRICT` on the foreign keys
that would otherwise cascade it away. See
[Business rules](../database/business-rules.md#audit-immutability).

A backup policy that retains 30 days would make the _retention_ guarantee false.
The two must be reconciled before either is promised.

## Recovery objectives

Stated as objectives, not guarantees, because the actual numbers depend on the
chosen provider:

| Objective               | Target       | Achieved by                            |
| ----------------------- | ------------ | -------------------------------------- |
| **RPO** — max data loss | ≤ 15 minutes | WAL archiving + continuous archiving   |
| **RTO** — max downtime  | ≤ 1 hour     | Automated failover + rehearsed restore |

These are the numbers to hold the provider to. Confirm them in the contract and
in a drill, not in a dashboard screenshot.

An RPO of 15 minutes means: if the database is destroyed at 14:05, the state at
13:50 is recoverable and up to 15 minutes of activity may be lost. Circulating
loans in that window were genuinely issued, so the recovery procedure includes
reconciling recent activity against the audit log — see
[Reconciliation](#reconciliation-after-a-restore).

## Backup layers

| Layer              | Mechanism                     | Retention                | Recovers                     |
| ------------------ | ----------------------------- | ------------------------ | ---------------------------- |
| 1. Continuous      | WAL archiving / PITR          | To the retention horizon | Any point in time            |
| 2. Daily snapshot  | Automated managed snapshot    | 30 days                  | Fast, coarse-grained         |
| 3. Weekly snapshot | Automated managed snapshot    | 12 weeks                 | Long-term                    |
| 4. Offsite copy    | Cross-region or export        | Per policy               | Region or provider loss      |
| 5. Offsite copy    | **Object storage versioning** | Indefinite               | Deleted or overwritten files |

Four layers for one reason: **each covers a failure the others do not.** A daily
snapshot inside the same region does not survive a regional outage. Point-in-time
recovery does not survive losing the provider's backup storage. Object storage
versioning does not survive a deletion, which is the most common way files are
actually lost.

## Encryption

|                | At rest                                       | In transit          |
| -------------- | --------------------------------------------- | ------------------- |
| Database       | Managed encryption, customer key if available | TLS to the database |
| Backups        | Encrypted, ideally with a separately held key | TLS on export       |
| Object storage | Server-side encryption                        | TLS                 |

**A backup encrypted with a key that lives only in the database being backed up is
not recoverable.** Key custody is separate from the data, and separating it is the
point.

Hold the key in the secret manager, and confirm that restoring does not require
the failed system's own credentials.

## Restoring

The procedure, in the order that matters:

```
1.  Provision a new database
2.  Apply credentials and extensions
3.  Create the lms_app role and its REVOKEs
4.  Restore from the most recent viable backup
5.  Apply remaining WAL to reach the target time
6.  Run npm run db:deploy   — migrate + assert invariants
7.  Verify: row counts, grants, constraints, a smoke test
8.  Reconcile recent activity against the audit log
```

Steps 3 and 6 are the ones a restore guide written by someone who has never
restored omits.

**Step 3 matters.** `REVOKE DELETE` on `audit_logs` is a grant on the _role_, not
a property of the data. Restoring into a fresh cluster without reapplying the
grants produces a database where the application can delete history — a silent,
severe posture regression. `db:deploy`'s invariant assertions exist precisely to
catch this, which is why step 6 is not optional.

**Step 6 also catches a stale restore.** A backup taken before a migration, applied
to a schema that has since moved forward, is caught by `migrate deploy` either by
applying what is missing or failing loudly.

### Verification checklist

After every restore, before the system is returned to service:

- [ ] Row counts match the source for every table
- [ ] `audit_logs` has its historical depth — no truncation
- [ ] `lms_app` has **no** `DELETE` on `audit_logs`, `loans`, `fines`, `fine_payments`
- [ ] `lms_app` has no `UPDATE` on the history tables
- [ ] Every expected `CHECK` constraint exists
- [ ] Every expected partial unique index exists and is valid
- [ ] The append-only triggers exist
- [ ] `SELECT count(*)` on `roles`, `permissions`, `role_permissions` matches
- [ ] A real login succeeds
- [ ] A real member lookup returns correct data
- [ ] Object storage references resolve — no missing cover images

The last item is the one that catches a database-only restore, which is the most
common incomplete recovery.

## Restore drill

**Scheduled, rehearsed, and it must restore real data.** Quarterly is the
cadence that matches how fast a procedure is forgotten.

The drill:

1. Restore the most recent backup into an isolated environment.
2. Run the verification checklist above, in full.
3. Time it. **That measured time is the real RTO.**
4. Record what went wrong.
5. Fix the gap before the next drill.

A drill that only checks "the database came up" proves almost nothing: it says
nothing about the grants, the invariants, or the elapsed time, which are the three
things that determine whether the RTO is real.

**A drill that has never found a problem was not a real drill.** The first one
almost always does.

## Reconciliation after a restore

A point-in-time restore loses up to the RPO. For a library, that window may
contain loans genuinely issued, returns genuinely processed, and payments
genuinely taken.

The audit log is what makes reconciliation possible, because it is append-only
and contains the actor and the action:

1. Identify the restore point's timestamp.
2. List audit entries after it.
3. Identify state-changing actions: `LOAN_CREATED`, `LOAN_RETURNED`,
   `LOAN_RENEWED`, `FINE_PAID`, `PAYMENT_RECORDED`, `RESERVATION_*`.
4. Re-apply or reconcile each against the restored state.
5. Record the reconciliation as its own audited event, with a note explaining
   that it is post-restore.

Step 5 is what stops a second reconciliation from being needed: the operator can
see that the window was already reconciled, and by whom.

Payments are the priority — a member who paid and is now showing a balance is the
failure a library cannot explain to a member.

## Object storage

Separate from the database, with its own guarantees:

- **Versioning enabled** — recovers a deleted or overwritten file, which is how
  files are usually lost.
- **Lifecycle policy** — non-current versions retained per policy.
- **Private by default.** Signed URLs only, short-lived
  (`SIGNED_URL_TTL_SECONDS`, default 300). No public objects, ever.
- **Lifecycle rules for digital resources** must align with the retention policy.
  A cover image expiring while its book record is retained forever is a dangling
  reference in the catalogue.

Only a **storage key** is persisted in the database, never a URL. That is what
makes a bucket move or a domain change a configuration change rather than a data
migration.

## What is deliberately not backed up

|                  | Why                                                                         |
| ---------------- | --------------------------------------------------------------------------- |
| Build artifacts  | Reproducible from the commit                                                |
| Container images | Reproducible from source; a registry holds them                             |
| `node_modules`   | `npm ci`                                                                    |
| Redis            | A cache. Nothing in it is authoritative                                     |
| `.env`           | Secrets are in the secret manager; the backup key must not be in the backup |
| Local volumes    | Development only                                                            |

Redis is worth stating explicitly: because it holds no authoritative state,
**losing it loses nothing.** That is a direct consequence of designing every
optional use with a correct in-process fallback — see
[System architecture](../architecture.md#runtime-topology).

## Testing recovery

Recovery is tested by the drill, not by a unit test. But two things can be
asserted automatically:

- **Backup age** — a monitoring check that the most recent backup is within the
  expected window. A silent backup failure is the failure mode where nobody
  discovers the problem until the day it is needed.
- **The `db:deploy` invariant assertions** — which run on every deploy and are
  exactly the assertions a restore needs. See [Deployment](./deployment.md).

Backup age is covered in [Monitoring](./monitoring.md).

## Related

- [Deployment](./deployment.md) — the deploy sequence and migration rules
- [Monitoring](./monitoring.md) — backup age alerting
- [Business rules](../database/business-rules.md#audit-immutability) — why the data cannot be deleted
- [Security architecture](../security/security-architecture.md#the-lms_app-role)
