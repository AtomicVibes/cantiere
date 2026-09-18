-- Atomically update document visibility and its selected audience.

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
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_visibility is null or p_visibility not in ('private', 'public', 'selected') then
    raise exception 'Invalid document visibility';
  end if;

  if p_visibility = 'selected'
    and coalesce(array_length(p_audience_user_ids, 1), 0) = 0 then
    raise exception 'Selected visibility requires at least one audience user';
  end if;

  if not exists (
    select 1
    from public.documents document
    where document.id = p_document_id
      and document.user_id = auth.uid()
  ) then
    raise exception 'Not authorized to update this document';
  end if;

  delete from public.document_audience
  where document_id = p_document_id;

  if p_visibility = 'selected' then
    foreach audience_user_id in array p_audience_user_ids loop
      insert into public.document_audience (document_id, user_id)
      values (p_document_id, audience_user_id)
      on conflict (document_id, user_id) do nothing;
    end loop;
  end if;

  update public.documents
  set visibility = p_visibility,
      updated_at = now()
  where id = p_document_id
    and user_id = auth.uid()
  returning * into updated_document;

  if updated_document.id is null then
    raise exception 'Document not found';
  end if;

  return updated_document;
end;
$$;

revoke all on function public.update_document_access(uuid, text, uuid[]) from public;
grant execute on function public.update_document_access(uuid, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
