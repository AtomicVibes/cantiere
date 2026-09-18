-- =============================================================
-- Migration: Push delivery repair
--
-- End-to-end audit (2026-09-18) found the push pipeline was dead
-- and carried an exposed service-role key:
--
--   1. The AFTER INSERT trigger trg_notification_push was NOT
--      attached to live notifications, so no notification ever
--      triggered a push. (CRITICAL - broken link)
--   2. handle_new_notification_push() referenced "new.title",
--      but notifications has no title column - the function
--      would raise at first execution even if triggered.
--   3. A hardcoded service_role JWT was embedded in two prior
--      migrations (00011/00012) AND in the live function body.
--      That key must be treated as compromised and rotated.
--      This migration removes all service-role references.
--   4. send-push was callable by any authenticated user with an
--      arbitrary receiver_id (push spam/phishing to any device).
--      That is fixed in supabase/functions/send-push/index.ts by
--      introducing a dedicated INTERNAL_PUSH_TOKEN (held only in
--      DB Vault + function env) for the trusted DB->function path,
--      and forcing receiver_id = caller for user-JWT callers.
--   5. The notifications INSERT policy was granted to role
--      "public" (WITH CHECK true) - behaviorally proven that an
--      anonymous visitor can inject notification rows into any
--      user's inbox (and, once the trigger is live again, push
--      to any device). Now restricted to authenticated only.
--
-- No service_role key or secret value is written here. Secrets
-- live in vault.decrypted_secrets and are provisioned at deploy
-- time (never committed):
--   * notifications_edge_function_url   (non-secret edge URL)
--   * notifications_internal_push_token (secret, generated)
-- The trigger degrades gracefully (returns NEW, no push) while
-- either vault secret is absent.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Close the anonymous notification-injection hole
--    (authenticated insert stays; cross-user insert remains the
--     app's intended design, e.g. MessagesPage notifying the
--     message recipient).
-- -------------------------------------------------------------
drop policy if exists "Users can create notifications" on public.notifications;

create policy "Users can create notifications"
  on public.notifications
  for insert
  to authenticated
  with check (true);

-- -------------------------------------------------------------
-- 2. Rewrite the push trigger function.
--    * No reference to new.title (the column does not exist).
--    * Title derived from new.type.
--    * Edge URL + internal push token read from Vault.
--    * HTTP call via extensions.net.http_post (async, non-blocking).
-- -------------------------------------------------------------
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
    return new;
  end if;

  v_title := case coalesce(new.type, '')
    when 'message'          then 'New message'
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

  return new;
end;
$$;

-- -------------------------------------------------------------
-- 3. Re-attach the trigger so every notification insert enqueues
--    a push delivery via pg_net -> send-push edge function.
-- -------------------------------------------------------------
drop trigger if exists trg_notification_push on public.notifications;
create trigger trg_notification_push
  after insert on public.notifications
  for each row
  execute function public.handle_new_notification_push();

-- -------------------------------------------------------------
-- 4. RPC: reclaim a browser push endpoint for the current user.
--    Multiple accounts shared on one browser left the same
--    endpoint registered under several user_ids (observed live:
--    a single FCM endpoint under 5 users), so old users kept
--    receiving pushes on a device now used by someone else.
--    Clients call this after (re)subscribing to transfer any
--    rows for their endpoint to the current autheny.
-- -------------------------------------------------------------
create or replace function public.claim_push_subscription(p_endpoint text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null or p_endpoint is null or length(p_endpoint) = 0 then
    return 0;
  end if;

  update public.push_subscriptions
     set user_id = v_uid
   where subscription->>'endpoint' = p_endpoint
     and user_id is distinct from v_uid;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function public.claim_push_subscription(text) from public, anon;
grant execute on function public.claim_push_subscription(text) to authenticated;
grant execute on function public.claim_push_subscription(text) to service_role;

-- -------------------------------------------------------------
-- 5. Provision the non-secret edge function URL into Vault so
--    the trigger can resolve it. The matching internal push
--    token is provisioned at deploy time (never committed).
-- -------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notifications_edge_function_url') then
    perform vault.create_secret(
      'https://hrtncnmmykzckemykesu.supabase.co/functions/v1/send-push',
      'notifications_edge_function_url',
      'Edge function endpoint used by handle_new_notification_push()'
    );
  end if;
end
$$;

revoke execute on function public.handle_new_notification_push() from public, anon, authenticated;

notify pgrst, 'reload schema';