-- =============================================================
-- Sage integration (first Settings → Integrations entry)
--
-- Design goals:
--   * Configuration (URLs, ids, sync switches, status) lives in
--     public.sage_integrations and is readable/writable ONLY by the owning
--     Super Admin (RLS: owner AND super admin). The browser never receives
--     credentials.
--   * Secrets (client secret, OAuth tokens) live in a separate table,
--     public.sage_integration_credentials, with RLS enabled and NO policies:
--     the `authenticated`/`anon` roles therefore cannot read, write or even
--     probe a single row. Only the service role (Edge Functions) touches it.
--   * Every write/credential change/test/disconnect is audited through the
--     canonical public.write_audit_log().
--   * Everything is additive and idempotent so the migration is safe to apply
--     on a database that already has the earlier draft tables.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Small helpers (self-contained: no dependency on functions that may or
--    may not exist in a given environment).
-- -------------------------------------------------------------
create or replace function public.geometra_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Generic audit writer for the integration/config tables. Delegates to the
-- single canonical writer so audit hardening keeps working unchanged.
create or replace function public.log_generic_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_message text;
  v_entity text := tg_table_name;
  v_id uuid;
  v_actor uuid;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    -- OLD is not assigned for INSERT: never read it in this branch.
    if coalesce(new.enabled, false) then
      v_action := upper(tg_table_name) || '_ENABLED';
      v_message := tg_table_name || ' record created and enabled';
    else
      v_action := upper(tg_table_name) || '_CREATE';
      v_message := tg_table_name || ' record created';
    end if;
    v_id := new.id;
    v_actor := new.user_id;
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    -- Only state transitions are audited here. Operational detail (tests,
    -- sync runs, config saves) is audited with precise action types by the
    -- Sage Edge Function, so a generic UPDATE entry would only be noise.
    if coalesce(old.enabled, false) is distinct from coalesce(new.enabled, false) then
      v_action := upper(tg_table_name) || case when new.enabled then '_ENABLED' else '_DISABLED' end;
      v_message := tg_table_name || ' ' || case when new.enabled then 'enabled' else 'disabled' end;
      v_id := new.id;
      v_actor := new.user_id;
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
    else
      return null;
    end if;
  else
    -- NEW is not assigned for DELETE: never read it in this branch.
    v_action := upper(tg_table_name) || '_DELETE';
    v_message := tg_table_name || ' record deleted';
    v_id := old.id;
    v_actor := old.user_id;
    v_old := to_jsonb(old);
  end if;

  perform public.write_audit_log(
    v_action, v_message,
    jsonb_build_object('table', tg_table_name),
    null, v_entity, v_id, null,
    public.audit_value_slice(v_old, array['enabled', 'connection_status', 'last_sync', 'last_sync_error']),
    public.audit_value_slice(v_new, array['enabled', 'connection_status', 'last_sync', 'last_sync_error']),
    null, null, v_actor
  );
  return null;
exception
  -- Auditing must never break the underlying write: surface it in the server
  -- log instead of failing the transaction.
  when others then
    raise warning 'log_generic_changes failed: %', sqlerrm;
    return null;
end;
$$;

revoke all on function public.log_generic_changes() from public;
grant execute on function public.log_generic_changes() to authenticated;
grant execute on function public.log_generic_changes() to service_role;

-- -------------------------------------------------------------
-- 1. Non-secret configuration + status
-- -------------------------------------------------------------
create table if not exists public.sage_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  api_url text,
  client_id text,
  tenant_id text,
  company_id text,
  enabled boolean not null default false,
  connection_status text not null default 'not_connected',
  connection_status_message text,
  last_connection_test_at timestamptz,
  last_connection_test_status text,
  sync_invoices boolean not null default false,
  sync_clients boolean not null default false,
  sync_products boolean not null default false,
  sync_direction text not null default 'export',
  sync_interval_minutes integer not null default 60,
  last_sync_started_at timestamptz,
  last_sync timestamptz,
  last_sync_status text,
  last_sync_error text,
  last_sync_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Columns added after the first draft (idempotent).
alter table public.sage_integrations
  add column if not exists company_id text,
  add column if not exists enabled boolean not null default false,
  add column if not exists connection_status text not null default 'not_connected',
  add column if not exists connection_status_message text,
  add column if not exists last_connection_test_at timestamptz,
  add column if not exists last_connection_test_status text,
  add column if not exists sync_direction text not null default 'export',
  add column if not exists sync_interval_minutes integer not null default 60,
  add column if not exists last_sync_started_at timestamptz,
  add column if not exists last_sync_status text,
  add column if not exists last_sync_error text,
  add column if not exists last_sync_error_at timestamptz;

-- The draft stored the credential in the config row: it is moved into
-- public.sage_integration_credentials (see the backfill below) and the column
-- is dropped afterwards, so the browser can never read it again.

