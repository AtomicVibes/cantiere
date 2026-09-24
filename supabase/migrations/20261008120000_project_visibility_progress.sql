-- =============================================================
-- Projects enhancement: visibility, priority, progress automation
--
-- 1) New projects columns (all additive, preserving existing rows):
--      priority        text default 'medium'  (low/medium/high/critical)
--      visibility      text not null default 'private' (private/public/selected)
--      progress_mode   text not null default 'auto' (auto/manual)
--      manual_progress integer null (0-100, super-admin override)
--      start_date / end_date / location / type (previously edited in the
--        UI but never persisted - now stored).
--    progress itself stays the served value: a trigger maintains it from
--    the timeline count while progress_mode = 'auto'.
-- 2) project_audience table (selected-visibility members), mirroring the
--    document_audience/event_audience model + RLS.
-- 3) Projects SELECT extended (existing admin/assigned policies kept):
--      public   -> all authenticated users,
--      selected -> audience members (+ admins/assigned via old policies).
-- 4) Auto-progress trigger on project_timeline insert/delete:
--      auto mode   -> progress = least(100, count * 5),
--      manual mode -> progress untouched.
--    Defensive: wrapped so timeline writes can never fail because of it.
-- 5) project_timeline.submitted_by (nullable author reference).
--
-- Explicitly NOT changed:
--   * Existing admin/assigned SELECT policies and all INSERT/UPDATE/
--     DELETE policies on projects - untouched (no weakening).
--   * Timeline INSERT/DELETE RLS - untouched.
--   * 20261001120000_event_reminders_sms.sql - untouched.
--   * No rows deleted, no history rewritten, no resets.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------
alter table public.projects
  add column if not exists priority text default 'medium',
  add column if not exists visibility text default 'private',
  add column if not exists progress_mode text default 'auto',
  add column if not exists manual_progress integer,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists location text,
  add column if not exists type text default 'construction';

update public.projects set priority = 'medium' where priority is null;
update public.projects set visibility = 'private' where visibility is null or btrim(visibility) = '';
update public.projects set progress_mode = 'auto' where progress_mode is null or btrim(progress_mode) = '';
update public.projects set manual_progress = null where manual_progress is not null and (manual_progress < 0 or manual_progress > 100);

alter table public.projects alter column visibility set default 'private';
alter table public.projects alter column visibility set not null;
alter table public.projects alter column progress_mode set default 'auto';
alter table public.projects alter column progress_mode set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_priority_check') then
    alter table public.projects
      add constraint projects_priority_check check (priority in ('low','medium','high','critical'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_visibility_check') then
    alter table public.projects
      add constraint projects_visibility_check check (visibility in ('private','public','selected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_progress_mode_check') then
    alter table public.projects
      add constraint projects_progress_mode_check check (progress_mode in ('auto','manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_manual_progress_check') then
    alter table public.projects
      add constraint projects_manual_progress_check
      check (manual_progress is null or (manual_progress >= 0 and manual_progress <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_progress_range_check') then
    alter table public.projects
      add constraint projects_progress_range_check
      check (progress is null or (progress >= 0 and progress <= 100));
  end if;
end $$;

comment on column public.projects.progress_mode is
  'auto: progress maintained from timeline count (5% each, max 100). manual: progress frozen, super-admin sets manual_progress.';
comment on column public.projects.manual_progress is
  'Super-admin manual progress override (0-100). Used when progress_mode = manual.';

-- ---------------------------------------------------------------
-- 2. Selected-audience table (+ RLS mirroring the audience model)
-- ---------------------------------------------------------------
create table if not exists public.project_audience (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint project_audience_pkey primary key (id),
  constraint project_audience_unique unique (project_id, user_id)
);

create index if not exists project_audience_project_id_idx on public.project_audience(project_id);
create index if not exists project_audience_user_id_idx on public.project_audience(user_id);

alter table public.project_audience enable row level security;

drop policy if exists "Users can read own project audience rows" on public.project_audience;
create policy "Users can read own project audience rows"
  on public.project_audience for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can manage project audience" on public.project_audience;
create policy "Admins can manage project audience"
  on public.project_audience for all
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.project_audience from anon;

-- ---------------------------------------------------------------
-- 3. Projects SELECT visibility (existing policies preserved)
-- ---------------------------------------------------------------
drop policy if exists "Users can read public projects" on public.projects;
create policy "Users can read public projects"
  on public.projects for select
  to authenticated
  using (visibility = 'public');

drop policy if exists "Users can read selected-audience projects" on public.projects;
create policy "Users can read selected-audience projects"
  on public.projects for select
  to authenticated
  using (
    visibility = 'selected'
    and exists (
      select 1 from public.project_audience pa
      where pa.project_id = projects.id
        and pa.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- 4. Auto-progress maintenance (auto mode only, defensive)
-- ---------------------------------------------------------------
create or replace function public.refresh_project_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_mode  text;
  v_pid   uuid;
begin
  begin
    v_pid := coalesce(new.project_id, old.project_id);
    if v_pid is null then
      return coalesce(new, old);
    end if;
    select progress_mode into v_mode from public.projects where id = v_pid;
    if v_mode is null or v_mode <> 'auto' then
      return coalesce(new, old);
    end if;
    select count(*) into v_count from public.project_timeline where project_id = v_pid;
    update public.projects
       set progress = least(100, v_count * 5)
     where id = v_pid;
  exception when others then
    raise log 'refresh_project_progress failed for project %: %', v_pid, sqlerrm;
  end;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refresh_project_progress on public.project_timeline;
create trigger trg_refresh_project_progress
  after insert or delete on public.project_timeline
  for each row execute function public.refresh_project_progress();

-- Backfill current auto-mode progress once (manual rows untouched).
update public.projects p
   set progress = least(100, coalesce(t.cnt, 0) * 5)
  from (select project_id, count(*) as cnt from public.project_timeline group by project_id) t
 where t.project_id = p.id
   and coalesce(p.progress_mode, 'auto') = 'auto';

-- ---------------------------------------------------------------
-- 5. Timeline author reference
-- ---------------------------------------------------------------
alter table public.project_timeline
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null;

comment on column public.project_timeline.submitted_by is
  'Profile that submitted the timeline entry (nullable for legacy rows).';

revoke execute on function public.refresh_project_progress() from public, anon, authenticated;

notify pgrst, 'reload schema';
