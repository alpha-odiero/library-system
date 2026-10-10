-- Runtime proof that §B partial unique indexes actually reject bad data.
--
-- Each block below attempts an INSERT that MUST fail. The DO blocks invert the
-- expectation: they raise an exception if the write unexpectedly succeeded, so
-- a dropped or mistyped partial index fails this script loudly instead of
-- silently permitting a double-borrow.
--
-- Run with:  npm run db:invariants
-- This script is read-only with respect to real data: it creates one throwaway
-- library and rolls nothing back, so it must be run against a disposable database.

\set ON_ERROR_STOP on

BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_library_id  uuid := gen_random_uuid();
  v_branch_id   uuid := gen_random_uuid();
  v_role_id     uuid := gen_random_uuid();
  v_user_id     uuid := gen_random_uuid();
  v_type_id     uuid := gen_random_uuid();
  v_book_id     uuid := gen_random_uuid();
  v_copy_id     uuid := gen_random_uuid();
  v_member_id   uuid := gen_random_uuid();
  v_loan_id     uuid := gen_random_uuid();
BEGIN
  INSERT INTO libraries (id, code, name, timezone, created_at, updated_at)
    VALUES (v_library_id, 'INVTEST', 'Invariant Test', 'Africa/Nairobi', now(), now());

  INSERT INTO branches (id, library_id, code, name, created_at, updated_at)
    VALUES (v_branch_id, v_library_id, 'MAIN', 'Main', now(), now());

  -- member_types and roles are global reference data, not library-scoped.
  INSERT INTO roles (id, code, name, "isSystem", rank, created_at, updated_at)
    VALUES (v_role_id, 'INVTEST_ROLE', 'Invariant Test Role', false, 0, now(), now());

  INSERT INTO member_types (id, code, name, created_at, updated_at)
    VALUES (v_type_id, 'INVTEST_TYPE', 'Invariant Test Type', now(), now());

  INSERT INTO users (id, email, password_hash, first_name, last_name, status, role_id,
                     must_change_password, failed_login_count, created_at, updated_at)
    VALUES (v_user_id, 'invariants@local.test', 'x', 'Inv', 'Test', 'ACTIVE', v_role_id,
            false, 0, now(), now());

  INSERT INTO books (id, title, language, created_at, updated_at)
    VALUES (v_book_id, 'Invariant Test Title', 'en', now(), now());

  INSERT INTO book_copies (id, book_id, branch_id, accession_number, barcode, qr_token,
                           "condition", status, created_at, updated_at)
    VALUES (v_copy_id, v_book_id, v_branch_id, 'ACC-1', 'BC-1', 'QR-1',
            'GOOD', 'AVAILABLE', now(), now());

  INSERT INTO members (id, membership_number, user_id, member_type_id, home_branch_id,
                       status, joined_at, created_at, updated_at)
    VALUES (v_member_id, 'M-1', v_user_id, v_type_id, v_branch_id,
            'ACTIVE', now(), now(), now());

  INSERT INTO loans (id, copy_id, book_id, member_id, branch_id, issued_by, member_type_id,
                     loaned_at, due_date, status, renewal_count, created_at, updated_at)
    VALUES (v_loan_id, v_copy_id, v_book_id, v_member_id, v_branch_id, v_user_id, v_type_id,
            now(), now() + interval '14 days', 'ACTIVE', 0, now(), now());
END
$$;

-- ── B1. One open loan per physical copy ──────────────────────────────────────
-- A second ACTIVE loan on the same copy must be rejected, even though the copy
-- is referenced by a completely different loan row.
DO $$
DECLARE v_loan_id uuid;
BEGIN
  BEGIN
    INSERT INTO loans (id, copy_id, book_id, member_id, branch_id, issued_by, member_type_id,
                       loaned_at, due_date, status, renewal_count, created_at, updated_at)
      SELECT gen_random_uuid(), bc.id, b.id, m.id, m.home_branch_id, u.id, m.member_type_id,
             now(), now() + interval '14 days', 'ACTIVE', 0, now(), now()
        FROM book_copies bc
        JOIN books b ON b.id = bc.book_id
        JOIN members m ON m.membership_number = 'M-1'
        JOIN users u ON u.id = m.user_id
       WHERE bc.barcode = 'BC-1'
      RETURNING id INTO v_loan_id;

    RAISE EXCEPTION 'B1 FAILED: a second open loan on one copy was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'B1 ok: duplicate open loan rejected';
  END;