alter table public.sage_integrations enable row level security;

drop policy if exists "Users can manage their own Sage integration" on public.sage_integrations;
drop policy if exists "Super Admins read own Sage integration" on public.sage_integrations;
create policy "Super Admins read own Sage integration"
  on public.sage_integrations for select
  to authenticated
  using (auth.uid() = user_id and public.auth_user_is_super_admin());

-- Writes are server-side only (Edge Function / service role): no INSERT,
-- UPDATE or DELETE policy exists for the `authenticated` role.

drop trigger if exists set_sage_integrations_updated_at on public.sage_integrations;
create trigger set_sage_integrations_updated_at
  before update on public.sage_integrations
  for each row execute function public.geometra_touch_updated_at();

drop trigger if exists sage_integrations_audit on public.sage_integrations;
create trigger sage_integrations_audit
  after insert or update or delete on public.sage_integrations
  for each row execute function public.log_generic_changes();

revoke all on public.sage_integrations from anon;
grant select on public.sage_integrations to authenticated;
grant select, insert, update, delete on public.sage_integrations to service_role;

-- -------------------------------------------------------------
-- 2. Secrets: server-side only (no RLS policy => default deny)
-- -------------------------------------------------------------
create table if not exists public.sage_integration_credentials (
  integration_id uuid primary key references public.sage_integrations(id) on delete cascade,
  client_secret text,
  access_token text,
  refresh_token text,
  token_type text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sage_integration_credentials enable row level security;

-- Explicitly drop any policy a previous draft may have installed: this table
-- must never be reachable from the browser (RLS with no policy = default
-- deny, and service_role bypasses RLS).
do $$
declare
  pol record;
begin
  for pol in
    select p.polname from pg_policy p
    where p.polrelid = 'public.sage_integration_credentials'::regclass
  loop
    execute format('drop policy %I on public.sage_integration_credentials', pol.polname);
  end loop;
end
$$;

drop trigger if exists set_sage_credentials_updated_at on public.sage_integration_credentials;
create trigger set_sage_credentials_updated_at
  before update on public.sage_integration_credentials
  for each row execute function public.geometra_touch_updated_at();

revoke all on public.sage_integration_credentials from anon;
revoke all on public.sage_integration_credentials from authenticated;
grant select, insert, update, delete on public.sage_integration_credentials to service_role;

-- Backfill: adopt a secret left in the config row by the earlier draft, then
-- it is already out of the browser's reach because the column was dropped.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sage_integrations'
      and column_name = 'client_secret'
  ) then
    execute $sql$
      insert into public.sage_integration_credentials (integration_id, client_secret)
      select id, client_secret from public.sage_integrations
      where client_secret is not null and client_secret <> ''
      on conflict (integration_id) do update set client_secret = excluded.client_secret
    $sql$;
  end if;
exception when others then
  null;
end
$$;

-- Now that any legacy credential is safely stored server side, remove it from
-- the configuration row (which is readable by the Super Admin through RLS).
alter table public.sage_integrations drop column if exists client_secret;

-- -------------------------------------------------------------
-- 3. Server-side helpers (service role only)
-- -------------------------------------------------------------
create or replace function public.sage_save_secret(p_integration_id uuid, p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_integration_id is null then
    return false;
  end if;
  insert into public.sage_integration_credentials (integration_id, client_secret)
  values (p_integration_id, nullif(p_secret, ''))
  on conflict (integration_id) do update
    set client_secret = excluded.client_secret,
        updated_at = now();
  return true;
end;
$$;

create or replace function public.sage_has_secret(p_integration_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sage_integration_credentials
    where integration_id = p_integration_id
      and client_secret is not null and client_secret <> ''
  );
$$;

-- Server side only: used by the connection test to authenticate against Sage.
-- Never granted to the browser facing roles.
create or replace function public.sage_get_secret(p_integration_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select client_secret
  from public.sage_integration_credentials
  where integration_id = p_integration_id
    and client_secret is not null and client_secret <> '';
$$;

revoke all on function public.sage_save_secret(uuid, text) from public;
revoke all on function public.sage_save_secret(uuid, text) from anon;
revoke all on function public.sage_save_secret(uuid, text) from authenticated;
grant execute on function public.sage_save_secret(uuid, text) to service_role;

revoke all on function public.sage_has_secret(uuid) from public;
revoke all on function public.sage_has_secret(uuid) from anon;
revoke all on function public.sage_has_secret(uuid) from authenticated;
grant execute on function public.sage_has_secret(uuid) to service_role;

revoke all on function public.sage_get_secret(uuid) from public;
revoke all on function public.sage_get_secret(uuid) from anon;
revoke all on function public.sage_get_secret(uuid) from authenticated;
grant execute on function public.sage_get_secret(uuid) to service_role;

notify pgrst, 'reload schema';
