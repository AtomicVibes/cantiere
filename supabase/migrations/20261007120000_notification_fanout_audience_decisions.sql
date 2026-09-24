-- =============================================================
-- Notification fan-out: audience shares + request decisions
--
-- Problem (push audit): several legitimate recipient notifications were
-- never created, so Push could never fire for them even though the
-- delivery pipeline (notifications insert -> trg_notification_push ->
-- send-push) was healthy:
--   * event selected-audience members got no notification on share,
--   * document selected-audience members got no notification on share,
--   * project requesters got no notification on verify/approve/reject.
--
-- Fix: three AFTER-row triggers that insert the recipient notification.
-- Every insert then flows through the EXISTING central pipeline
-- (in-app + push + unchanged SMS independence). No frontend changes,
-- no RLS changes, no visibility/authorization changes.
--
-- Safety (failure isolation is load-bearing here):
--   * Each function skips self-notifications and null recipients.
--   * Each insert is wrapped in its own EXCEPTION block that only
--     RAISEs LOG: a notification failure can NEVER roll back the
--     business operation (share / status change).
--   * Audience tables have (document_id/event_id, user_id) uniqueness,
--     so one share yields exactly one notification (no duplicates).
--   * Request decisions fire only on a real status change
--     (OLD IS DISTINCT FROM NEW), once per transition.
--   * Triggers fire on future writes only; existing rows are untouched.
--
-- Explicitly NOT changed:
--   * 20261001120000_event_reminders_sms.sql (canonical, untouched).
--   * Visibility values/RLS/audience authorization - untouched.
--   * notifications RLS, push subscriptions, profiles - untouched.
--   * No rows deleted, no history rewritten.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. Event audience shares -> notify the added member.
-- ---------------------------------------------------------------
create or replace function public.notify_event_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_owner uuid;
begin
  begin
    select e.title, e.user_id into v_title, v_owner
      from public.events e
     where e.id = new.event_id;
    if new.user_id is null or new.user_id = v_owner then
      return new;
    end if;
    insert into public.notifications (user_id, type, message, url, is_read, archived)
    values (
      new.user_id,
      'event',
      'You were added to the event "' || coalesce(v_title, 'Untitled event') || '".',
      '/calendar',
      false,
      false
    );
  exception when others then
    raise log 'notify_event_audience failed for event %, user %: %', new.event_id, new.user_id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_notify_event_audience on public.event_audience;
create trigger trg_notify_event_audience
  after insert on public.event_audience
  for each row execute function public.notify_event_audience();

-- ---------------------------------------------------------------
-- 2. Document audience shares -> notify the added member.
-- ---------------------------------------------------------------
create or replace function public.notify_document_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_owner uuid;
begin
  begin
    select d.file_name, d.user_id into v_name, v_owner
      from public.documents d
     where d.id = new.document_id;
    if new.user_id is null or new.user_id = v_owner then
      return new;
    end if;
    insert into public.notifications (user_id, type, message, url, is_read, archived)
    values (
      new.user_id,
      'document',
      'The document "' || coalesce(v_name, 'Untitled document') || '" was shared with you.',
      '/documents',
      false,
      false
    );
  exception when others then
    raise log 'notify_document_audience failed for document %, user %: %', new.document_id, new.user_id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_notify_document_audience on public.document_audience;
create trigger trg_notify_document_audience
  after insert on public.document_audience
  for each row execute function public.notify_document_audience();

-- ---------------------------------------------------------------
-- 3. Request decisions -> notify the requester (clients.profile_id).
-- ---------------------------------------------------------------
create or replace function public.notify_request_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_message    text;
begin
  begin
    if old.status is not distinct from new.status then
      return new;
    end if;
    if new.status not in ('verification', 'validated', 'rejected') then
      return new;
    end if;
    select c.profile_id into v_profile_id
      from public.clients c
     where c.id = new.client_id;
    if v_profile_id is null then
      return new;
    end if;
    v_message := case new.status
      when 'verification' then 'Your project request "' || coalesce(new.project_name, '') || '" is under verification.'
      when 'validated'    then 'Your project request "' || coalesce(new.project_name, '') || '" was approved.'
      when 'rejected'     then 'Your project request "' || coalesce(new.project_name, '') || '" was rejected.'
      else 'Your project request "' || coalesce(new.project_name, '') || '" was updated.'
    end;
    insert into public.notifications (user_id, type, message, url, is_read, archived)
    values (
      v_profile_id,
      'project_request',
      v_message,
      '/requests',
      false,
      false
    );
  exception when others then
    raise log 'notify_request_decision failed for request %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_notify_request_decision on public.project_requests;
create trigger trg_notify_request_decision
  after update of status on public.project_requests
  for each row execute function public.notify_request_decision();

revoke execute on function public.notify_event_audience() from public, anon, authenticated;
revoke execute on function public.notify_document_audience() from public, anon, authenticated;
revoke execute on function public.notify_request_decision() from public, anon, authenticated;

notify pgrst, 'reload schema';
