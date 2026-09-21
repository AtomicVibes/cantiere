-- Support external Google document links (Docs / Sheets / Slides) in the Documents
-- module without touching the existing upload flow or weakening RLS.
--
-- Uploaded files keep a real storage object: storage_path NOT NULL, external_url NULL,
-- external_provider NULL. Google links keep no storage object: storage_path NULL,
-- external_provider = 'google', external_url set. Row-level access is unchanged and is
-- still resolved entirely by the existing document RLS (owner, public, selected audience
-- and authorised roles); the external URL is only ever exposed to those who may already
-- read the row, and Google's own sharing settings govern the document content.

alter table public.documents alter column storage_path drop not null;

alter table public.documents add column if not exists external_url text;
alter table public.documents add column if not exists external_provider text;

-- Integrity: every document is exactly one of the two kinds, and Google providers only
-- ever reference a live docs.google.com link with no stored file.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_external_link_check'
  ) then
    alter table public.documents
      add constraint documents_external_link_check
      check (
        (
          external_provider is null
          and external_url is null
          and storage_path is not null
        )
        or (
          external_provider = 'google'
          and external_url is not null
          and storage_path is null
        )
      );
  end if;
end
$$;

-- Extend the creation RPC so linked documents can be created through the same
-- single, validated entry point. The two new arguments are defaulted so existing
-- callers keep working unchanged. The previous nine-argument signature is dropped
-- in favour of this eleven-argument one.
drop function if exists public.create_document_with_audience(uuid[], text, bigint, text, text, uuid, text, text, text);

create or replace function public.create_document_with_audience(
  p_audience_user_ids uuid[],
  p_file_name text,
  p_file_size bigint,
  p_mime_type text,
  p_notes text,
  p_project_id uuid,
  p_storage_path text,
  p_type text,
  p_visibility text,
  p_external_url text default null,
  p_external_provider text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  created_document public.documents;
  audience_user_id uuid;
  v_mime_type text := p_mime_type;
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

  if p_external_provider is not null then
    -- Google-linked document: a real link, never a fake storage path and never a
    -- storage object. The size is meaningless for a link, so it is recorded as zero.
    if p_external_provider <> 'google' then
      raise exception 'Unsupported external provider';
    end if;
    if p_external_url is null
      or p_external_url !~ '^https://docs\.google\.com/(document|spreadsheets|presentation)(/u/[0-9]+)?/d/'
    then
      raise exception 'Invalid Google document link';
    end if;
    if v_mime_type is null or v_mime_type not like 'application/vnd.google-apps.%' then
      v_mime_type := 'application/vnd.google-apps.document';
    end if;
    p_storage_path := null;
    p_file_size := 0;
  else
    -- Uploaded document: the stored file path is mandatory and there is no link.
    if p_storage_path is null then
      raise exception 'A stored file path is required for uploaded documents';
    end if;
    p_external_url := null;
    p_external_provider := null;
  end if;

  insert into public.documents (user_id, file_name, storage_path, mime_type, file_size, type, notes, project_id, visibility, external_url, external_provider)
  values (auth.uid(), p_file_name, p_storage_path, v_mime_type, coalesce(p_file_size, 0), coalesce(p_type, 'other'), p_notes, p_project_id, p_visibility, p_external_url, p_external_provider)
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

revoke all on function public.create_document_with_audience(uuid[], text, bigint, text, text, uuid, text, text, text, text, text) from public;
grant execute on function public.create_document_with_audience(uuid[], text, bigint, text, text, uuid, text, text, text, text, text) to authenticated;

-- The audit trigger stays untouched; only the log function is extended so linked
-- documents are recorded as links (never as stored uploads) and external metadata
-- changes are captured. Nothing here reads storage_path, so external rows are safe.
create or replace function public.log_document_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columns text[] := array['file_name', 'mime_type', 'file_size', 'type', 'notes', 'project_id', 'visibility', 'archived', 'external_url', 'external_provider'];
  v_action text;
  v_message text;
  v_document_name text;
  v_details jsonb;
  v_old_j jsonb;
  v_new_j jsonb;
  v_changed text[];
  v_old_values jsonb;
  v_new_values jsonb;
begin
  if tg_op = 'INSERT' then
    v_document_name := new.file_name;
    if new.external_provider = 'google' then
      v_action := 'DOCUMENT_LINK';
      v_message := 'Document linked: ' || coalesce(new.file_name, '');
      v_details := jsonb_build_object('file_name', new.file_name, 'mime_type', new.mime_type, 'type', new.type, 'visibility', new.visibility, 'project_id', new.project_id, 'external_provider', new.external_provider);
    else
      v_action := 'DOCUMENT_UPLOAD';
      v_message := 'Document uploaded: ' || coalesce(new.file_name, '');
      v_details := jsonb_build_object('file_name', new.file_name, 'mime_type', new.mime_type, 'type', new.type, 'visibility', new.visibility, 'project_id', new.project_id);
    end if;
    perform public.write_audit_log(
      v_action, v_message, v_details, v_document_name,
      'document', new.id, new.project_id, null,
      public.audit_value_slice(to_jsonb(new), v_columns)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_action := 'DOCUMENT_DELETE';
    v_document_name := old.file_name;
    v_message := 'Document deleted: ' || coalesce(old.file_name, '');
    v_details := jsonb_build_object('file_name', old.file_name, 'mime_type', old.mime_type, 'type', old.type, 'visibility', old.visibility, 'project_id', old.project_id);
    perform public.write_audit_log(
      v_action, v_message, v_details, v_document_name,
      'document', old.id, old.project_id,
      public.audit_value_slice(to_jsonb(old), v_columns), null
    );
    return null;
  end if;

  if old.visibility is distinct from new.visibility then
    v_action := 'DOCUMENT_VISIBILITY_CHANGE';
    v_message := 'Document visibility changed: ' || coalesce(new.file_name, '');
  elsif old.archived is distinct from new.archived then
    if new.archived then
      v_action := 'DOCUMENT_ARCHIVE';
      v_message := 'Document archived: ' || coalesce(new.file_name, '');
    else
      v_action := 'DOCUMENT_UPDATE';
      v_message := 'Document restored from archive: ' || coalesce(new.file_name, '');
    end if;
  else
    v_action := 'DOCUMENT_UPDATE';
    v_message := 'Document updated: ' || coalesce(new.file_name, '');
  end if;

  v_old_j := public.audit_value_slice(to_jsonb(old), v_columns);
  v_new_j := public.audit_value_slice(to_jsonb(new), v_columns);
  v_changed := public.audit_changed_keys(v_old_j, v_new_j);
  if coalesce(array_length(v_changed, 1), 0) = 0 then
    -- Only touched_at timestamps changed (e.g. audience-only edit through
    -- update_document_access): the RPC records DOCUMENT_AUDIENCE_CHANGE itself.
    return null;
  end if;
  v_old_values := (select jsonb_object_agg(column_name, v_old_j -> column_name) from unnest(v_changed) column_name);
  v_new_values := (select jsonb_object_agg(column_name, v_new_j -> column_name) from unnest(v_changed) column_name);
  v_document_name := new.file_name;
  v_details := jsonb_build_object('file_name', new.file_name, 'visibility', new.visibility, 'archived', new.archived, 'project_id', new.project_id);

  perform public.write_audit_log(
    v_action, v_message, v_details, v_document_name,
    'document', new.id, new.project_id, v_old_values, v_new_values
  );
  return null;
end;
$$;

notify pgrst, 'reload schema';