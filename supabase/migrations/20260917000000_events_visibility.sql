-- Keep event visibility and selected-audience writes enforced by the database.

create table if not exists public.event_audience (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.events enable row level security;
alter table public.event_audience enable row level security;

drop policy if exists "Users can read authorized events" on public.events;
create policy "Users can read authorized events"
  on public.events for select
  using (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or visibility = 'public'
      or (
        visibility = 'selected'
        and exists (
          select 1
          from public.event_audience audience
          where audience.event_id = events.id
            and audience.user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "Users can create their own events" on public.events;
create policy "Users can create their own events"
  on public.events for insert
  with check (user_id = auth.uid());

drop policy if exists "Owners can update their events" on public.events;
create policy "Owners can update their events"
  on public.events for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Owners can delete their events" on public.events;
create policy "Owners can delete their events"
  on public.events for delete
  using (user_id = auth.uid());

drop policy if exists "Users can read event audience for authorized events" on public.event_audience;
create policy "Users can read event audience for authorized events"
  on public.event_audience for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.events event
      where event.id = event_audience.event_id
        and event.user_id = auth.uid()
    )
  );

drop policy if exists "Owners can manage event audience" on public.event_audience;
create policy "Owners can manage event audience"
  on public.event_audience for all
  using (exists (select 1 from public.events event where event.id = event_audience.event_id and event.user_id = auth.uid()))
  with check (exists (select 1 from public.events event where event.id = event_audience.event_id and event.user_id = auth.uid()));

create or replace function public.create_event_with_audience(
  p_title text,
  p_description text,
  p_type text,
  p_date date,
  p_time time,
  p_location text,
  p_visibility text,
  p_project_id uuid default null,
  p_audience_user_ids uuid[] default '{}'
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  created_event public.events;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_visibility not in ('private', 'public', 'selected') then
    raise exception 'Invalid event visibility';
  end if;

  if p_visibility = 'selected' and coalesce(array_length(p_audience_user_ids, 1), 0) = 0 then
    raise exception 'Selected events require at least one audience member';
  end if;

  insert into public.events (user_id, title, description, type, date, time, location, visibility, project_id)
  values (auth.uid(), p_title, p_description, p_type, p_date, p_time, p_location, p_visibility, p_project_id)
  returning * into created_event;

  if p_visibility = 'selected' then
    insert into public.event_audience (event_id, user_id)
    select created_event.id, audience_user_id
    from unnest(p_audience_user_ids) as audience_user_id;
  end if;

  return created_event;
end;
$$;

revoke all on function public.create_event_with_audience(text, text, text, date, time, text, text, uuid, uuid[]) from public;
grant execute on function public.create_event_with_audience(text, text, text, date, time, text, text, uuid, uuid[]) to authenticated;