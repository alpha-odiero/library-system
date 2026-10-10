-- ═══════════════════════════════════════════════════════════════════════════
-- Invariants Prisma cannot express.
--
-- Everything in this file is load-bearing business/security enforcement:
--   §0  Extensions the search indexes depend on
--   §A  Money and state CHECK constraints
--   §B  Partial UNIQUE indexes — the concurrency guarantees
--   §C  Append-only immutability for audit history
--   §D  Search indexes (trigram + full-text)
--   §E  Runtime grants for the application role
--
-- Rule for future migrations: constraints and partial indexes are ADDED, never
-- dropped and recreated casually. Dropping §B-1 would allow double-borrowing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- §0. Extensions
-- ───────────────────────────────────────────────────────────────────────────

-- pg_trgm and unaccent are required by the §D search indexes. They are created
-- here so that `prisma migrate deploy` also works against a managed PostgreSQL
-- instance, where no database bootstrap script runs.
-- Both live in pg_catalog on every supported provider, so this is a no-op there.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ───────────────────────────────────────────────────────────────────────────
-- §A. CHECK constraints
-- ───────────────────────────────────────────────────────────────────────────

-- A1. Money is never negative, and a waiver can never exceed the assessment.
ALTER TABLE "fines"
  ADD CONSTRAINT "ck_fines_non_negative"
  CHECK ("amount" >= 0 AND "waived_amount" >= 0 AND "waived_amount" <= "amount");

-- A2. A payment is always strictly positive (voiding uses voided_at, not a negative row).
ALTER TABLE "fine_payments"
  ADD CONSTRAINT "ck_payment_positive"
  CHECK ("amount" > 0);

-- A3. Acquisition costs are non-negative when present.
ALTER TABLE "book_copies"
  ADD CONSTRAINT "ck_copy_prices_non_negative"
  CHECK (("purchase_price"   IS NULL OR "purchase_price"   >= 0)
     AND ("replacement_cost" IS NULL OR "replacement_cost" >= 0));

-- A4. Borrowing policy must be internally coherent.
ALTER TABLE "member_types"
  ADD CONSTRAINT "ck_member_type_policy"
  CHECK ("max_active_loans"   >= 0
     AND "loan_duration_days"   > 0
     AND "max_renewals"        >= 0
     AND "renewal_duration_days" > 0
     AND "grace_period_days"    >= 0
     AND "fine_per_day"         >= 0
     AND ("max_fine_cap" IS NULL OR "max_fine_cap" >= 0)
     AND "reservation_limit"    >= 0
     AND "hold_duration_days"    > 0);

-- A5. A loan cannot be due before it was issued.
ALTER TABLE "loans" ADD CONSTRAINT "ck_loan_dates" CHECK ("due_date" >= "loaned_at");

-- A6. A return cannot predate the loan.
ALTER TABLE "loans"
  ADD CONSTRAINT "ck_loan_return_after_issue"
  CHECK ("returned_at" IS NULL OR "returned_at" >= "loaned_at");

-- A7. Renewal count cannot exceed the ordinal already recorded in the ledger.
--     (Defence in depth: the ledger's unique (loan_id, renewal_number) is the
--      real guarantee; this stops a bad UPDATE from desynchronising the two.)
ALTER TABLE "loans" ADD CONSTRAINT "ck_loan_renewal_count" CHECK ("renewal_count" >= 0);

-- A8. A renewal must extend, never shorten, the due date.
ALTER TABLE "loan_renewals"
  ADD CONSTRAINT "ck_renewal_extends_due_date" CHECK ("new_due_date" > "previous_due_date");

-- A9. A member's membership expiry must postdate their joining date.
ALTER TABLE "members"
  ADD CONSTRAINT "ck_member_dates" CHECK ("expires_at" IS NULL OR "expires_at" >= "joined_at");

-- A10. Queue positions and ordinals are 1-based.
ALTER TABLE "reservations" ADD CONSTRAINT "ck_reservation_position" CHECK ("position" > 0);

