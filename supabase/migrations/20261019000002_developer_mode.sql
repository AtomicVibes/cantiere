-- =============================================================
-- Developer Mode (Super Admin only, short lived, secret protected)
--
-- Security model:
--   * The activation secret never reaches the browser: the Edge Function
--     compares it server-side against a SHA-256 representation supplied at
--     deploy time (DEVELOPER_MODE_SECRET_SHA256 / DEVELOPER_MODE_SECRET)
--     using a timing-safe compare. There is no built-in fallback secret: the
--     earlier development secret was exposed and is permanently revoked.
--   * The table is read-only from the client (RLS: owner + Super Admin) and
--     is protected by a trigger that rejects writes coming from the
--     `authenticated`/`anon` PostgREST roles, so Developer Mode can never be
--     enabled by flipping a row from the browser.
--   * Activation attempts are rate limited: 5 failures lock the feature for
--     15 minutes, and every activation carries an expiry (default 4 hours).
--   * Activation/deactivation is auditable through public.write_audit_log();
--     audit suppression paths are forbidden.
-- =============================================================

create table if not exists public.developer_mode (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  activated_at timestamptz,
  deactivated_at timestamptz,
  expires_at timestamptz,
  failed_attempts integer not null default 0,
  first_failed_at timestamptz,
  locked_until timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.developer_mode
  add column if not exists enabled boolean not null default false,
  add column if not exists expires_at timestamptz,
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists first_failed_at timestamptz,
  add column if not exists locked_until timestamptz,
  add column if not exists last_verified_at timestamptz;

alter table public.developer_mode enable row level security;

-- Read-only for the owning Super Admin. There is deliberately no INSERT,
-- UPDATE or DELETE policy for `authenticated`.
drop policy if exists "Super Admins read own Developer Mode" on public.developer_mode;
drop policy if exists "Super Admins can manage their own Developer Mode" on public.developer_mode;
create policy "Super Admins read own Developer Mode"
  on public.developer_mode for select
  to authenticated
  using (auth.uid() = user_id and public.auth_user_is_super_admin());

-- Service-role-only write guard: PostgREST exposes `authenticated`/`anon`
-- with their claim role, the Edge Functions use the service role, and direct
-- SQL sessions are not a PostgREST client.
create or replace function public.reject_client_developer_mode_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_claim text;
  v_role text;
begin
  v_claim := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_role  := coalesce(current_setting('role', true), '');
  if v_claim in ('authenticated', 'anon') or v_role in ('authenticated', 'anon') then
    raise exception 'developer_mode is server-managed: use the developer-mode-toggle Edge Function'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.reject_client_developer_mode_write() from public;
grant execute on function public.reject_client_developer_mode_write() to service_role;
grant execute on function public.reject_client_developer_mode_write() to authenticated;

drop trigger if exists block_client_developer_mode_write on public.developer_mode;
create trigger block_client_developer_mode_write
  before insert or update or delete on public.developer_mode
  for each row execute function public.reject_client_developer_mode_write();

drop trigger if exists set_developer_mode_updated_at on public.developer_mode;
create trigger set_developer_mode_updated_at
  before update on public.developer_mode
  for each row execute function public.geometra_touch_updated_at();

-- State transition audit (insert/delete/enabled flips only). Operational
-- failures (wrong secret, lockouts) are audited by the Edge Function with
-- precise action types, so this trigger stays narrow to avoid duplicates.
create or replace function public.log_developer_mode_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_message text;
  v_id uuid;
  v_actor uuid;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    -- OLD is not assigned for INSERT: never read it in this branch.
    if new.enabled then
      v_action := 'DEV_MODE_ACTIVATED';
      v_message := 'Developer Mode activated';
    elsif new.deactivated_at is not null then
      v_action := 'DEV_MODE_DEACTIVATED';
      v_message := 'Developer Mode deactivated';
    else
      v_action := 'DEV_MODE_CREATE';
      v_message := 'Developer Mode record created';
    end if;
    v_id := new.id;
    v_actor := new.user_id;
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    if coalesce(old.enabled, false) is distinct from coalesce(new.enabled, false) then
      if new.enabled then
        v_action := 'DEV_MODE_ACTIVATED';
        v_message := 'Developer Mode activated';
      else
        v_action := 'DEV_MODE_DEACTIVATED';
        v_message := 'Developer Mode deactivated';
      end if;
      v_id := new.id;
      v_actor := new.user_id;
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
    else
      return null;
    end if;
  else
    -- NEW is not assigned for DELETE: never read it in this branch.
    v_action := 'DEV_MODE_DELETE';
    v_message := 'Developer Mode record deleted';
    v_id := old.id;
    v_actor := old.user_id;
    v_old := to_jsonb(old);
  end if;

  perform public.write_audit_log(
    v_action, v_message,
    jsonb_build_object('table', 'developer_mode'),
    null, 'developer_mode', v_id, null,
    public.audit_value_slice(v_old, array['enabled']),
    public.audit_value_slice(v_new, array['enabled']),
    null, null, v_actor
  );
  return null;
exception
  when others then
    raise warning 'log_developer_mode_changes failed: %', sqlerrm;
    return null;
end;
$$;

revoke all on function public.log_developer_mode_changes() from public;
grant execute on function public.log_developer_mode_changes() to authenticated;
grant execute on function public.log_developer_mode_changes() to service_role;

drop trigger if exists developer_mode_audit on public.developer_mode;
create trigger developer_mode_audit
  after insert or update or delete on public.developer_mode
  for each row execute function public.log_developer_mode_changes();

revoke all on public.developer_mode from anon;
revoke insert, update, delete on public.developer_mode from authenticated;
grant select on public.developer_mode to authenticated;
grant select, insert, update, delete on public.developer_mode to service_role;

notify pgrst, 'reload schema';