END
$$;

-- ── A6. A return cannot predate the loan ─────────────────────────────────────
DO $$
DECLARE
  v_loan_id uuid;
BEGIN
  SELECT id INTO v_loan_id FROM loans WHERE status = 'ACTIVE' LIMIT 1;

  BEGIN
    UPDATE loans
       SET returned_at = loaned_at - interval '1 day'
     WHERE id = v_loan_id;

    RAISE EXCEPTION 'A6 FAILED: a return before the issue date was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'A6 ok: backdated return rejected';
  END;
END
$$;

-- ── A1. A waiver may not exceed the assessment ───────────────────────────────
DO $$
DECLARE v_loan_id uuid;
BEGIN
  SELECT id INTO v_loan_id FROM loans WHERE status = 'ACTIVE' LIMIT 1;

  BEGIN
    INSERT INTO fines (reference, member_id, loan_id, type, description, amount, waived_amount,
                       status, assessed_at, created_at, updated_at)
      VALUES ('INV-F1', (SELECT member_id FROM loans WHERE id = v_loan_id), v_loan_id,
              'OVERDUE', 'over-waiver attempt', 100.00, 150.00, 'OUTSTANDING', now(), now(), now());

    RAISE EXCEPTION 'A1 FAILED: a waiver larger than the fine was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'A1 ok: over-waiver rejected';
  END;
END
$$;

-- ── A2. A payment must be strictly positive ──────────────────────────────────
DO $$
DECLARE v_fine_id uuid;
BEGIN
  INSERT INTO fines (reference, member_id, type, description, amount, waived_amount, status,
                     assessed_at, created_at, updated_at)
    VALUES ('INV-F2', (SELECT id FROM members WHERE membership_number = 'M-1'),
            'OTHER', 'payment probe', 50.00, 0, 'OUTSTANDING', now(), now(), now())
    RETURNING id INTO v_fine_id;

  BEGIN
    INSERT INTO fine_payments (receipt_number, fine_id, amount, method, paid_at,
                               received_by, created_at)
      VALUES ('INV-P1', v_fine_id, 0, 'CASH', now(),
              (SELECT user_id FROM members WHERE membership_number = 'M-1'), now());

    RAISE EXCEPTION 'A2 FAILED: a zero-amount payment was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'A2 ok: zero payment rejected';
  END;
END
$$;

-- ── B4. One automatic overdue fine per loan, but many manual ones ────────────
DO $$
DECLARE
  v_loan_id uuid;
  v_member_id uuid;
BEGIN
  SELECT id, member_id INTO v_loan_id, v_member_id
    FROM loans WHERE status = 'ACTIVE' LIMIT 1;

  -- First automatic fine is fine.
  INSERT INTO fines (reference, member_id, loan_id, type, description, amount, waived_amount, status,
                     assessed_at, created_at, updated_at)
    VALUES ('INV-F3', v_member_id, v_loan_id, 'OVERDUE', 'first automatic fine', 10.00, 0, 'OUTSTANDING',
            now(), now(), now());

  -- Second automatic fine on the same loan must be rejected.
  BEGIN
    INSERT INTO fines (reference, member_id, loan_id, type, description, amount, waived_amount, status,
                       assessed_at, created_at, updated_at)
      VALUES ('INV-F4', v_member_id, v_loan_id, 'OVERDUE', 'second automatic fine', 10.00, 0, 'OUTSTANDING',
              now(), now(), now());

    RAISE EXCEPTION 'B4 FAILED: a second automatic overdue fine was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'B4 ok: duplicate automatic fine rejected';
  END;

  -- Several manual damage fines on the same loan MUST be accepted. This is the
  -- case that a global UNIQUE on loan_id would wrongly forbid.
  BEGIN
    INSERT INTO fines (reference, member_id, loan_id, type, description, amount, waived_amount, status,
                       assessed_at, created_at, updated_at)
      VALUES ('INV-F5', v_member_id, v_loan_id, 'DAMAGE', 'first damage', 20.00, 0, 'OUTSTANDING',
              now(), now(), now()),
             ('INV-F6', v_member_id, v_loan_id, 'DAMAGE', 'second damage', 30.00, 0, 'OUTSTANDING',
              now(), now(), now());

    RAISE NOTICE 'B4 ok: multiple manual fines accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION
        'B4 REGRESSION: multiple manual fines on one loan were rejected. '
        'A global UNIQUE on fines.loan_id has returned.';
  END;
