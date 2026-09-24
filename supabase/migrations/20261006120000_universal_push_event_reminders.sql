-- =============================================================
-- Universal push: event reminders for ALL frequencies + push opt-in
--
-- 1) profiles.push_notifications_enabled (default true: preserves the
--    current behavior where every notification attempts push; users can
--    explicitly opt out per account). Covered by the existing
--    "Profiles owner manage" RLS (own row) - no new policy, no weakening.
--    send-push (edge function) checks the flag and logs 'skipped' when
--    off; in-app and SMS are unaffected.
--
-- 2) run_reminder_engine() 4.1 replaced: previously only events inside
--    a ~24h window produced in-app notifications (and therefore push),
--    so 30_minutes / 1_hour / weekly / monthly / custom reminders only
--    ever reached SMS. Now ALL frequencies emit one in-app notification
--    per (event, frequency) when reminder_next_due_at is reached - the
--    SAME scheduling the SMS dispatcher uses - so in-app, push and SMS
--    stay consistent. 'disabled' never notifies. Idempotent via a new
--    event_reminder_v2 key (old event_deadline_v1 rows are untouched).
--    Sections 4.2-4.5 are byte-identical to 20260923000000.
--
-- Explicitly NOT changed:
--   * 20261001120000_event_reminders_sms.sql (canonical, untouched).
--   * Reminder scheduling itself (sync_event_reminder_due,
--     reminder_next_due_at computation, frequencies) - untouched.
--   * profiles RLS, audit triggers, notification table - untouched.
--   * No rows deleted, no history rewritten.
-- =============================================================

