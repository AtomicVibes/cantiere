-- Notifications archive + delete with Documents-equivalent authorization.
--
-- The Notifications tab reuses the Documents archive/restore/delete pattern
-- (super-admin archive via an Active/Archived view, AlertDialog-confirmed
-- permanent deletion). Notifications currently lacks the infrastructure
-- Documents has:
--   * no `archived` boolean column  -> nothing drives the Active/Archived views.
--   * no UPDATE policy letting an elevated role archive rows the owner would
--     normally only mutate via mark-as-read (existing policies are owner-only).
--   * no DELETE policy at all       -> RLS denies every notification delete.
--
-- This migration only mirrors the Documents contract
-- (20260917000003_create_documents_metadata.sql for the archived column,
-- 20260918000001/.../0003 for the authorization): the archived column plus
-- UPDATE/DELETE policies that widen the same surface Documents widened.
-- SELECT/INSERT policies, the canonical audit functions/triggers, the
-- audit_logs schema and RLS on every other table are untouched.

alter table public.notifications
  add column if not exists archived boolean not null default false;

create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists notifications_created_at_idx on public.notifications (created_at desc);

-- Elevated roles may archive/restore any notification, exactly as Documents
-- allows for documents (owner OR super_admin/admin/manager).
drop policy if exists "Elevated roles can update notifications" on public.notifications;
create policy "Elevated roles can update notifications"
  on public.notifications for update to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles profile
      join public.roles role on role.id = profile.role_id
      where profile.id = auth.uid()
        and role.name in ('super_admin', 'admin', 'manager')
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles profile
      join public.roles role on role.id = profile.role_id
      where profile.id = auth.uid()
        and role.name in ('super_admin', 'admin', 'manager')
    )
  );

-- Deletion mirrors the final Documents delete policy
-- (20260918000003_documents_delete_authorization.sql): owner OR super_admin.
drop policy if exists "Owners and super admins can delete notifications" on public.notifications;
create policy "Owners and super admins can delete notifications"
  on public.notifications for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_super_admin()
  );

-- The policy above calls this helper; make sure authenticated users may evaluate it.
grant execute on function public.is_super_admin() to authenticated;

notify pgrst, 'reload schema';