-- ═══════════════════════════════════════════════════════════════════════════
-- Destructive-action audit verbs (Gate: book delete, audit-log purge).
--
--   §A  AuditAction: add BOOK_DELETED and AUDIT_LOGS_DELETED
--
-- HAND-WRITTEN, not Prisma-generated. PostgreSQL forbids ALTER TYPE ... ADD
-- VALUE inside a transaction block, so this file contains ONLY those two
-- statements and is applied outside a transaction (`prisma migrate deploy`
-- executes standalone ALTER TYPE statements, and the live-DB helper script
-- applies each line with autocommit).
--
-- The AUDIT_LOGS_DELETED size will never grow a row through the trigger path:
-- the prune function inserts it itself, under a temporary trigger disable, so
-- a deletion event can survive the deletion of the rows that would otherwise
-- log it.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BOOK_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUDIT_LOGS_DELETED';