-- A11. A void must record who voided and when — never silently.
ALTER TABLE "fine_payments"
  ADD CONSTRAINT "ck_payment_void_complete"
  CHECK (("voided_at" IS NULL AND "voided_by" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL));

-- A12. A waiver must record a reason for auditability.
ALTER TABLE "fines"
  ADD CONSTRAINT "ck_fine_waiver_complete"
  CHECK (("waived_amount" = 0) OR ("waived_at" IS NOT NULL AND "waiver_reason" IS NOT NULL));

-- A13. A copy is only REMOVED if the reason was recorded.
ALTER TABLE "book_copies"
  ADD CONSTRAINT "ck_copy_removal_complete"
  CHECK ("removed_at" IS NULL OR "removed_reason" IS NOT NULL);

-- A14. A READY reservation must have been notified and must expire.
ALTER TABLE "reservations"
  ADD CONSTRAINT "ck_reservation_ready_complete"
  CHECK ("status" <> 'READY' OR ("ready_at" IS NOT NULL AND "hold_expires_at" IS NOT NULL));

-- A15. Sessions must expire in the future relative to issue time.
ALTER TABLE "sessions"
  ADD CONSTRAINT "ck_session_dates" CHECK ("expires_at" > "issued_at");

-- ───────────────────────────────────────────────────────────────────────────
-- §B. Partial UNIQUE indexes — the concurrency guarantees
--
-- These are the hard, non-bypassable layer of the concurrency model. Even if a
-- service forgets its business check, the database refuses the write.
-- ───────────────────────────────────────────────────────────────────────────

-- B1. A physical copy cannot have two concurrent open loans.
--     Without this, two librarians scanning COPY-001 simultaneously would both
--     succeed. Application-level `SELECT ... FOR UPDATE` handles the friendly
--     error path; this index guarantees correctness.
CREATE UNIQUE INDEX "uq_loan_one_open_per_copy"
  ON "loans" ("copy_id")
  WHERE "status" IN ('ACTIVE', 'OVERDUE');

-- B2. A member cannot hold two open reservations for the same title.
CREATE UNIQUE INDEX "uq_reservation_one_open_per_member_book"
  ON "reservations" ("member_id", "book_id")
  WHERE "status" IN ('ACTIVE', 'READY');

-- B3. At most one open digital loan per member per resource.
CREATE UNIQUE INDEX "uq_digital_loan_one_open_per_member_resource"
  ON "digital_loans" ("member_id", "resource_id")
  WHERE "returned_at" IS NULL;

-- B4. An automatically assessed overdue fine exists at most once per loan.
--     (A partial unique index is required: a loan may legitimately carry many
--      manual DAMAGE/OTHER fines across its lifetime.)
--
--     The schema previously declared `loanId` globally UNIQUE, which was both
--     stronger than intended and in tension with this rule: it capped ALL fines
--     per loan at one, so a second damage fine was impossible. That attribute and
--     its index have been removed, and the schema now models Loan → fines as
--     one-to-many. The FK itself is unchanged.
CREATE UNIQUE INDEX "uq_fine_one_overdue_per_loan"
  ON "fines" ("loan_id")
  WHERE "loan_id" IS NOT NULL AND "type" IN ('OVERDUE', 'LATE_RETURN') AND "status" <> 'VOID';

-- Supports "all fines for this loan" lookups now that one-to-many is possible.
-- Declared as @@index([loanId]) in the schema, so Prisma emits it as
-- "fines_loan_id_idx" in the init migration; creating it here is therefore
-- idempotent and never a duplicate.
CREATE INDEX IF NOT EXISTS "fines_loan_id_idx" ON "fines" ("loan_id");

-- B5. Only one primary category per book.
CREATE UNIQUE INDEX "uq_book_one_primary_category"
  ON "book_categories" ("book_id")
  WHERE "is_primary" = true;

-- B6. Queue positions are unique among the live holds of one title, so two
--     concurrent "next in queue" computations cannot land on the same slot.
CREATE UNIQUE INDEX "uq_reservation_position_live"
  ON "reservations" ("book_id", "position")
  WHERE "status" IN ('ACTIVE', 'READY');

