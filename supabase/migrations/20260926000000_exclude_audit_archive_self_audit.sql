-- =============================================================
-- Audit logs: stop self-auditing archive/restore of audit records
--
-- Problem:
--   trg_audit_audit_log_changes (AFTER UPDATE OR DELETE ON
--   public.audit_logs) fires public.log_audit_log_changes(), which wrote a NEW
--   audit_logs row (AUDIT_LOG_ARCHIVE / AUDIT_LOG_UPDATE) whenever a
--   super-admin archived or restored existing audit records. Those self-audit
--   rows appeared inside the very Audit Logs list being administered
--   ("Audit log entry archived"), so archiving 5 logs created 5 unwanted rows.
--
-- Fix (narrow, at the database layer so it cannot be bypassed):
--   Updates of existing audit records (the `archived` toggle) become a no-op
--   for this trigger; only the DELETE self-audit (AUDIT_LOG_DELETE) remains,
--   exactly as before. The trigger itself is kept and narrowed to fire only
--   when `archived` actually changes.
--
-- Explicitly NOT changed:
--   * public.write_audit_log() — SECURITY DEFINER, search_path = '', actor
--     enforcement, and grants are untouched.
--   * Every per-entity audit trigger (projects, timeline, profile roles,
--     clients, documents, events, invoices, project_requests) — untouched;
--     normal application actions keep auditing as before.
--   * audit_logs RLS (SELECT/DELETE super admin, UPDATE super admin,
--     INSERT self-only) — untouched; ordinary users still cannot modify
--     audit logs.
--   * No audit data is deleted, modified, or recreated.
-- =============================================================

create or replace function public.log_audit_log_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- UPDATEs of existing audit records are the super-admin archive/restore
  -- toggles of `archived`. Self-auditing that would inject a new "archived"
  -- row into the list being administered, so it is intentionally a no-op.
  -- This is the ONLY self-audit exception.
  if tg_op = 'UPDATE' then
    return null;
  end if;

  -- DELETEs keep the pre-existing self-audit entry (unchanged behavior).
  perform public.write_audit_log(
    'AUDIT_LOG_DELETE',
    'Audit log entry deleted',
    jsonb_build_object('audit_log_id', old.id, 'action_type', old.action_type),
    null,
    'audit_log', old.id, null, null, null
  );
  return null;
end;
$$;

-- Re-assert the trigger idempotently. Fires only on UPDATE OF archived
-- (archive/restore) or DELETE; the function ignores the UPDATE case anyway,
-- and this avoids firing on unrelated audit_logs updates.
drop trigger if exists trg_audit_audit_log_changes on public.audit_logs;
create trigger trg_audit_audit_log_changes
  after update of archived or delete on public.audit_logs
  for each row execute function public.log_audit_log_changes();

notify pgrst, 'reload schema';