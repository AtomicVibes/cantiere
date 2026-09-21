-- =============================================================
-- Deterministic verification for public.run_reminder_engine()
--
-- This script is DEV-ONLY and is NOT part of supabase/migrations, so it
-- is never applied by `supabase db push`. It runs entirely inside a
-- transaction and rolls back, so it never touches real data.
--
-- Usage (against a disposable/dev database):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_reminder_engine.sql
--
-- It bypasses FK checks and user triggers (session_replication_role=replica)
-- so fixtures can be created without auth.users rows and without firing the
-- real push trigger. Unique indexes (reminder idempotency) are still enforced.
-- =============================================================

begin;
set local session_replication_role = replica;

do $$
declare
  v_role   uuid;
  v_owner  uuid := '00000000-0000-0000-0000-0000000000a1';
  v_super  uuid := '00000000-0000-0000-0000-0000000000a2';
  v_recv   uuid := '00000000-0000-0000-0000-0000000000a3';
  v_sender uuid := '00000000-0000-0000-0000-0000000000a4';
  v_notif  uuid := '00000000-0000-0000-0000-0000000000a5';
  v_base   timestamptz := '2026-09-21 12:00:00+00';
  v_res    jsonb;
  v_n      integer;
begin
  select id into v_role from public.roles where name = 'super_admin' limit 1;
  if v_role is null then
    raise exception 'verify_reminder_engine: no super_admin role found';
  end if;

  insert into public.profiles (id, email, role_id, notification_retention_days) values
    (v_owner,  'owner@test.local',  null,   7),
    (v_super,  'super@test.local',  v_role, 7),
    (v_recv,   'recv@test.local',   null,   7),
    (v_sender, 'sender@test.local', null,   7),
    (v_notif,  'notif@test.local',  null,   7);

  -- Events ------------------------------------------------------
  insert into public.events (id, user_id, title, type, date, time, archived, visibility) values
    ('00000000-0000-0000-0000-0000000000e1', v_owner, 'Due Event',      'deadline',
      (v_base + interval '20 hours')::date, (v_base + interval '20 hours')::time, false, 'private'),
    ('00000000-0000-0000-0000-0000000000e2', v_owner, 'Later Event',    'deadline',
      (v_base + interval '30 hours')::date, (v_base + interval '30 hours')::time, false, 'private'),
    ('00000000-0000-0000-0000-0000000000e3', v_owner, 'Archived Event', 'deadline',
      (v_base + interval '20 hours')::date, (v_base + interval '20 hours')::time, true,  'private');

  -- Project requests -------------------------------------------
  insert into public.project_requests (id, project_name, status, created_at, archived) values
    ('00000000-0000-0000-0000-0000000000b1', 'Eligible Pending', 'pending',      v_base - interval '25 hours', false),
    ('00000000-0000-0000-0000-0000000000b2', 'Fresh Pending',    'pending',      v_base - interval '1 hour',   false),
    ('00000000-0000-0000-0000-0000000000b3', 'Already Validated','validated',    v_base - interval '25 hours', false),
    ('00000000-0000-0000-0000-0000000000b4', 'In Verification',  'verification', v_base - interval '25 hours', false);

  -- Messages ---------------------------------------------------
  insert into public.messages (id, sender_id, receiver_id, content, is_read, created_at) values
    ('00000000-0000-0000-0000-0000000000c1', v_sender, v_recv, 'older unread', false, v_base - interval '2 hours'),
    ('00000000-0000-0000-0000-0000000000c2', v_sender, v_recv, 'new unread',   false, v_base - interval '10 minutes'),
    ('00000000-0000-0000-0000-0000000000c3', v_sender, v_recv, 'already read', true,  v_base - interval '2 hours');

  -- Pre-existing notifications for the unread-notification reminder
  insert into public.notifications
    (id, user_id, type, message, is_read, archived, is_reminder, created_at) values
    ('00000000-0000-0000-0000-0000000000d1', v_notif, 'general', 'unread normal',        false, false, false, v_base - interval '2 hours'),
    ('00000000-0000-0000-0000-0000000000d2', v_notif, 'general', 'archived unread',      false, true,  false, v_base - interval '2 hours'),
    ('00000000-0000-0000-0000-0000000000d3', v_notif, 'event',   'prior reminder',       false, false, true,  v_base - interval '2 hours'),
    ('00000000-0000-0000-0000-0000000000d4', v_notif, 'general', 'already read',         true,  false, false, v_base - interval '2 hours'),
    ('00000000-0000-0000-0000-0000000000d5', v_notif, 'general', 'older than retention', true,  false, false, v_base - interval '8 days'),
    ('00000000-0000-0000-0000-0000000000d6', v_notif, 'general', 'inside retention',     true,  false, false, v_base - interval '6 days');

  -- ===== RUN 1 (baseline) =====================================
  v_res := public.run_reminder_engine(v_base);
  raise notice 'run1: %', v_res;

  if (v_res->>'event_reminders')::int <> 1 then
    raise exception 'event_reminders expected 1, got %', v_res->>'event_reminders';
  end if;
  if (v_res->>'project_request_reminders')::int <> 2 then
    raise exception 'project_request_reminders expected 2, got %', v_res->>'project_request_reminders';
  end if;
  if (v_res->>'message_reminders')::int <> 1 then
    raise exception 'message_reminders expected 1, got %', v_res->>'message_reminders';
  end if;
  if (v_res->>'notification_reminders')::int <> 1 then
    raise exception 'notification_reminders expected 1, got %', v_res->>'notification_reminders';
  end if;
  if (v_res->>'auto_archived')::int <> 1 then
    raise exception 'auto_archived expected 1, got %', v_res->>'auto_archived';
  end if;

  -- ===== RUN 2 (same instant -> idempotent) ===================
  v_res := public.run_reminder_engine(v_base);
  if (v_res->>'event_reminders')::int <> 0
     or (v_res->>'project_request_reminders')::int <> 0
     or (v_res->>'message_reminders')::int <> 0
     or (v_res->>'notification_reminders')::int <> 0
     or (v_res->>'auto_archived')::int <> 0 then
    raise exception 'run2 not idempotent: %', v_res;
  end if;

  -- ===== RUN 3 (+2h: message + notification reminders repeat) ==
  v_res := public.run_reminder_engine(v_base + interval '2 hours');
  if (v_res->>'event_reminders')::int <> 0
     or (v_res->>'project_request_reminders')::int <> 0
     or (v_res->>'message_reminders')::int <> 1
     or (v_res->>'notification_reminders')::int <> 1 then
    raise exception 'run3 unexpected: %', v_res;
  end if;

  -- ===== Read the originals -> repeating reminders stop ========
  update public.messages set is_read = true where receiver_id = v_recv;
  update public.notifications set is_read = true where id = '00000000-0000-0000-0000-0000000000d1';

  v_res := public.run_reminder_engine(v_base + interval '3 hours');
  if (v_res->>'message_reminders')::int <> 0
     or (v_res->>'notification_reminders')::int <> 0 then
    raise exception 'run4 (after read) expected 0 repeats: %', v_res;
  end if;

  -- ===== Project requests leave pending -> reminders stop ======
  update public.project_requests set status = 'validated'
   where id in ('00000000-0000-0000-0000-0000000000b1',
                '00000000-0000-0000-0000-0000000000b4');

  v_res := public.run_reminder_engine(v_base + interval '25 hours');
  if (v_res->>'project_request_reminders')::int <> 0 then
    raise exception 'project reminders should stop, got %', v_res->>'project_request_reminders';
  end if;

  -- ===== Event deadline passed -> no reminder ==================
  v_res := public.run_reminder_engine(v_base + interval '26 hours');
  if (v_res->>'event_reminders')::int <> 0 then
    raise exception 'event reminder should not fire after deadline, got %', v_res->>'event_reminders';
  end if;

  -- ===== Retention: archived stays, inside window stays active =
  select count(*) into v_n from public.notifications
   where id = '00000000-0000-0000-0000-0000000000d5' and archived = true;
  if v_n <> 1 then
    raise exception 'retention: 8-day-old active notification was not archived';
  end if;

  select count(*) into v_n from public.notifications
   where id = '00000000-0000-0000-0000-0000000000d6' and archived = false;
  if v_n <> 1 then
    raise exception 'retention: 6-day-old notification should remain active';
  end if;

  -- ===== Manual archive preserved ==============================
  select count(*) into v_n from public.notifications
   where id = '00000000-0000-0000-0000-0000000000d2' and archived = true;
  if v_n <> 1 then
    raise exception 'manual archive was altered by retention';
  end if;

  -- ===== No recursive notification-reminder chain ==============
  select count(*) into v_n from public.notifications
   where is_reminder = true and type = 'notification_reminder';
  if v_n < 1 then
    raise exception 'expected at least one notification_reminder row';
  end if;
  select count(*) into v_n from public.notifications
   where is_reminder = true and type = 'notification_reminder'
     and created_at = v_base
     and user_id = v_notif;
  if v_n > 1 then
    raise exception 'notification reminder duplicated for a single user/cycle';
  end if;

  raise notice 'verify_reminder_engine: ALL CHECKS PASSED';
end
$$;

rollback;
