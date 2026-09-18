-- Repair the live Documents contract without dropping existing data.
-- This migration is intentionally independent of earlier document migrations.

alter table public.documents
  add column if not exists visibility text not null default 'private';

update public.documents
set visibility = 'private'
where visibility is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_visibility_check'
  ) then
    alter table public.documents
      add constraint documents_visibility_check
      check (visibility in ('private', 'public', 'selected'));
  end if;
end
$$;

create table if not exists public.document_audience (
  id uuid not null default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint document_audience_pkey primary key (id),
  constraint document_audience_unique unique (document_id, user_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.document_audience'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (document_id, user_id)'
  ) then
    alter table public.document_audience
      add constraint document_audience_unique unique (document_id, user_id);
  end if;
end
$$;

alter table public.project_timeline
  add column if not exists document_id uuid null references public.documents(id) on delete cascade;

create unique index if not exists project_timeline_document_id_unique
  on public.project_timeline(document_id)
  where document_id is not null;

alter table public.document_audience enable row level security;

-- Remove both signatures that may have been created by earlier attempts.
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

  if p_visibility is null or p_visibility not in ('private', 'public', 'selected') then
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

notify pgrst, 'reload schema';
