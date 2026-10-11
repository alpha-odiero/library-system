-- ═══════════════════════════════════════════════════════════════════════════
-- Composite indexes for the hot list endpoints.
--
-- Every list service filters by a scope key (branch/member), optionally by
-- status, then orders by a timestamp (loaned_at / reserved_at / assessed_at /
-- created_at). The pre-existing indexes led with the scope key but not the
-- timestamp, so PostgreSQL still had to sort the matching rows on every page.
-- These covering-order indexes let each list be read in index order.
--
-- Additive only: no column, constraint, or data changes. Safe to apply online.
-- ═══════════════════════════════════════════════════════════════════════════

-- Loans: active/global, branch-scoped, and member-scoped lists.
CREATE INDEX "loans_status_loaned_at_idx" ON "public"."loans"("status", "loaned_at");
CREATE INDEX "loans_branch_id_status_loaned_at_idx" ON "public"."loans"("branch_id", "status", "loaned_at");
CREATE INDEX "loans_member_id_status_loaned_at_idx" ON "public"."loans"("member_id", "status", "loaned_at");

-- Reservations: newest-first hold lists per branch/member/status.
CREATE INDEX "reservations_status_reserved_at_idx" ON "public"."reservations"("status", "reserved_at");
CREATE INDEX "reservations_branch_id_status_reserved_at_idx" ON "public"."reservations"("branch_id", "status", "reserved_at");
CREATE INDEX "reservations_member_id_status_reserved_at_idx" ON "public"."reservations"("member_id", "status", "reserved_at");

-- Fines: member statements ordered by assessed_at.
CREATE INDEX "fines_member_id_status_assessed_at_idx" ON "public"."fines"("member_id", "status", "assessed_at");

-- Notifications: "all notifications, newest first" (no unread filter).
CREATE INDEX "notifications_user_id_created_at_idx" ON "public"."notifications"("user_id", "created_at");