END
$$;

-- ── A11. A voided payment must record who voided it ──────────────────────────
-- Proves the CHECK that pairs voided_at with voided_by. Setting only one of the
-- two would otherwise leave an audit trail with no actor.
DO $$
DECLARE
  v_fine_id uuid;
  v_pay_id  uuid;
BEGIN
  SELECT id INTO v_fine_id FROM fines WHERE reference = 'INV-F2';

  -- A valid payment first. The zero-amount attempt in A2 was rolled back by the
  -- database, so there is no row to void yet.
  INSERT INTO fine_payments (receipt_number, fine_id, amount, method, paid_at,
                             received_by, created_at)
    VALUES ('INV-P2', v_fine_id, 25.00, 'CASH', now(),
            (SELECT user_id FROM members WHERE membership_number = 'M-1'), now())
    RETURNING id INTO v_pay_id;

  BEGIN
    UPDATE fine_payments SET voided_at = now() WHERE id = v_pay_id;
    RAISE EXCEPTION 'A11 FAILED: a payment was voided without recording who voided it';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'A11 ok: incomplete void rejected';
  END;

  -- Both halves present: this must be accepted, otherwise valid voids are
  -- impossible and the constraint is simply broken.
  UPDATE fine_payments
     SET voided_at = now(), voided_by = (SELECT user_id FROM members WHERE membership_number = 'M-1')
   WHERE id = v_pay_id;
  RAISE NOTICE 'A11 ok: complete void accepted';
END
$$;

-- ── §C. Audit history is append-only ─────────────────────────────────────────
-- The trigger must block UPDATE and DELETE even for the table owner, because the
-- application's own role owns the table. If this succeeds, the audit trail can
-- be rewritten and the log is worthless.
DO $$
DECLARE
  v_log_id bigint;
BEGIN
  -- action is a closed AuditAction enum, so a real value is used rather than an
  -- invented one. The point of this block is the trigger, not the action's
  -- meaning, and the whole transaction rolls back regardless.
  --
  -- No exception handler on purpose: if the insert fails, this script must fail
  -- too. Silently skipping would report the audit trigger as unverified.
  INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id,
                          description, created_at)
    SELECT u.id, 'invariant-check@local.test', 'BOOK_CREATED', 'Book',
           gen_random_uuid(), 'invariant check', now()
      FROM users u LIMIT 1
    RETURNING id INTO v_log_id;

  -- The trigger raises restrict_violation (23001), not plain raise_exception.
  -- Catching the specific SQLSTATE matters: a blanket WHEN others would also
  -- swallow the assertion failures below, so a genuinely missing trigger could
  -- report as success.
  BEGIN
    UPDATE audit_logs SET description = 'tampered' WHERE id = v_log_id;
    RAISE EXCEPTION 'C FAILED: an audit log row was UPDATED';
  EXCEPTION
    WHEN restrict_violation THEN
      RAISE NOTICE 'C ok: audit update rejected';
  END;

  BEGIN
    DELETE FROM audit_logs WHERE id = v_log_id;
    RAISE EXCEPTION 'C FAILED: an audit log row was DELETED';
  EXCEPTION
    WHEN restrict_violation THEN
      RAISE NOTICE 'C ok: audit delete rejected';
  END;
END
$$;

-- ── B5. Only one primary category per book ───────────────────────────────────
DO $$
DECLARE
  v_book_id uuid;
  v_cat_a   uuid := gen_random_uuid();
  v_cat_b   uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_book_id FROM books WHERE title = 'Invariant Test Title';

  INSERT INTO categories (id, name, slug, created_at, updated_at)
    VALUES (v_cat_a, 'Inv A', 'inv-a', now(), now()),
           (v_cat_b, 'Inv B', 'inv-b', now(), now());

  INSERT INTO book_categories (book_id, category_id, is_primary)
    VALUES (v_book_id, v_cat_a, true);

  BEGIN
    INSERT INTO book_categories (book_id, category_id, is_primary)
      VALUES (v_book_id, v_cat_b, true);

    RAISE EXCEPTION 'B5 FAILED: a second primary category was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'B5 ok: second primary category rejected';
  END;
END
$$;

ROLLBACK;

\echo 'All invariant checks passed.'