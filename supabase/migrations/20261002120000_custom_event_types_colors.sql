-- ============================================================================
-- feat(events): custom event types and colors  (additive migration)
-- ----------------------------------------------------------------------------
-- SAFETY (spec #5/#19/#27):
--   * Additive + idempotent. No DROP, no DELETE, no TRUNCATE, no db reset.
--   * Does NOT modify 20261001120000_event_reminders_sms.sql (canonical fff8757).
--   * Existing events.events.type string is PRESERVED for backward-compat;
--     the new events.event_type_id is a safe, nullable additive reference.
--   * New event_types rows are backfilled from existing events.type VALUES
--     (no data loss, no forced recolor).
--   * RLS mirrors the existing events authorization model (owner manage,
--     authenticated team/owner select). No new auth framework.
--   * Audit: event type changes are recorded through the canonical audit
--     writer used by events (create/update/archive in step functions + the
--     existing write_audit_log RPC). No second audit system.
--   * Color priority resolved in the app via resolver:
--         event_color → event_type color → application accent
--     event_type.color may be NULL => fall back to app accent at render time.
-- ============================================================================

-- ---------------------------------------------------------------
-- 1. event_types table (custom types + optional default color)
-- ---------------------------------------------------------------
create table if not exists public.event_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text,                       -- nullable: NULL => use app accent
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived    boolean not null default false
);

comment on table public.event_types is
  'User-customizable event types with optional default colors.';

-- human-readable name must be non-empty / trimmed-capable and unique per user
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conname = 'event_types_name_not_blank'
      and c.conrelid = 'public.event_types'::regclass
  ) then
    alter table public.event_types
      add constraint event_types_name_not_blank check (btrim(name) <> '');
  end if;
end $$;

-- ---------------------------------------------------------------
-- 2. additive event columns (do NOT touch existing events.type)
-- ---------------------------------------------------------------
alter table public.events
  add column if not exists event_type_id uuid references public.event_types(id) on delete set null;

alter table public.events
  add column if not exists event_color text;

-- safe color format guard: #RRGGBB OR null (human names shown in UI, HEX internal)
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conname = 'events_event_color_format'
      and c.conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_event_color_format
      check (event_color is null or event_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

-- ---------------------------------------------------------------
-- 3. RLS — mirror existing events authorization (no weakening, no new system)
-- ---------------------------------------------------------------
alter table public.event_types enable row level security;

drop policy if exists "event_types_owner_manage" on public.event_types;
create policy "event_types_owner_manage" on public.event_types
  for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "event_types_owner_select" on public.event_types;
create policy "event_types_owner_select" on public.event_types
  for select to authenticated
  using (created_by = auth.uid());

drop policy if exists "event_types_team_select" on public.event_types;
create policy "event_types_team_select" on public.event_types
  for select to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.project_members pm
      join public.projects p on p.id = pm.project_id
      where p.owner_id = public.event_types.created_by
        and pm.profile_id = auth.uid()
    )
  );

revoke all on public.event_types from anon;

-- ---------------------------------------------------------------
-- 4. BACKFILL — preserve existing event types (idempotent)
--    map current events.type string values to new event_types rows;
--    existing events keep events.type AND gain event_type_id when matched.
-- ---------------------------------------------------------------
insert into public.event_types (name, created_by, created_at, updated_at, archived)
select distinct
  btrim(ev.type) as name,
  ev.user_id     as created_by,
  min(ev.created_at) as created_at,
  min(ev.created_at) as updated_at,
  false          as archived
from public.events ev
where ev.type is not null and btrim(ev.type) <> ''
group by btrim(ev.type), ev.user_id
on conflict do nothing;

do $$
begin
  update public.events ev
  set event_type_id = et.id
  from public.event_types et
  where et.name = btrim(ev.type)
    and et.created_by = ev.user_id
    and ev.event_type_id is null;
end $$;

-- ---------------------------------------------------------------
-- 5. indexes
-- ---------------------------------------------------------------
create index if not exists events_event_type_id_idx on public.events(event_type_id);
create index if not exists event_types_created_by_idx on public.event_types(created_by);
