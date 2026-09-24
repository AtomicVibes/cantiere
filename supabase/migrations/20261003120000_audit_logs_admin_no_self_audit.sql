-- =============================================================
-- Audit logs: stop self-auditing ALL audit-log administration
--
-- Problem:
--   trg_audit_audit_log_changes (AFTER UPDATE OF archived OR DELETE ON
--   public.audit_logs) fires public.log_audit_log_changes(). A previous
--   migration (20260926000000) already made the UPDATE (archive/restore)
--   case a no-op, but the DELETE case still writes a NEW audit_logs row
--   (AUDIT_LOG_DELETE) for every archived-log deletion - including single,
--   bulk, and "delete all" administration from the Audit Logs viewer.
--   Those self-audit rows are noise inside the very list being administered.
--
-- Fix (narrow, at the database layer so it cannot be bypassed):
--   The DELETE self-audit becomes a no-op too. The trigger is kept (same
--   name, same timing, same events) and the function keeps its SECURITY
--   DEFINER / search_path protections; it simply returns NULL without
--   writing a row for either UPDATE or DELETE on public.audit_logs.
--
-- Explicitly NOT changed (future behavior only, no data touched):
--   * public.write_audit_log() - untouched.
--   * Every per-entity audit trigger (projects, timeline, profile roles,
--     clients, documents, events, invoices, project_requests,
--     reminder deliveries) - untouched; normal application activity keeps
--     auditing exactly as before.
--   * audit_logs RLS (SELECT/DELETE/UPDATE super admin, INSERT self-only)
--     - untouched; authorization is unchanged.
--   * No audit rows are deleted, modified, truncated, or recreated.
--   * 20261001120000_event_reminders_sms.sql and every other existing
--     migration are untouched.
-- =============================================================

create or replace function public.log_audit_log_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Administering the audit log viewer (selecting, archiving, restoring,
  -- deleting, bulk archive, bulk delete) must not create new audit entries.
  -- Both UPDATE OF archived and DELETE are intentionally no-ops.
  return null;
end;
$$;

-- Re-assert the trigger idempotently (same definition as before).
drop trigger if exists trg_audit_audit_log_changes on public.audit_logs;
create trigger trg_audit_audit_log_changes
  after update of archived or delete on public.audit_logs
  for each row execute function public.log_audit_log_changes();

notify pgrst, 'reload schema';
