-- =============================================================
-- User SMS notification preference (TextBee opt-in)
--
-- Adds profiles.sms_notifications_enabled (default false: no user is
-- silently opted into SMS). The existing TextBee SMS dispatcher
-- (run_reminder_sms_dispatcher, defined in 20261001120000) is updated
-- in place to SKIP sms delivery for users who did not opt in, while
-- in-app reminders keep working normally.
--
-- Explicitly NOT changed:
--   * 20261001120000_event_reminders_sms.sql (canonical, untouched).
--   * profiles RLS: "Profiles owner manage" (FOR ALL, own row) already
--     covers reading/updating the new column; super-admin manage and
--     admin read are untouched. No new policy, no weakening.
--   * TextBee credentials stay server-side (edge function env).
--   * Reminder scheduling, frequencies, sync_event_reminder_due(),
--     in-app engine, audit triggers - untouched.
--   * No rows deleted, no data rewritten (existing rows get false,
--     i.e. current behavior preserved for everyone).
-- =============================================================

-- 1. Preference column (idempotent, data-preserving).
alter table public.profiles
  add column if not exists sms_notifications_enabled boolean default false;

update public.profiles
  set sms_notifications_enabled = false
  where sms_notifications_enabled is null;

alter table public.profiles
  alter column sms_notifications_enabled set default false;

alter table public.profiles
  alter column sms_notifications_enabled set not null;

comment on column public.profiles.sms_notifications_enabled is
  'Opt-in for TextBee SMS delivery of supported notifications (e.g. event reminders). Default false. In-app notifications are unaffected.';

-- 2. Dispatcher respects the opt-in. Users with the flag off (or null,
--    treated as off) get a 'skipped' ledger row instead of a 'queued' one;
--    users without a valid phone keep the pre-existing 'skipped' behavior.
create or replace function public.run_reminder_sms_dispatcher()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := now();
  v_queued  integer := 0;
  v_skipped integer := 0;
  r record;
  v_e164    text;
  v_sms_on  boolean;
begin
  for r in
    select
      e.id,
      e.user_id,
      e.title,
      e.reminder_frequency,
      e.reminder_next_due_at
    from public.events e
    where e.archived = false
      and e.reminder_frequency <> 'disabled'
      and e.reminder_next_due_at is not null
      and e.reminder_next_due_at <= v_now
      and (((e.date::text || 'T' || e.time::text)::timestamp) at time zone 'UTC') > v_now
    order by e.reminder_next_due_at
    limit 200
  loop
    select p.phone, p.sms_notifications_enabled into v_e164, v_sms_on
      from public.profiles p
      where p.id = r.user_id;
    v_e164 := public.normalize_phone_e164(v_e164);
    if v_e164 is null or v_sms_on is not true then
      insert into public.reminder_sms_deliveries
        (event_id, user_id, frequency, to_phone, message, status)
      values
        (r.id, r.user_id, r.reminder_frequency, null,
         'Reminder: ' || r.title, 'skipped')
      on conflict (event_id, user_id, frequency) do nothing;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.reminder_sms_deliveries
      (event_id, user_id, frequency, to_phone, message, status)
    values
      (r.id, r.user_id, r.reminder_frequency, v_e164,
       'Reminder: ' || r.title, 'queued')
    on conflict (event_id, user_id, frequency) do nothing;
    v_queued := v_queued + 1;
  end loop;

  return v_queued || ' queued, ' || v_skipped || ' skipped';
end;
$$;

revoke all on function public.run_reminder_sms_dispatcher() from public;
grant execute on function public.run_reminder_sms_dispatcher() to service_role;

notify pgrst, 'reload schema';