-- ───────────────────────────────────────────────────────────────────────────
-- §C. Append-only immutability
--
-- `audit_logs` must never be edited or deleted, not even by the owner role.
-- The trigger makes that a database property rather than a convention.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION raise_immutable_violation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Table "%" is append-only: % is not permitted. Audit history cannot be rewritten.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_no_update_delete ON "audit_logs";
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable_violation();

-- Status-history ledgers share the same evidentiary property.
DROP TRIGGER IF EXISTS loan_status_history_no_update_delete ON "loan_status_history";
CREATE TRIGGER loan_status_history_no_update_delete
  BEFORE UPDATE OR DELETE ON "loan_status_history"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable_violation();

DROP TRIGGER IF EXISTS copy_status_history_no_update_delete ON "copy_status_history";
CREATE TRIGGER copy_status_history_no_update_delete
  BEFORE UPDATE OR DELETE ON "copy_status_history"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable_violation();

-- ───────────────────────────────────────────────────────────────────────────
-- §D. Search indexes
--
-- Search must be database-backed. Trigram indexes give substring matching for
-- partially-scanned barcodes and typo-tolerant titles; the weighted tsvector
-- expression index powers ranked catalogue search.
-- ───────────────────────────────────────────────────────────────────────────

-- D1. Fuzzy barcode / accession lookup (handheld scanners can be imprecise).
CREATE INDEX "idx_book_copies_barcode_trgm"
  ON "book_copies" USING GIN ("barcode" gin_trgm_ops);

CREATE INDEX "idx_book_copies_accession_trgm"
  ON "book_copies" USING GIN ("accession_number" gin_trgm_ops);

-- D2. Typo-tolerant title search ("clean code" → "Clemn Code").
CREATE INDEX "idx_books_title_trgm"
  ON "books" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "idx_books_subtitle_trgm"
  ON "books" USING GIN ("subtitle" gin_trgm_ops);

-- D3. Ranked full-text search: title weighted A, subtitle B, summary C.
CREATE INDEX "idx_books_fulltext"
  ON "books" USING GIN (
    (setweight(to_tsvector('simple', coalesce("title",    '')), 'A') ||
     setweight(to_tsvector('simple', coalesce("subtitle", '')), 'B') ||
     setweight(to_tsvector('simple', coalesce("summary",  '')), 'C'))
  );

-- D4. Author search (simple config so names with accents still match).
CREATE INDEX "idx_authors_fulltext"
  ON "authors" USING GIN (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("sort_name", '')));

-- D5. Subject headings are array-queried by GIN.
CREATE INDEX "idx_books_subjects_gin" ON "books" USING GIN ("subjects");

-- D6. Combined title+author catalogue search surface.
CREATE INDEX "idx_books_title_lower" ON "books" (lower("title") text_pattern_ops);

-- D7. Reporting: fines outstanding per member, and revenue over time.
CREATE INDEX "idx_fines_member_status_assessed"
  ON "fines" ("member_id", "status", "assessed_at");

-- D8. Overdue sweep batch: only open loans past their grace date.
CREATE INDEX "idx_loans_open_due_date"
  ON "loans" ("due_date", "grace_until")
  WHERE "status" IN ('ACTIVE', 'OVERDUE');

-- D9. Reservation hold-expiry sweep.
CREATE INDEX "idx_reservations_ready_hold"
  ON "reservations" ("hold_expires_at")
  WHERE "status" = 'READY';

-- ───────────────────────────────────────────────────────────────────────────
-- §E. Statement/row-level hardening for the application role
--
-- Run by the platform's provisioning step. Harmless no-op when the role does
-- not yet exist (local development / CI).
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON "audit_logs" FROM lms_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON "loan_status_history" FROM lms_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON "copy_status_history" FROM lms_app';
    EXECUTE 'REVOKE DELETE ON "loans" FROM lms_app';
    EXECUTE 'REVOKE DELETE ON "fines" FROM lms_app';
    EXECUTE 'REVOKE DELETE ON "fine_payments" FROM lms_app';
  END IF;
END
$$;