-- Repair document RLS without recursive policy evaluation.

create or replace function public.document_is_owner(
  p_document_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.documents document
    where document.id = p_document_id
      and document.user_id = p_user_id
  );
$$;

create or replace function public.document_is_authorized(
  p_document_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.documents document
    where document.id = p_document_id
      and (
        document.user_id = p_user_id
        or document.visibility = 'public'
        or (
          document.visibility = 'selected'
          and exists (
            select 1
            from public.document_audience audience
            where audience.document_id = document.id
              and audience.user_id = p_user_id
          )
        )
        or exists (
          select 1
          from public.profiles profile
          join public.roles role on role.id = profile.role_id
          where profile.id = p_user_id
            and role.name in ('super_admin', 'admin', 'manager')
        )
      )
  );
$$;

revoke all on function public.document_is_owner(uuid, uuid) from public;
revoke all on function public.document_is_authorized(uuid, uuid) from public;
grant execute on function public.document_is_owner(uuid, uuid) to authenticated;
grant execute on function public.document_is_authorized(uuid, uuid) to authenticated;

-- These are the document policies created by the project migrations. Replace only
-- the document access policies; insert/update/delete ownership remains restricted.
drop policy if exists "Users can view their own documents" on public.documents;
drop policy if exists "Users can view authorized documents" on public.documents;
drop policy if exists "Users can insert their own documents" on public.documents;
drop policy if exists "Owners can update documents" on public.documents;
drop policy if exists "Users can update their own documents" on public.documents;
drop policy if exists "Owners can delete documents" on public.documents;
drop policy if exists "Users can delete their own documents" on public.documents;

create policy "Users can view authorized documents"
  on public.documents for select to authenticated
  using (public.document_is_authorized(id, auth.uid()));

create policy "Users can insert their own documents"
  on public.documents for insert to authenticated
  with check (user_id = auth.uid());

create policy "Owners can update documents"
  on public.documents for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Owners can delete documents"
  on public.documents for delete to authenticated
  using (user_id = auth.uid());

-- Audience policies use the owner helper and therefore do not recurse through
-- the documents SELECT policy.
drop policy if exists "Users can read authorized document audience" on public.document_audience;
drop policy if exists "Document owners can manage audience" on public.document_audience;
drop policy if exists "Users can read event audience for authorized events" on public.document_audience;

create policy "Users can read authorized document audience"
  on public.document_audience for select to authenticated
  using (
    user_id = auth.uid()
    or public.document_is_owner(document_id, auth.uid())
  );

create policy "Document owners can manage audience"
  on public.document_audience for all to authenticated
  using (public.document_is_owner(document_id, auth.uid()))
  with check (public.document_is_owner(document_id, auth.uid()));

create or replace function public.create_document_with_audience(
  p_audience_user_ids uuid[],
  p_file_name text,
  p_file_size bigint,
  p_mime_type text,
  p_notes text,
  p_project_id uuid,
  p_storage_path text,
  p_type text,
  p_visibility text
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  created_document public.documents;
  audience_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_visibility is null or p_visibility not in ('private', 'public', 'selected') then
    raise exception 'Invalid document visibility';
  end if;
  if p_visibility = 'selected' and coalesce(array_length(p_audience_user_ids, 1), 0) = 0 then
    raise exception 'Selected visibility requires at least one audience user';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  if p_visibility = 'selected' then
    foreach audience_user_id in array p_audience_user_ids loop
      if not exists (select 1 from auth.users where id = audience_user_id) then
        raise exception 'Invalid audience user';
      end if;
    end loop;
  end if;

  insert into public.documents (user_id, file_name, storage_path, mime_type, file_size, type, notes, project_id, visibility)
  values (auth.uid(), p_file_name, p_storage_path, p_mime_type, coalesce(p_file_size, 0), coalesce(p_type, 'other'), p_notes, p_project_id, p_visibility)
  returning * into created_document;

  if p_visibility = 'selected' then
    foreach audience_user_id in array p_audience_user_ids loop
      insert into public.document_audience (document_id, user_id)
      values (created_document.id, audience_user_id)
      on conflict (document_id, user_id) do nothing;
    end loop;
  end if;

  return created_document;
end;
$$;

revoke all on function public.create_document_with_audience(uuid[], text, bigint, text, text, uuid, text, text, text) from public;
grant execute on function public.create_document_with_audience(uuid[], text, bigint, text, text, uuid, text, text, text) to authenticated;

create or replace function public.update_document_access(
  p_document_id uuid,
  p_visibility text,
  p_audience_user_ids uuid[]
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_document public.documents;
  audience_user_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_visibility is null or p_visibility not in ('private', 'public', 'selected') then raise exception 'Invalid document visibility'; end if;
  if p_visibility = 'selected' and coalesce(array_length(p_audience_user_ids, 1), 0) = 0 then raise exception 'Selected visibility requires at least one audience user'; end if;
  if not public.document_is_owner(p_document_id, auth.uid()) then raise exception 'Not authorized to update this document'; end if;

  if p_visibility = 'selected' then
    foreach audience_user_id in array p_audience_user_ids loop
      if not exists (select 1 from auth.users where id = audience_user_id) then
        raise exception 'Invalid audience user';
      end if;
    end loop;
  end if;

  delete from public.document_audience where document_id = p_document_id;
  if p_visibility = 'selected' then
    foreach audience_user_id in array p_audience_user_ids loop
      insert into public.document_audience (document_id, user_id)
      values (p_document_id, audience_user_id)
      on conflict (document_id, user_id) do nothing;
    end loop;
  end if;

  update public.documents
  set visibility = p_visibility, updated_at = now()
  where id = p_document_id and user_id = auth.uid()
  returning * into updated_document;

  if updated_document.id is null then raise exception 'Document not found'; end if;
  return updated_document;
end;
$$;

revoke all on function public.update_document_access(uuid, text, uuid[]) from public;
grant execute on function public.update_document_access(uuid, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
