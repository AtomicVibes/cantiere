-- =============================================================
-- Agent activity dashboard visibility for leads.
--
-- The base tables (20261013120000) let every user manage ONLY their own
-- rows. The standalone Agent Activity screen must be readable by
-- admin/manager roles so leads can monitor their teams.
--
-- Strictly ADDITIVE: two SELECT-only policies; all existing policies
-- (owner manage, service_role read) are untouched. Mutations remain
-- owner-scoped: nobody gains INSERT/UPDATE/DELETE on others' rows.
-- =============================================================

drop policy if exists "Leads can read agent sessions" on public.agent_sessions;
create policy "Leads can read agent sessions"
  on public.agent_sessions for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = auth.uid() and r.name = 'manager'
    )
  );

drop policy if exists "Leads can read agent action logs" on public.agent_action_logs;
create policy "Leads can read agent action logs"
  on public.agent_action_logs for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = auth.uid() and r.name = 'manager'
    )
  );

notify pgrst, 'reload schema';
