-- ═══════════════════════════════════════════════════════════════════════════
-- Library tenancy (Gate 2) and the borrow-request workflow.
--
-- Adds:
--   §F  Library onboarding fields (type, description, logo, opening hours)
--   §G  User → library tenancy anchor, plus staff identifiers
--   §H  BorrowRequest model and its enums
--   §I  Backfill of users.library_id
--   §J  Concurrency invariants Prisma cannot express
--
-- HAND-WRITTEN, not Prisma-generated. `prisma migrate diff` emits DROP INDEX for
-- the trigram/GIN search indexes of §D, because Prisma does not model indexes it
-- did not create. Applying its output would silently delete them and turn every
-- title search into a sequential scan on a catalogue-sized table. Those indexes
-- are deliberately absent below for the same reason — they still exist, so
-- re-creating them here would be a duplicate.
--
-- Verified against `prisma migrate diff` output; the DDL below is that output
-- minus the §D drops, plus the backfill and §J that Prisma cannot express.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- §A. Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "BorrowRequestStatus" AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'ISSUED'
);

-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on PostgreSQL
-- < 12, and cannot be used in the same transaction as a query of the new value.
-- Every supported target is 12+, so these are safe here; on 11 they would need
-- splitting into one migration per value.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BORROW_REQUEST_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BORROW_REQUEST_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BORROW_REQUEST_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BORROW_REQUEST_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BORROW_REQUEST_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LIBRARY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_CREDENTIALS_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_PASSWORD_RESET_BY_ADMIN';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BORROW_REQUEST_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BORROW_REQUEST_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BORROW_REQUEST_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BORROW_REQUEST_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_CREDENTIALS_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LIBRARIAN_ADDED';

-- ─────────────────────────────────────────────────────────────────────────────
-- §F. Library onboarding fields
--
-- All nullable and default-free: an existing library has a name, a code and a
-- timezone, and nothing more. Requiring any of these here would force a value
-- that is not knowable and not true.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "libraries"
  ADD COLUMN "type" VARCHAR(60),
  ADD COLUMN "description" TEXT,
  ADD COLUMN "logo_url" TEXT,
  ADD COLUMN "opening_hours" JSONB;

-- ─────────────────────────────────────────────────────────────────────────────
-- §G. User tenancy anchor and staff identifiers
--
-- library_id is NULLABLE and deliberately not backfilled NOT NULL here:
--   • A user with no branch has no derivable library, and inventing one would be
--     a false claim about which tenant owns their data.
--   • Making it NOT NULL would additionally require every future write path to
--     supply it, turning this migration into a permanent constraint on code that
--     does not exist yet.
--
-- Instead the application treats a NULL library as "no library scope" and refuses
-- library-scoped operations, and §I backfills what genuinely is derivable. A
-- follow-up migration can tighten to NOT NULL once no NULLs remain.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN "library_id" UUID,
  ADD COLUMN "employee_id" VARCHAR(50),
  ADD COLUMN "profile_image_url" TEXT,
  ADD COLUMN "primary_library_id" UUID,
  ADD COLUMN "primary_library_admin" BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- §H. BorrowRequest table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "borrow_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "library_id" UUID NOT NULL,
  "member_id" UUID NOT NULL,
  "book_id" UUID NOT NULL,
  "status" "BorrowRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reserved_copy_id" UUID,
  "issued_loan_id" UUID,
  "decided_by" UUID,
  "decided_at" TIMESTAMP(3),
  "decision_reason" VARCHAR(500),
  "branch_id" UUID,
  "expires_at" TIMESTAMP(3),
  "notes" VARCHAR(2000),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "borrow_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "borrow_requests_issued_loan_id_key"
  ON "borrow_requests" ("issued_loan_id");

CREATE INDEX "borrow_requests_member_id_book_id_status_idx"
  ON "borrow_requests" ("member_id", "book_id", "status");

CREATE INDEX "borrow_requests_library_id_status_created_at_idx"
  ON "borrow_requests" ("library_id", "status", "created_at");

CREATE INDEX "borrow_requests_status_expires_at_idx"
  ON "borrow_requests" ("status", "expires_at");

