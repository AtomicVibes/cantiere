-- Document visibility, audiences, and deterministic project timeline links.

alter table public.documents
  add column if not exists visibility text not null default 'private',
  add constraint documents_visibility_check
    check (visibility in ('private', 'public', 'selected'));

create table if not exists public.document_audience (
  id uuid not null default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint document_audience_pkey primary key (id),
  constraint document_audience_unique unique (document_id, user_id)
);

alter table public.project_timeline
  add column if not exists document_id uuid null references public.documents(id) on delete cascade;

create unique index if not exists project_timeline_document_id_unique
  on public.project_timeline(document_id)
  where document_id is not null;
create index if not exists document_audience_document_id_idx on public.document_audience(document_id);
create index if not exists document_audience_user_id_idx on public.document_audience(user_id);

alter table public.document_audience enable row level security;

create or replace function public.can_read_document(p_document_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents document
    where document.id = p_document_id
      and (
        document.user_id = p_user_id
        or document.visibility = 'public'
        or (document.visibility = 'selected' and exists (
          select 1 from public.document_audience audience
          where audience.document_id = document.id and audience.user_id = p_user_id
        ))
      )
  );
$$;

revoke all on function public.can_read_document(uuid, uuid) from public;
grant execute on function public.can_read_document(uuid, uuid) to authenticated;

create or replace function public.is_document_owner(p_document_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.documents document where document.id = p_document_id and document.user_id = p_user_id);
$$;

revoke all on function public.is_document_owner(uuid, uuid) from public;
grant execute on function public.is_document_owner(uuid, uuid) to authenticated;

-- Replace the earlier document policies with the same visibility semantics as events.
drop policy if exists "Users can view their own documents" on public.documents;
create policy "Users can view authorized documents"
  on public.documents for select to authenticated
  using (
    public.can_read_document(id, auth.uid())
  );

drop policy if exists "Users can update their own documents" on public.documents;
create policy "Owners can update documents"
  on public.documents for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their own documents" on public.documents;
create policy "Owners can delete documents"
  on public.documents for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can read event audience for authorized events" on public.document_audience;
create policy "Users can read authorized document audience"
  on public.document_audience for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_document_owner(document_id, auth.uid())
  );

drop policy if exists "Document owners can manage audience" on public.document_audience;
create policy "Document owners can manage audience"
  on public.document_audience for all to authenticated
  using (public.is_document_owner(document_id, auth.uid()))
  with check (public.is_document_owner(document_id, auth.uid()));

-- Storage access is still private; authorization is checked through the metadata row.
drop policy if exists "Document owners and admins can read documents" on storage.objects;
create policy "Users can read authorized document objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (select 1 from public.documents document where document.storage_path = name and public.can_read_document(document.id, auth.uid()))
  );

drop function if exists public.create_document_with_audience(text, text, text, bigint, text, uuid, text, text, uuid[]);
create or replace function public.create_document_with_audience(
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_file_size bigint,
  p_type text default 'other',
  p_project_id uuid default null,
  p_notes text default null,
  p_visibility text default 'private',
  p_audience_user_ids uuid[] default '{}'
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  created_document public.documents;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_visibility not in ('private', 'public', 'selected') then raise exception 'Invalid document visibility'; end if;
  if p_visibility = 'selected' and coalesce(array_length(p_audience_user_ids, 1), 0) = 0 then raise exception 'Selected documents require an audience'; end if;

  insert into public.documents (user_id, file_name, storage_path, mime_type, file_size, type, notes, project_id, visibility)
  values (auth.uid(), p_file_name, p_storage_path, p_mime_type, p_file_size, coalesce(p_type, 'other'), p_notes, p_project_id, p_visibility)
  returning * into created_document;

  if p_visibility = 'selected' then
    insert into public.document_audience (document_id, user_id)
    select created_document.id, audience_user_id from unnest(p_audience_user_ids) audience_user_id;
  end if;

  if p_project_id is not null and p_mime_type like 'image/%' then
    insert into public.project_timeline (project_id, document_id, title, description, status, date)
    values (p_project_id, created_document.id, created_document.file_name, created_document.notes, 'completed', current_date)
    on conflict (document_id) do update set title = excluded.title, description = excluded.description;
  end if;

  return created_document;
end;
$$;

revoke all on function public.create_document_with_audience(text, text, text, bigint, text, uuid, text, text, uuid[]) from public;
grant execute on function public.create_document_with_audience(text, text, text, bigint, text, uuid, text, text, uuid[]) to authenticated;

create or replace function public.remove_document_project(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_document_owner(p_document_id, auth.uid()) then
    raise exception 'Not authorized';
  end if;
  delete from public.project_timeline where document_id = p_document_id;
  update public.documents set project_id = null, updated_at = now() where id = p_document_id;
end;
$$;

revoke all on function public.remove_document_project(uuid) from public;
grant execute on function public.remove_document_project(uuid) to authenticated;

-- Only authorized users should see document-backed timeline entries.
drop policy if exists "Admins can read all timeline entries" on public.project_timeline;
drop policy if exists "Clients can read timeline for own projects" on public.project_timeline;
drop policy if exists "Project members can read timeline entries" on public.project_timeline;
create policy "Users can read authorized project timeline"
  on public.project_timeline for select
  using (
    (document_id is null and (
      public.is_admin()
      or exists (select 1 from public.project_members pm where pm.project_id = project_timeline.project_id and pm.profile_id = auth.uid())
      or project_id in (select pr.project_id from public.project_requests pr join public.clients c on c.id = pr.client_id where c.profile_id = auth.uid())
    ))
    or (document_id is not null and exists (
      select 1 from public.documents document
      where document.id = project_timeline.document_id
        and public.can_read_document(document.id, auth.uid())
    ))
  );
