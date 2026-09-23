-- =============================================================
-- Migration: Super-admin project deletion
-- - Adds delete_project() SECURITY DEFINER RPC usable only by super_admin
-- - Restricts direct DELETE on projects to super_admin only
--
-- Related-data semantics on project deletion:
--   events           -> deleted explicitly (events.project_id FK action is not
--                        declared in migrations, so child rows are removed first)
--   event_audience   -> cascades with events
--   project_timeline -> ON DELETE CASCADE from projects
--   project_members  -> ON DELETE CASCADE from projects
--   documents        -> ON DELETE SET NULL (kept, project_id unlinked)
--   invoices         -> ON DELETE SET NULL (kept, project_id unlinked)
--   audit_logs       -> no FK; preserved. trg_audit_projects writes a
--                       PROJECT_DELETE audit entry automatically (see
--                       log_project_changes in the centralised audit migration).
-- =============================================================

-- 1. Tighten direct DELETE access on projects to super_admin only.
drop policy if exists "Admins can delete projects" on public.projects;

create policy "Super admins can delete projects"
  on public.projects for delete
  using (public.is_super_admin());

-- 2. Secure delete_project RPC.
create or replace function public.delete_project(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_name text;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  -- Explicit role gate: only super_admin may delete projects.
  if not public.is_super_admin() then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;

  select name into v_project_name
  from public.projects
  where id = p_project_id;

  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  -- Delete project-scoped child rows first (event_audience cascades with
  -- events; project_timeline/project_members cascade with projects).
  delete from public.events where project_id = p_project_id;

  delete from public.projects where id = p_project_id;

  return v_project_name;
end;
$$;

revoke all on function public.delete_project(uuid) from public;
grant execute on function public.delete_project(uuid) to authenticated;

notify pgrst, 'reload schema';