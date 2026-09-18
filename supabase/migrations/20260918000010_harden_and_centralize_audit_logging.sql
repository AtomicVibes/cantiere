-- =============================================================
-- Migration: Harden and centralize audit logging
--
--  - Adds canonical nullable audit columns (additive, no drops).
--  - Creates the single canonical DB writer public.write_audit_log()
--    (SECURITY DEFINER, fixed empty search_path, server-side actor
--    resolution, explicit actors accepted only under service_role).
--  - Rewrites every existing audit-writing trigger function so it
--    delegates to write_audit_log() instead of inserting directly.
--  - Adds authoritative triggers for documents, events, invoices,
--    project_requests and clients (delete / block / unblock).
--  - Tightens the audit_logs INSERT RLS policy (self-only rows).
--  - Extends update_document_access() to emit DOCUMENT_AUDIENCE_CHANGE
--    only for audience-only edits (visibility edits are covered by the
--    documents UPDATE trigger, so no duplicates are produced).
--  - Self-audits super-admin archival/deletion of audit rows without
--    recursive audit triggers (no INSERT trigger on audit_logs exists).
--
-- Historical/current columns of public.audit_logs are preserved.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Canonical audit columns (all nullable, additive)
-- -------------------------------------------------------------
alter table public.audit_logs
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists project_id uuid,
  add column if not exists old_values jsonb,
  add column if not exists new_values jsonb,
  add column if not exists ip_address text,
  add column if not exists user_agent text;

create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);

-- -------------------------------------------------------------
-- 2. Canonical write function (the ONLY database writer)
-- -------------------------------------------------------------
create or replace function public.write_audit_log(
  p_action_type text,
  p_message text default null,
  p_details jsonb default '{}'::jsonb,
  p_document_name text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_project_id uuid default null,
  p_old_values jsonb default null,
  p_new_values jsonb default null,
  p_ip_address text default null,
  p_user_agent text default null,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := auth.role();
  v_actor uuid;
  v_details jsonb;
  v_id uuid;
begin
  -- Actor resolution is server-side and authoritative.
  if v_role = 'service_role' then
    v_actor := p_actor;                 -- trusted explicit actor (may be NULL)
  elsif v_role = 'authenticated' then
    v_actor := auth.uid();
    if p_actor is not null and p_actor is distinct from v_actor then
      raise exception 'actor_mismatch: client-provided actor is not allowed for authenticated requests'
        using errcode = 'P0001';
    end if;
    if v_actor is null then
      raise exception 'authentication_required' using errcode = 'P0001';
    end if;
  else
    -- anon role or no JWT at all (maintenance / psql statements).
    if p_actor is not null then
      raise exception 'explicit_actor_forbidden: explicit actors are only accepted from service_role'
        using errcode = 'P0001';
    end if;
    v_actor := null;
  end if;

  -- Backward compatibility for Logs.jsx: keep details.table / details.record_id.
  v_details := coalesce(p_details, '{}'::jsonb);
  if p_entity_type is not null and not (v_details ? 'table') then
    v_details := v_details || jsonb_build_object('table', p_entity_type);
  end if;
  if p_entity_id is not null and not (v_details ? 'record_id') then
    v_details := v_details || jsonb_build_object('record_id', p_entity_id);
  end if;

  insert into public.audit_logs (
    user_id, action_type, message, document_name, details,
    entity_type, entity_id, project_id, old_values, new_values,
    ip_address, user_agent
  )
  values (
    v_actor, p_action_type, p_message, p_document_name, v_details,
    p_entity_type, p_entity_id, p_project_id, p_old_values, p_new_values,
    p_ip_address, p_user_agent
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.write_audit_log(text, text, jsonb, text, text, uuid, uuid, jsonb, jsonb, text, text, uuid) from public;
grant execute on function public.write_audit_log(text, text, jsonb, text, text, uuid, uuid, jsonb, jsonb, text, text, uuid) to authenticated;
grant execute on function public.write_audit_log(text, text, jsonb, text, text, uuid, uuid, jsonb, jsonb, text, text, uuid) to service_role;

-- -------------------------------------------------------------
-- 3. Small helpers used by the trigger functions to compute diffs
-- -------------------------------------------------------------
create or replace function public.audit_value_slice(
  p_row jsonb,
  p_columns text[]
)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(column_name, jsonb_strip_nulls(p_row) -> column_name),
    '{}'::jsonb
  )
  from unnest(p_columns) as column_name
  where p_row ? column_name;
$$;

create or replace function public.audit_changed_keys(
  p_old jsonb,
  p_new jsonb,
  p_exclude text[] default array['created_at', 'updated_at']
)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(column_name), '{}'::text[])
  from (
    select column_name
    from jsonb_each(jsonb_strip_nulls(p_old)) source(column_name, source_value)
    where not (source.column_name = any(p_exclude))
      and jsonb_strip_nulls(p_old) -> source.column_name
        is distinct from jsonb_strip_nulls(p_new) -> source.column_name
    union
    select column_name
    from jsonb_each(jsonb_strip_nulls(p_new)) source(column_name, source_value)
    where not (source.column_name = any(p_exclude))
      and not jsonb_strip_nulls(p_old) ? source.column_name
  ) changed;
