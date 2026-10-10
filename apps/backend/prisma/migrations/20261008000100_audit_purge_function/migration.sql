-- ═══════════════════════════════════════════════════════════════════════════
-- Audit-log purge (Gate: settings-gated, password-confirmed destruction).
--
--   §B  prunes_audit_logs() — SECURITY DEFINER purge that survives the
--       immutability trigger, records its own marker row, and returns the
--       number of rows deleted.
--
-- The audit log is append-only by design:
--   • trigger `audit_logs_no_update_delete` vetoes UPDATE/DELETE for every
--     role, including the table owner (privilege, not ownership)
--   • `REVOKE UPDATE, DELETE ON "audit_logs" FROM lms_app` plus the same
--     revoke on the status-history tables (§E of the invariants migration)
-- Allowing an administrator to delete rows therefore requires a deliberate,
-- narrow, auditable mechanism — this function — rather than a grant that
-- leaks the immutability guarantee onto the app role.
--
-- Design decisions:
--   • SECURITY DEFINER, owned by the migration user (postgres): the DELETE and
--     the ALTER TABLE run with owner privilege, never the caller's. The app
--     role keeps its REVOKE, so Prisma can still not delete a row directly.
--   • The marker row is inserted FIRST, through the ordinary INSERT path (the
--     trigger only fires on UPDATE/DELETE), recording action
--     AUDIT_LOGS_DELETED courtesy of the new enum value — so after a purge the
--     log always holds at least the row that says the log was purged.
--   • The immutability trigger is disabled only for the lifetime of the
--     DELETE, inside the same transaction, and re-enabled in every exit path
--     including error. PostgreSQL rolls the disable back if the outer
--     transaction aborts, so a failed purge cannot leave the log writable.
--   • Filters are passed as the two optional text predicates so the endpoint
--     can purge "everything" or a narrow slice; `where` below stays over
--     immutable columns.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prunes_audit_logs(
  p_actor_id uuid,
  p_actor_email varchar,
  p_actor_role varchar,
  p_ip varchar,
  p_user_agent text,
  p_request_id varchar,
  p_older_than timestamptz
) RETURNS TABLE (deleted bigint, marker_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_marker_id bigint;
  v_deleted bigint;
BEGIN
  INSERT INTO public.audit_logs
    (actor_id, actor_email, actor_role, action, entity_type, entity_id,
     description, ip, user_agent, request_id, created_at)
  VALUES
    (p_actor_id, p_actor_email, p_actor_role, 'AUDIT_LOGS_DELETED', 'audit-log',
     NULL, 'Administrative purge of audit log entries',
     p_ip, p_user_agent, p_request_id, now())
  RETURNING id INTO v_marker_id;

  ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_no_update_delete;
  BEGIN
    DELETE FROM public.audit_logs
     WHERE id <> v_marker_id
       AND (p_older_than IS NULL OR created_at <= p_older_than);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  EXCEPTION WHEN others THEN
    ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_no_update_delete;
    RAISE;
  END;
  ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_no_update_delete;

  RETURN QUERY SELECT v_deleted, v_marker_id;
END;
$$;

-- Grant ONLY when the provisioning role exists, mirroring §E of the invariants
-- migration: local development / CI connect as superuser and have no lms_app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.prunes_audit_logs(
      uuid, varchar, varchar, varchar, text, varchar, timestamptz
    ) TO lms_app';
  END IF;
END
$$;