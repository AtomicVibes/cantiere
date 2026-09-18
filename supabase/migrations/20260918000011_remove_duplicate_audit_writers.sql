-- =============================================================
-- Migration: Remove duplicate audit writers and close anon EXECUTE
--
-- Live verification of 20260918000010 revealed:
--   1. Pre-existing legacy audit triggers still fired alongside the
--      canonical trg_audit_* triggers, so every mutation produced
--      2-3 audit rows (e.g. projects: PROJECT_CREATE x2 + a generic
--      universal "INSERT" row).
--   2. public.write_audit_log() was still executable by the `anon`
--      role because Supabase default privileges grant EXECUTE to anon
--      at creation time, and the canonical migration only revoked
--      FROM public. Anonymous callers could therefore insert
--      NULL-actor audit rows.
--
-- This migration is additive/idempotent and does NOT rewrite history.
-- Canonical audit behavior (action names, actor resolution, RLS) is
-- unchanged.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Close anonymous EXECUTE on the canonical writer
-- -------------------------------------------------------------
revoke execute on function public.write_audit_log(text, text, jsonb, text, text, uuid, uuid, jsonb, jsonb, text, text, uuid) from anon;
revoke all on function public.write_audit_log(text, text, jsonb, text, text, uuid, uuid, jsonb, jsonb, text, text, uuid) from public;
grant execute on function public.write_audit_log(text, text, jsonb, text, text, uuid, uuid, jsonb, jsonb, text, text, uuid) to authenticated;
grant execute on function public.write_audit_log(text, text, jsonb, text, text, uuid, uuid, jsonb, jsonb, text, text, uuid) to service_role;

-- -------------------------------------------------------------
-- 2. Drop redundant legacy audit triggers
--
-- The canonical triggers (trg_audit_projects, trg_audit_invoices,
-- trg_audit_project_requests, trg_audit_clients) call the canonical
-- per-table functions and fully cover these events.
-- -------------------------------------------------------------

-- clients: trg_audit_clients already handles INSERT / DELETE / UPDATE OF is_blocked
drop trigger if exists trg_log_client_deletion on public.clients;

-- projects: trg_audit_projects already calls log_project_changes()
drop trigger if exists audit_project_trigger on public.projects;
-- projects: generic universal writer (action_type = INSERT/UPDATE/DELETE, entity_id NULL)
drop trigger if exists audit_projects_trigger on public.projects;

-- invoices: trg_audit_invoices already calls log_invoice_changes()
drop trigger if exists audit_invoices_trigger on public.invoices;

-- project_requests: trg_audit_project_requests already calls log_project_request_changes()
drop trigger if exists audit_requests_trigger on public.project_requests;

-- NOTE: audit_team_members_trigger (process_universal_audit_log) is intentionally
-- KEPT because team_members has no canonical trg_audit_team_members counterpart.

-- -------------------------------------------------------------
-- 3. Stop log_role_change() from writing a duplicate ROLE_UPDATE
--
-- The canonical trg_audit_profile_role -> log_profile_role_changes()
-- already writes ROLE_UPDATE on role_id changes. The legacy function
-- fired on ANY profile update and inserted a second, differently
-- shaped ROLE_UPDATE row. Keep the in-app notification, drop the
-- duplicate audit insert.
-- -------------------------------------------------------------
create or replace function public.log_role_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.role_id is distinct from new.role_id then
    insert into public.notifications (user_id, message, type)
    values (new.id, 'Your role has been updated.', 'role_update');
  end if;
  return new;
end;
$function$;

notify pgrst, 'reload schema';