$$;

-- -------------------------------------------------------------
-- 4. Trigger functions (all delegate to write_audit_log)
-- -------------------------------------------------------------

-- Projects
create or replace function public.log_project_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columns text[] := array['name', 'description', 'budget', 'status', 'progress', 'client_id', 'assigned_to'];
  v_action text;
  v_message text;
  v_details jsonb;
  v_old_j jsonb;
  v_new_j jsonb;
  v_changed text[];
  v_old_values jsonb;
  v_new_values jsonb;
begin
  -- Edge functions (approve -> validate_project_request) create projects under
  -- service_role and write their own PROJECT_CREATE audit entry; skip here so
  -- no duplicate and no actor loss occurs.
  if auth.role() = 'service_role' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'PROJECT_CREATE';
    v_message := 'Project created: ' || coalesce(new.name, '');
    v_details := jsonb_build_object('name', new.name, 'budget', new.budget, 'status', new.status);
    perform public.write_audit_log(
      v_action, v_message, v_details, null,
      'project', new.id, new.id, null,
      public.audit_value_slice(to_jsonb(new), v_columns)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_action := 'PROJECT_DELETE';
    v_message := 'Project deleted: ' || coalesce(old.name, '');
    v_details := jsonb_build_object('name', old.name, 'budget', old.budget, 'status', old.status);
    perform public.write_audit_log(
      v_action, v_message, v_details, null,
      'project', old.id, old.id,
      public.audit_value_slice(to_jsonb(old), v_columns), null
    );
    return null;
  end if;

  -- UPDATE
  if old.status is distinct from new.status and new.status = 'archived' then
    v_action := 'PROJECT_ARCHIVE';
    v_message := 'Project archived: ' || coalesce(new.name, '');
  elsif old.status is distinct from new.status and old.status = 'archived' then
    v_action := 'PROJECT_UPDATE';
    v_message := 'Project restored from archive: ' || coalesce(new.name, '');
  else
    v_action := 'PROJECT_UPDATE';
    v_message := 'Project updated: ' || coalesce(new.name, '');
  end if;

  v_old_j := public.audit_value_slice(to_jsonb(old), v_columns);
  v_new_j := public.audit_value_slice(to_jsonb(new), v_columns);
  v_changed := public.audit_changed_keys(v_old_j, v_new_j);
  if coalesce(array_length(v_changed, 1), 0) = 0 then
    return null;  -- only touched_at timestamps changed; nothing meaningful to record
  end if;
  v_old_values := (select jsonb_object_agg(column_name, v_old_j -> column_name) from unnest(v_changed) column_name);
  v_new_values := (select jsonb_object_agg(column_name, v_new_j -> column_name) from unnest(v_changed) column_name);
  v_details := jsonb_build_object('name', new.name, 'budget', new.budget, 'status', new.status);

  perform public.write_audit_log(
    v_action, v_message, v_details, null,
    'project', new.id, new.id, v_old_values, v_new_values
  );
  return null;
end;
$$;

-- Project timeline
create or replace function public.log_timeline_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columns text[] := array['title', 'description', 'status', 'date', 'document_id', 'responsible_person_id'];
  v_action text;
  v_message text;
  v_old_j jsonb;
  v_new_j jsonb;
  v_changed text[];
  v_old_values jsonb;
  v_new_values jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'TIMELINE_CREATE';
    v_message := 'Timeline entry created: ' || coalesce(new.title, '');
    perform public.write_audit_log(
      v_action, v_message,
      jsonb_build_object('title', new.title, 'project_id', new.project_id),
      null, 'project_timeline', new.id, new.project_id, null,
      public.audit_value_slice(to_jsonb(new), v_columns)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_action := 'TIMELINE_DELETE';
    v_message := 'Timeline entry deleted: ' || coalesce(old.title, '');
    perform public.write_audit_log(
      v_action, v_message,
      jsonb_build_object('title', old.title, 'project_id', old.project_id),
      null, 'project_timeline', old.id, old.project_id,
      public.audit_value_slice(to_jsonb(old), v_columns), null
    );
    return null;
  end if;

  v_action := 'TIMELINE_UPDATE';
  v_message := 'Timeline entry updated: ' || coalesce(new.title, '');
  v_old_j := public.audit_value_slice(to_jsonb(old), v_columns);
  v_new_j := public.audit_value_slice(to_jsonb(new), v_columns);
  v_changed := public.audit_changed_keys(v_old_j, v_new_j);
  if coalesce(array_length(v_changed, 1), 0) = 0 then
    return null;
  end if;
  v_old_values := (select jsonb_object_agg(column_name, v_old_j -> column_name) from unnest(v_changed) column_name);
  v_new_values := (select jsonb_object_agg(column_name, v_new_j -> column_name) from unnest(v_changed) column_name);

  perform public.write_audit_log(
    v_action, v_message,
    jsonb_build_object('title', new.title, 'project_id', new.project_id),
    null, 'project_timeline', new.id, new.project_id, v_old_values, v_new_values
  );
  return null;
end;
$$;

-- Profile role changes
create or replace function public.log_profile_role_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_role text;
  v_new_role text;
begin
  if not (old.role_id is distinct from new.role_id) then
    return null;
  end if;

  -- invite-user / create-client edge functions run under service_role and emit
  -- their own ROLE_UPDATE entry with an explicit actor; skip here to avoid a
  -- duplicate entry with a NULL actor.
  if auth.role() = 'service_role' then
    return null;
  end if;

  select name into v_old_role from public.roles where id = old.role_id;
  select name into v_new_role from public.roles where id = new.role_id;

  perform public.write_audit_log(
    'ROLE_UPDATE',
    'Profile role updated: ' || coalesce(v_old_role, 'none') || ' -> ' || coalesce(v_new_role, 'none'),
    jsonb_build_object('from_role', v_old_role, 'to_role', v_new_role, 'profile_id', new.id),
    null, 'profile', new.id, null,
    jsonb_build_object('role_id', old.role_id, 'role_name', v_old_role),
    jsonb_build_object('role_id', new.role_id, 'role_name', v_new_role)
  );
  return null;
end;
$$;

-- Clients: creation (authenticated only), delete (always), block / unblock
create or replace function public.log_client_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_message text;
  v_details jsonb;
  v_entity_id uuid;
  v_old_values jsonb;
  v_new_values jsonb;
begin
  if tg_op = 'INSERT' then
    -- Self-registered / dashboard-created clients under an authenticated session.
    if auth.role() <> 'authenticated' then
      return null;
    end if;
    v_action := 'CLIENT_CREATE';
    v_message := 'Client created';
    v_details := jsonb_build_object('client_id', new.id, 'company_name', new.company_name, 'profile_id', new.profile_id);
    v_entity_id := new.id;
    v_old_values := null;
    v_new_values := public.audit_value_slice(to_jsonb(new), array['company_name', 'vat_number', 'address', 'notes', 'profile_id']);
  elsif tg_op = 'UPDATE' then
    if not (old.is_blocked is distinct from new.is_blocked) then
      return null;
    end if;
    v_action := case when new.is_blocked then 'ACCOUNT_BLOCK' else 'ACCOUNT_UNBLOCK' end;
    v_message := case when new.is_blocked then 'Client account blocked' else 'Client account unblocked' end;
    v_details := jsonb_build_object('client_id', new.id, 'company_name', new.company_name, 'profile_id', new.profile_id);
    v_entity_id := new.id;
    v_old_values := jsonb_build_object('is_blocked', old.is_blocked);
    v_new_values := jsonb_build_object('is_blocked', new.is_blocked);
  else
    -- Deletes may originate from a service_role cascade (delete-user). In that
    -- case auth.uid() is NULL and write_audit_log preserves NULL (no fabricated
    -- actor), exactly as required.
    v_action := 'CLIENT_DELETE';
    v_message := 'Client deleted: ' || coalesce(old.company_name, '');
    v_details := jsonb_build_object('client_id', old.id, 'company_name', old.company_name, 'profile_id', old.profile_id);
    v_entity_id := old.id;
    v_old_values := public.audit_value_slice(to_jsonb(old), array['company_name', 'vat_number', 'address', 'notes', 'profile_id', 'is_blocked']);
    v_new_values := null;
  end if;

  perform public.write_audit_log(
    v_action, v_message, v_details, null,
    'client', v_entity_id, null, v_old_values, v_new_values
  );
  return null;
end;
$$;

-- Documents
create or replace function public.log_document_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columns text[] := array['file_name', 'mime_type', 'file_size', 'type', 'notes', 'project_id', 'visibility', 'archived'];
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
    v_action := 'DOCUMENT_UPLOAD';
    v_document_name := new.file_name;
    v_message := 'Document uploaded: ' || coalesce(new.file_name, '');
    v_details := jsonb_build_object('file_name', new.file_name, 'mime_type', new.mime_type, 'type', new.type, 'visibility', new.visibility, 'project_id', new.project_id);
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

-- Events
create or replace function public.log_event_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columns text[] := array['title', 'description', 'type', 'date', 'time', 'location', 'visibility', 'project_id', 'archived'];
  v_action text;
  v_message text;
  v_details jsonb;
  v_old_j jsonb;
  v_new_j jsonb;
  v_changed text[];
  v_old_values jsonb;
  v_new_values jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'EVENT_CREATE';
    v_message := 'Event created: ' || coalesce(new.title, '');
    v_details := jsonb_build_object('title', new.title, 'type', new.type, 'date', new.date, 'visibility', new.visibility, 'project_id', new.project_id);
    perform public.write_audit_log(
      v_action, v_message, v_details, null,
      'event', new.id, new.project_id, null,
      public.audit_value_slice(to_jsonb(new), v_columns)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_action := 'EVENT_DELETE';
    v_message := 'Event deleted: ' || coalesce(old.title, '');
    v_details := jsonb_build_object('title', old.title, 'type', old.type, 'date', old.date, 'visibility', old.visibility, 'project_id', old.project_id);
    perform public.write_audit_log(
      v_action, v_message, v_details, null,
      'event', old.id, old.project_id,
      public.audit_value_slice(to_jsonb(old), v_columns), null
    );
    return null;
  end if;

  if old.archived is distinct from new.archived then
    if new.archived then
      v_action := 'EVENT_ARCHIVE';
      v_message := 'Event archived: ' || coalesce(new.title, '');
    else
      v_action := 'EVENT_UPDATE';
      v_message := 'Event restored from archive: ' || coalesce(new.title, '');
    end if;
  else
    v_action := 'EVENT_UPDATE';
    v_message := 'Event updated: ' || coalesce(new.title, '');
  end if;

  v_old_j := public.audit_value_slice(to_jsonb(old), v_columns);
  v_new_j := public.audit_value_slice(to_jsonb(new), v_columns);
  v_changed := public.audit_changed_keys(v_old_j, v_new_j);
  if coalesce(array_length(v_changed, 1), 0) = 0 then
    return null;
  end if;
  v_old_values := (select jsonb_object_agg(column_name, v_old_j -> column_name) from unnest(v_changed) column_name);
  v_new_values := (select jsonb_object_agg(column_name, v_new_j -> column_name) from unnest(v_changed) column_name);
  v_details := jsonb_build_object('title', new.title, 'type', new.type, 'archived', new.archived, 'project_id', new.project_id);

  perform public.write_audit_log(
    v_action, v_message, v_details, null,
    'event', new.id, new.project_id, v_old_values, v_new_values
  );
  return null;
end;
$$;

-- Invoices
create or replace function public.log_invoice_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columns text[] := array['amount', 'status', 'archived'];
  v_action text;
  v_message text;
  v_details jsonb;
  v_old_j jsonb;
  v_new_j jsonb;
  v_changed text[];
  v_old_values jsonb;
  v_new_values jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'INVOICE_CREATE';
    v_message := 'Invoice created';
    v_details := jsonb_build_object('amount', new.amount, 'status', new.status);
    perform public.write_audit_log(
      v_action, v_message, v_details, null,
      'invoice', new.id, null, null,
      public.audit_value_slice(to_jsonb(new), v_columns)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_action := 'INVOICE_DELETE';
    v_message := 'Invoice deleted';
    v_details := jsonb_build_object('amount', old.amount, 'status', old.status);
    perform public.write_audit_log(
      v_action, v_message, v_details, null,
      'invoice', old.id, null,
      public.audit_value_slice(to_jsonb(old), v_columns), null
    );
    return null;
  end if;

  if old.archived is distinct from new.archived then
    if new.archived then
      v_action := 'INVOICE_ARCHIVE';
      v_message := 'Invoice archived';
    else
      v_action := 'INVOICE_UPDATE';
      v_message := 'Invoice restored from archive';
    end if;
  else
    v_action := 'INVOICE_UPDATE';
    v_message := 'Invoice updated';
  end if;

  v_old_j := public.audit_value_slice(to_jsonb(old), v_columns);
  v_new_j := public.audit_value_slice(to_jsonb(new), v_columns);
  v_changed := public.audit_changed_keys(v_old_j, v_new_j);
  if coalesce(array_length(v_changed, 1), 0) = 0 then
    return null;
  end if;
  v_old_values := (select jsonb_object_agg(column_name, v_old_j -> column_name) from unnest(v_changed) column_name);
  v_new_values := (select jsonb_object_agg(column_name, v_new_j -> column_name) from unnest(v_changed) column_name);
  v_details := jsonb_build_object('amount', new.amount, 'status', new.status);

  perform public.write_audit_log(
    v_action, v_message, v_details, null,
    'invoice', new.id, null, v_old_values, v_new_values
  );
  return null;
end;
$$;

-- Project requests
create or replace function public.log_project_request_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columns text[] := array['project_name', 'description', 'category', 'address', 'budget', 'estimated_deadline', 'document_url', 'status', 'rejection_reason', 'archived'];
  v_action text;
  v_message text;
  v_details jsonb;
  v_old_j jsonb;
  v_new_j jsonb;
  v_changed text[];
  v_old_values jsonb;
  v_new_values jsonb;
begin
  -- project requests are created/reviewed by the edge functions
  -- (projects-creation, review-project-request) under service_role; those write
  -- their own REQUEST_* entries with an explicit actor. This trigger only
  -- records authenticated frontend operations (primarily archive/restore).
  if auth.role() = 'service_role' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'REQUEST_CREATE';
    v_message := 'Project request created: ' || coalesce(new.project_name, '');
    v_details := jsonb_build_object('project_name', new.project_name, 'status', new.status, 'budget', new.budget);
    perform public.write_audit_log(
      v_action, v_message, v_details, null,
      'project_request', new.id, null, null,
      public.audit_value_slice(to_jsonb(new), v_columns)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_action := 'REQUEST_DELETE';
    v_message := 'Project request deleted: ' || coalesce(old.project_name, '');
    v_details := jsonb_build_object('project_name', old.project_name, 'status', old.status);
    perform public.write_audit_log(
      v_action, v_message, v_details, null,
      'project_request', old.id, null,
      public.audit_value_slice(to_jsonb(old), v_columns), null
    );
    return null;
  end if;

  if old.archived is distinct from new.archived then
    if new.archived then
      v_action := 'REQUEST_ARCHIVE';
      v_message := 'Project request archived: ' || coalesce(new.project_name, '');
    else
      v_action := 'REQUEST_UPDATE';
      v_message := 'Project request restored from archive: ' || coalesce(new.project_name, '');
    end if;
  else
    v_action := 'REQUEST_UPDATE';
    v_message := 'Project request updated: ' || coalesce(new.project_name, '');
  end if;

  v_old_j := public.audit_value_slice(to_jsonb(old), v_columns);
  v_new_j := public.audit_value_slice(to_jsonb(new), v_columns);
  v_changed := public.audit_changed_keys(v_old_j, v_new_j);
  if coalesce(array_length(v_changed, 1), 0) = 0 then
    return null;
  end if;
  v_old_values := (select jsonb_object_agg(column_name, v_old_j -> column_name) from unnest(v_changed) column_name);
  v_new_values := (select jsonb_object_agg(column_name, v_new_j -> column_name) from unnest(v_changed) column_name);
  v_details := jsonb_build_object('project_name', new.project_name, 'status', new.status);

  perform public.write_audit_log(
    v_action, v_message, v_details, null,
    'project_request', new.id, null, v_old_values, v_new_values
  );
  return null;
end;
$$;

-- Audit-log administration (archive / restore / delete) self-audit.
-- Safe from recursion: this trigger is AFTER UPDATE OR DELETE only, and
-- write_audit_log performs an INSERT which no trigger handles.
create or replace function public.log_audit_log_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_message text;
  v_entity_id uuid;
  v_details jsonb;
begin
  if tg_op = 'DELETE' then
    v_action := 'AUDIT_LOG_DELETE';
    v_message := 'Audit log entry deleted';
    v_entity_id := old.id;
    v_details := jsonb_build_object('audit_log_id', old.id, 'action_type', old.action_type);
  else
    if not (old.archived is distinct from new.archived) then
      return null;
    end if;
    if new.archived then
      v_action := 'AUDIT_LOG_ARCHIVE';
      v_message := 'Audit log entry archived';
    else
      v_action := 'AUDIT_LOG_UPDATE';
      v_message := 'Audit log entry restored';
    end if;
    v_entity_id := new.id;
    v_details := jsonb_build_object('audit_log_id', new.id, 'action_type', new.action_type, 'archived', new.archived);
  end if;

  perform public.write_audit_log(v_action, v_message, v_details, null, 'audit_log', v_entity_id, null, null, null);
  return null;
end;
$$;

-- -------------------------------------------------------------
-- 5. Triggers
-- -------------------------------------------------------------
drop trigger if exists trg_audit_projects on public.projects;
create trigger trg_audit_projects
  after insert or update or delete on public.projects
  for each row execute function public.log_project_changes();

drop trigger if exists trg_audit_timeline on public.project_timeline;
create trigger trg_audit_timeline
  after insert or update or delete on public.project_timeline
  for each row execute function public.log_timeline_changes();

drop trigger if exists trg_audit_profile_role on public.profiles;
create trigger trg_audit_profile_role
  after update of role_id on public.profiles
  for each row execute function public.log_profile_role_changes();

-- Clients (delete always; block/unblock when is_blocked exists)
do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.clients'::regclass and attname = 'is_blocked'
  ) then
    drop trigger if exists trg_audit_clients on public.clients;
    create trigger trg_audit_clients
      after insert or delete on public.clients
      for each row execute function public.log_client_deletion();
  else
    drop trigger if exists trg_audit_clients on public.clients;
    create trigger trg_audit_clients
      after insert or update of is_blocked or delete on public.clients
      for each row execute function public.log_client_deletion();
  end if;
end
$$;

-- Documents / events / invoices / project_requests exist only through recent
-- migrations: attach triggers only when the tables are actually present.
do $$
begin
  if to_regclass('public.documents') is not null then
    drop trigger if exists trg_audit_documents on public.documents;
    create trigger trg_audit_documents
      after insert or update or delete on public.documents
      for each row execute function public.log_document_changes();
  end if;

  if to_regclass('public.events') is not null then
    drop trigger if exists trg_audit_events on public.events;
    create trigger trg_audit_events
      after insert or update or delete on public.events
      for each row execute function public.log_event_changes();
  end if;

  if to_regclass('public.invoices') is not null then
    drop trigger if exists trg_audit_invoices on public.invoices;
    create trigger trg_audit_invoices
      after insert or update or delete on public.invoices
      for each row execute function public.log_invoice_changes();
  end if;

  if to_regclass('public.project_requests') is not null then
    drop trigger if exists trg_audit_project_requests on public.project_requests;
    create trigger trg_audit_project_requests
      after insert or update or delete on public.project_requests
      for each row execute function public.log_project_request_changes();
  end if;
end
$$;

drop trigger if exists trg_audit_audit_log_changes on public.audit_logs;
create trigger trg_audit_audit_log_changes
  after update or delete on public.audit_logs
  for each row execute function public.log_audit_log_changes();

-- -------------------------------------------------------------
-- 6. RLS: replace the forgeable INSERT policy with a self-only one.
--    All real writers go through write_audit_log() (owner-level, RLS bypass),
--    so a direct client INSERT can now only ever create a row for its own uid.
-- -------------------------------------------------------------
-- Remove every INSERT policy on audit_logs (whatever its name), then install a
-- single self-only policy. The well-known forgeable policy is dropped by name
-- for clarity; the loop catches any additional/renamed ones.
do $$
declare
  pol record;
begin
  for pol in
    select p.polname
    from pg_policy p
    where p.polrelid = 'public.audit_logs'::regclass
      and p.polcmd = 'a'   -- INSERT
  loop
    execute format('drop policy %I on public.audit_logs', pol.polname);
  end loop;
end
$$;

create policy "Users can insert own audit logs"
  on public.audit_logs for insert to authenticated
  with check (user_id = auth.uid());

-- -------------------------------------------------------------
-- 7. update_document_access: emit DOCUMENT_AUDIENCE_CHANGE for audience-only
--    edits. Visibility edits are covered by the documents UPDATE trigger
--    (DOCUMENT_VISIBILITY_CHANGE), so exactly one event is produced.
-- -------------------------------------------------------------
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
  existing_visibility text;
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

  if not public.document_is_owner(p_document_id, auth.uid()) then
    raise exception 'Not authorized to update this document';
  end if;

  if p_visibility = 'selected' then
    foreach audience_user_id in array p_audience_user_ids loop
      if not exists (select 1 from auth.users where id = audience_user_id) then
        raise exception 'Invalid audience user';
      end if;
    end loop;
  end if;

  select visibility into existing_visibility
  from public.documents
  where id = p_document_id;

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

  -- Audience-only edits leave visibility untouched and produce no meaningful
  -- documents UPDATE diff, so the trigger stays silent and we log here.
  if existing_visibility is not distinct from p_visibility then
    perform public.write_audit_log(
      'DOCUMENT_AUDIENCE_CHANGE',
      'Document audience updated: ' || updated_document.file_name,
      jsonb_build_object(
        'document_id', p_document_id,
        'visibility', p_visibility,
        'audience_user_ids', coalesce(to_jsonb(p_audience_user_ids), '[]'::jsonb)
      ),
      updated_document.file_name,
      'document', p_document_id,
      updated_document.project_id
    );
  end if;

  return updated_document;
end;
$$;

revoke all on function public.update_document_access(uuid, text, uuid[]) from public;
grant execute on function public.update_document_access(uuid, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';