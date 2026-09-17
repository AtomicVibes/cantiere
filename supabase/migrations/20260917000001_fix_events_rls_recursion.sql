-- Prevent events and event_audience RLS policies from querying each other recursively.

create or replace function public.is_event_owner(
  p_event_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events
    where id = p_event_id
      and user_id = p_user_id
  );
$$;

revoke all on function public.is_event_owner(uuid, uuid) from public;
grant execute on function public.is_event_owner(uuid, uuid) to authenticated;

drop policy if exists "Users can read authorized event audience" on public.event_audience;
drop policy if exists "Users can read event audience for authorized events" on public.event_audience;
create policy "Users can read authorized event audience"
  on public.event_audience for select
  using (
    user_id = auth.uid()
    or public.is_event_owner(event_id, auth.uid())
  );

drop policy if exists "Owners can manage event audience" on public.event_audience;
create policy "Owners can manage event audience"
  on public.event_audience for all
  using (public.is_event_owner(event_id, auth.uid()))
  with check (public.is_event_owner(event_id, auth.uid()));
