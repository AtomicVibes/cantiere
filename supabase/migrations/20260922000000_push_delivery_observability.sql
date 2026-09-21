-- =============================================================
-- Migration: Push delivery observability
--
-- The 2026-09-18 repair made the push trigger graceful-but-silent:
-- if either Vault secret (edge function URL / internal push token)
-- is missing, handle_new_notification_push() returns NEW without
-- any trace, and net.http_post() is fire-and-forget. A misconfigured
-- deployment therefore fails with zero feedback, which is exactly
-- the "Chrome permission granted but no popup" symptom observed.
--
-- This migration keeps the exact same trigger behavior and keeps
-- trg_notification_push untouched, but:
--   * logs a one-line record (notification id + user id + which
--     Vault secret is missing) when delivery is skipped so the
--     failure is no longer silent; and
--   * logs a one-line record when a delivery is queued.
-- No secrets are ever written to the log.
--
-- Deploy-time provisioning (unchanged, see 20260918000013):
--   * vault secret notifications_edge_function_url  (non-secret URL)
--   * vault secret notifications_internal_push_token (secret)
--   * send-push function env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
--                                       INTERNAL_PUSH_TOKEN
--   * send-push verify_jwt = false (supabase/config.toml)
-- =============================================================

create or replace function public.handle_new_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edge_url   text;
  v_push_token text;
  v_title      text;
  v_payload    jsonb;
  v_headers    jsonb;
begin
  if new.user_id is null then
    return new;
  end if;

  select decrypted_secret into v_edge_url
    from vault.decrypted_secrets
   where name = 'notifications_edge_function_url'
   order by updated_at desc
   limit 1;

  select decrypted_secret into v_push_token
    from vault.decrypted_secrets
   where name = 'notifications_internal_push_token'
   order by updated_at desc
   limit 1;

  if v_edge_url is null or v_push_token is null then
    raise log
      'push: delivery skipped for notification % (user %) — edge_url_present=%, token_present=%',
      new.id,
      new.user_id,
      v_edge_url is not null,
      v_push_token is not null;
    return new;
  end if;

  v_title := case coalesce(new.type, '')
    when 'message'          then 'New message'
    when 'project_request'  then 'New project request'
    when 'project_update'   then 'Project update'
    when 'project_assignment' then 'Project assignment'
    when 'role_update'      then 'Role update'
    when 'status_change'    then 'Status change'
    when 'team_assignment'  then 'Team assignment'
    when 'invoice_change'   then 'Invoice update'
    when 'permit_expiry'    then 'Permit expiry'
    when 'deadline_alert'   then 'Deadline alert'
    else 'Geometra'
  end;

  v_payload := jsonb_build_object(
    'title',           v_title,
    'body',            new.message,
    'receiver_id',     new.user_id,
    'type',            new.type,
    'url',             new.url,
    'notification_id', new.id
  );

  v_headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'x-push-token',  v_push_token
  );

  perform net.http_post(
    url                  := v_edge_url,
    body                 := v_payload,
    headers              := v_headers,
    timeout_milliseconds := 10000
  );

  raise log 'push: queued delivery for notification % (user %)',
    new.id,
    new.user_id;

  return new;
end;
$$;

notify pgrst, 'reload schema';