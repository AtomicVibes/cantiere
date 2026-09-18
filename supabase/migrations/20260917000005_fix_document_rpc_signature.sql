-- Create the document RPC with the exact interface used by the frontend.
-- The file must already exist in the private `documents` Storage bucket.

drop function if exists public.create_document_with_audience(text, text, text, bigint, text, uuid, text, text, uuid[]);

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
    raise exception 'Not authenticated';
  end if;

  if p_visibility not in ('private', 'public', 'selected') then
    raise exception 'Invalid document visibility';
  end if;

  if p_visibility = 'selected'
    and coalesce(array_length(p_audience_user_ids, 1), 0) = 0 then
    raise exception 'Selected documents require an audience';
  end if;

  if p_project_id is not null
    and not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  insert into public.documents (
    user_id,
    file_name,
    file_size,
    mime_type,
    storage_path,
    type,
    notes,
    project_id,
    visibility
  )
  values (
    auth.uid(),
    p_file_name,
    p_file_size,
    p_mime_type,
    p_storage_path,
    coalesce(p_type, 'other'),
    p_notes,
    p_project_id,
    p_visibility
  )
  returning * into created_document;

  if p_visibility = 'selected' then
    foreach audience_user_id in array p_audience_user_ids loop
      insert into public.document_audience (document_id, user_id)
      values (created_document.id, audience_user_id)
      on conflict (document_id, user_id) do nothing;
    end loop;
  end if;

  if p_project_id is not null and p_mime_type like 'image/%' then
    insert into public.project_timeline (
      project_id,
      document_id,
      title,
      description,
      status,
      date
    )
    values (
      p_project_id,
      created_document.id,
      created_document.file_name,
      created_document.notes,
      'completed',
      current_date
    )
    on conflict (document_id) do update
      set title = excluded.title,
          description = excluded.description,
          status = excluded.status,
          date = excluded.date;
  end if;

  return created_document;
end;
$$;

revoke all on function public.create_document_with_audience(
  uuid[], text, bigint, text, text, uuid, text, text, text
) from public;

grant execute on function public.create_document_with_audience(
  uuid[], text, bigint, text, text, uuid, text, text, text
) to authenticated;