-- 1. Push opt-in column (idempotent, data-preserving: existing rows
--    keep today's behavior by defaulting to true).
alter table public.profiles
  add column if not exists push_notifications_enabled boolean default true;

update public.profiles
  set push_notifications_enabled = true
  where push_notifications_enabled is null;

alter table public.profiles
  alter column push_notifications_enabled set default true;

alter table public.profiles
  alter column push_notifications_enabled set not null;

comment on column public.profiles.push_notifications_enabled is
  'Account-level opt-in for Web Push delivery of notifications. Default true. In-app notifications and SMS are unaffected.';

-- 2. Unified engine (4.1 replaced, 4.2-4.5 identical).
create or replace function public.run_reminder_engine(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now_ts                 timestamp;
  v_now_bucket             text;
  v_now_day                text;
  v_event_reminders        integer := 0;
  v_request_reminders      integer := 0;
  v_message_reminders      integer := 0;
  v_notification_reminders integer := 0;
  v_auto_archived          integer := 0;
begin
  -- Deadlines are stored as timezone-less date + time; compare against the
  -- database wall clock (UTC) so the hourly cadence stays deterministic.
  v_now_ts     := p_now at time zone 'UTC';
  v_now_bucket := to_char(v_now_ts, 'YYYYMMDDHH24');
  v_now_day    := to_char(v_now_ts, 'YYYY-MM-DD');

  -- -----------------------------------------------------------
  -- -----------------------------------------------------------
  -- 4.1 EVENT REMINDERS (all frequencies, unified)
  --     Fires once per (event, frequency) on the first hourly run that
  --     sees reminder_next_due_at reached while the event is still in
  --     the future. Covers 30_minutes, 1_hour, 24_hours, weekly,
  --     monthly and custom through the SAME scheduling the SMS
  --     dispatcher uses, so in-app, push and SMS stay consistent.
  --     'disabled' never notifies. Idempotent via reminder_key.
  --     Recipient: the event owner. Archived events are excluded.
  -- -----------------------------------------------------------
  insert into public.notifications
    (user_id, type, message, url, is_read, archived, is_reminder, reminder_key, created_at)
  select
    e.user_id,
    'event',
    case e.reminder_frequency
      when '30_minutes' then 'Reminder: ' || e.title || ' starts in 30 minutes.'
      when '1_hour'     then 'Reminder: ' || e.title || ' starts in 1 hour.'
      when '24_hours'   then 'Reminder: ' || e.title || ' is due tomorrow at ' || to_char(e.time, 'HH24:MI') || '.'
      when 'weekly'     then 'Reminder: ' || e.title || ' starts in one week.'
      when 'monthly'    then 'Reminder: ' || e.title || ' starts in one month.'
      when 'custom'     then 'Reminder: ' || e.title || ' starts in ' || e.reminder_interval_value || ' ' || e.reminder_interval_unit || '.'
      else 'Reminder: ' || e.title || '.'
    end,
    '/calendar',
    false, false, true,
    'event_reminder_v2:' || e.id::text || ':' || e.reminder_frequency,
    p_now
  from public.events e
  where e.archived = false
    and e.user_id is not null
    and e.reminder_frequency in ('30_minutes','1_hour','24_hours','weekly','monthly','custom')
    and e.reminder_next_due_at is not null
    and e.reminder_next_due_at <= p_now
    and e.date is not null
    and e.time is not null
    and (e.date + e.time) > v_now_ts
  on conflict (reminder_key) where reminder_key is not null do nothing;
  get diagnostics v_event_reminders = row_count;

  -- -----------------------------------------------------------
  -- 4.2 NON-VERIFIED PROJECT REQUEST REMINDERS
  --     "Non-verified" = status in ('pending','verification') per the
  --     existing review-project-request workflow (validated/rejected end
  --     it). Recipients: super admins (same audience as the producer),
  --     routed to Request Management by the centralized resolver.
  --     One reminder per recipient per day, starting after 24h.
  -- -----------------------------------------------------------
  insert into public.notifications
    (user_id, type, message, url, is_read, archived, is_reminder, reminder_key, created_at)
  select
    sa.id,
    'project_request',
    'Reminder: project request "' || pr.project_name || '" is still awaiting verification.',
    '/requests?view=management',
    false, false, true,
    'project_request_v1:' || pr.id::text || ':' || sa.id::text || ':' || v_now_day,
    p_now
  from public.project_requests pr
  cross join public.profiles sa
  join public.roles r on r.id = sa.role_id
  where r.name = 'super_admin'
    and pr.status in ('pending', 'verification')
    and coalesce(pr.archived, false) = false
    and pr.created_at <= p_now - interval '24 hours'
    and not exists (
      select 1
      from public.notifications prev
      where prev.is_reminder = true
        and prev.user_id = sa.id
        and prev.created_at > p_now - interval '24 hours'
        and prev.reminder_key like 'project\_request\_v1:%' escape '\'
    )
  on conflict (reminder_key) where reminder_key is not null do nothing;
  get diagnostics v_request_reminders = row_count;

  -- -----------------------------------------------------------
  -- 4.3 UNREAD MESSAGE REMINDERS
  --     One reminder per unread conversation, at most once per hour,
  --     only after the newest eligible message is at least one hour old.
  --     Stops automatically once the receiver reads (is_read) or the
  --     messages are deleted. Deep-links to the conversation.
  -- -----------------------------------------------------------
  insert into public.notifications
    (user_id, type, message, url, is_read, archived, is_reminder, reminder_key, created_at)
  select
    m.receiver_id,
    'message',
    'Reminder: you have ' || count(*) || ' unread message'
      || case when count(*) > 1 then 's' else '' end
      || ' from ' || coalesce(p.full_name, p.email, 'a colleague') || '.',
    '/messages?user=' || m.sender_id::text,
    false, false, true,
    'message_unread_v1:' || m.receiver_id::text || ':' || m.sender_id::text || ':' || v_now_bucket,
    p_now
  from public.messages m
  left join public.profiles p on p.id = m.sender_id
  where m.is_read is not true
    and m.created_at <= p_now - interval '1 hour'
    and not exists (
      select 1
      from public.notifications prev
      where prev.is_reminder = true
        and prev.user_id = m.receiver_id
        and prev.created_at > p_now - interval '1 hour'
        and prev.reminder_key like 'message\_unread\_v1:%' escape '\'
    )
  group by m.receiver_id, m.sender_id, p.full_name, p.email
  on conflict (reminder_key) where reminder_key is not null do nothing;
  get diagnostics v_message_reminders = row_count;

  -- -----------------------------------------------------------
  -- 4.4 UNREAD NOTIFICATION REMINDERS
  --     At most once per hour per user. Excludes reminder rows
  --     (is_reminder) to prevent recursive reminder chains and excludes
  --     archived rows. Stops once the originals are read.
  -- -----------------------------------------------------------
  insert into public.notifications
    (user_id, type, message, url, is_read, archived, is_reminder, reminder_key, created_at)
  select
    n.user_id,
    'notification_reminder',
    'Reminder: you have ' || count(*) || ' unread notification'
      || case when count(*) > 1 then 's' else '' end || '.',
    '/notifications',
    false, false, true,
    'notification_unread_v1:' || n.user_id::text || ':' || v_now_bucket,
    p_now
  from public.notifications n
  where n.user_id is not null
    and n.archived = false
    and n.is_read is not true
    and n.is_reminder = false
    and n.created_at <= p_now - interval '1 hour'
    and not exists (
      select 1
      from public.notifications prev
      where prev.is_reminder = true
        and prev.user_id = n.user_id
        and prev.created_at > p_now - interval '1 hour'
        and prev.reminder_key like 'notification\_unread\_v1:%' escape '\'
    )
  group by n.user_id
  on conflict (reminder_key) where reminder_key is not null do nothing;
  get diagnostics v_notification_reminders = row_count;

  -- -----------------------------------------------------------
  -- 4.5 AUTOMATIC ARCHIVAL BY RETENTION
  --     Archives (never deletes) active notifications older than the
  --     owner's selected retention. Manual archive is already archived,
  --     so it is untouched.
  -- -----------------------------------------------------------
  update public.notifications n
     set archived = true
    from public.profiles p
   where p.id = n.user_id
     and n.archived = false
     and n.created_at < p_now - make_interval(days => p.notification_retention_days);
  get diagnostics v_auto_archived = row_count;

  return jsonb_build_object(
    'ran_at',                   p_now,
    'event_reminders',          v_event_reminders,
    'project_request_reminders', v_request_reminders,
    'message_reminders',        v_message_reminders,
    'notification_reminders',   v_notification_reminders,
    'auto_archived',            v_auto_archived
  );
end;
$$;

revoke all on function public.run_reminder_engine(timestamptz) from public;
grant execute on function public.run_reminder_engine(timestamptz) to service_role;

notify pgrst, 'reload schema';