CREATE INDEX "borrow_requests_reserved_copy_id_idx"
  ON "borrow_requests" ("reserved_copy_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_library_id_fkey"
    FOREIGN KEY ("library_id") REFERENCES "libraries" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "users_primary_library_id_fkey"
    FOREIGN KEY ("primary_library_id") REFERENCES "libraries" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "users_primary_library_id_key" ON "users" ("primary_library_id");
CREATE INDEX "users_library_id_idx" ON "users" ("library_id");
CREATE INDEX "users_library_id_employee_id_idx" ON "users" ("library_id", "employee_id");

ALTER TABLE "borrow_requests"
  ADD CONSTRAINT "borrow_requests_library_id_fkey"
    FOREIGN KEY ("library_id") REFERENCES "libraries" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "borrow_requests_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "members" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "borrow_requests_book_id_fkey"
    FOREIGN KEY ("book_id") REFERENCES "books" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "borrow_requests_reserved_copy_id_fkey"
    FOREIGN KEY ("reserved_copy_id") REFERENCES "book_copies" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "borrow_requests_issued_loan_id_fkey"
    FOREIGN KEY ("issued_loan_id") REFERENCES "loans" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "borrow_requests_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "borrow_requests_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "borrow_requests_decided_by_fkey"
    FOREIGN KEY ("decided_by") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- §I. Backfill users.library_id
--
-- Two passes, ordered by specificity. Both are UPDATE ... FROM joins so the whole
-- backfill is a single sequential scan per pass rather than a per-row trigger.
--
-- Pass 1: the library that owns the user's home branch. This is the authoritative
--         answer for staff and for members, both of whom have a home branch.
--
-- Pass 2: a user with no branch but exactly one library in existence. This covers
--         a platform superadmin in a single-library deployment. Guarded by the
--         count = 1 test, so it can never guess between two libraries — a wrong
--         attribution here would grant cross-library reach, which is the exact
--         failure this migration is meant to prevent.
--
-- Deliberately NOT done: soft-deleted users are updated too. A deleted user has
-- no sessions and cannot authenticate, so leaving them NULL would be harmless, but
-- restoring one must not produce a user with no library. Cost is negligible.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE "users" AS u
SET "library_id" = b."library_id"
FROM "branches" AS b
WHERE u."primary_branch_id" = b."id"
  AND u."library_id" IS NULL;

UPDATE "users" AS u
SET "library_id" = l."id"
FROM "libraries" AS l
WHERE u."library_id" IS NULL
  AND (SELECT COUNT(*) FROM "libraries") = 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- §J. Concurrency invariants Prisma cannot express
--
-- J1. A member cannot have two PENDING requests for the same title. Without this,
--     a double-clicking student files two identical requests, both reach a
--     librarian's desk, and approval produces two loans or a confusing queue.
--     Partial, because CANCELLED/REJECTED/EXPIRED history must be retained and a
--     member must be able to re-request a title they previously rejected.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_borrow_request_one_pending_per_member_book"
  ON "borrow_requests" ("member_id", "book_id")
  WHERE "status" = 'PENDING';

-- J2. A copy cannot be reserved by two open requests. The library holds many
--     copies of a title, but any ONE copy is a single physical object: reserving
--     it for two students and approving both would double-issue, which §B-1 stops
--     only at loan time — after both students believe they have the book.
--     Matches the open set APPROVED + PENDING-with-copy, since approval is what
--     actually commits the copy.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_borrow_request_one_open_per_copy"
  ON "borrow_requests" ("reserved_copy_id")
  WHERE "reserved_copy_id" IS NOT NULL
    AND "status" IN ('PENDING', 'APPROVED');

-- J3. A loan satisfies at most one request. `issued_loan_id` is already UNIQUE,
--     but that permits a NULL-heavy column to hold many nulls while a non-null
--     value is still unique — which is the desired behaviour, so this is stated
--     as documentation rather than a new index. The UNIQUE above is the guarantee.
--
-- J4. A rejected request must carry a reason. A student told "no" with no
--     explanation cannot act on it, and staff who cannot see why a decision was
--     made cannot defend it later. NULL is still allowed for CANCELLED (a student
--     closing their own request needs no justification) and PENDING.
ALTER TABLE "borrow_requests"
  ADD CONSTRAINT "ck_borrow_request_rejected_has_reason"
  CHECK ("status" <> 'REJECTED' OR "decision_reason" IS NOT NULL);

-- J5. An issued request must reference its loan, and nothing else may.
--     Enforces the workflow's central invariant at the database: APPROVED is a
--     commitment, ISSUED is a fact about a Loan row, and no other status can
--     carry one.
ALTER TABLE "borrow_requests"
  ADD CONSTRAINT "ck_borrow_request_issued_has_loan"
  CHECK (("status" = 'ISSUED') = ("issued_loan_id" IS NOT NULL));