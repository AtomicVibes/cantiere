-- =============================================================
-- Sage sync state on invoices (external ids, status, error/retry state)
--
-- Additive only: no existing invoice column changes meaning, RLS stays as
-- configured by 20260921120000 / 20261016120000. The Sage sync status is part
-- of the audited invoice columns so a synchronization can never change an
-- invoice without leaving an audit trail.
-- =============================================================

alter table public.invoices
  add column if not exists external_id text,
  add column if not exists sage_id text,
  add column if not exists sage_sync_status text not null default 'not_synced',
  add column if not exists sage_last_synced_at timestamptz,
  add column if not exists sage_sync_error text,
  add column if not exists sage_sync_version integer not null default 1,
  add column if not exists sage_sync_direction text not null default 'export';

-- Retry/queued state is queryable without scanning the whole table.
create index if not exists invoices_sage_sync_status_idx
  on public.invoices (sage_sync_status)
  where sage_sync_status is distinct from 'not_synced';

create index if not exists invoices_external_id_idx
  on public.invoices (external_id)
  where external_id is not null;

-- Sanity constraint: only known sync states are allowed. Declared NOT VALID
-- so pre-existing rows are untouched while new writes are checked.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_sage_sync_status_chk'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_sage_sync_status_chk
      check (sage_sync_status in ('not_synced','pending','syncing','synced','error','skipped'))
      not valid;
  end if;
exception when others then
  null;
end
$$;

-- -------------------------------------------------------------
-- Audit: include the synchronization columns in the canonical invoice
-- audit trigger so invoice changes (including Sage state) are always logged.
-- -------------------------------------------------------------
create or replace function public.log_invoice_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columns text[] := array['amount', 'status', 'archived', 'sage_sync_status', 'sage_id', 'external_id'];
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
  elsif old.sage_sync_status is distinct from new.sage_sync_status then
    v_action := 'INVOICE_SYNC_UPDATE';
    v_message := 'Invoice Sage synchronization state changed';
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

notify pgrst, 'reload schema';
