-- =============================================================================
-- 20261001120000_event_reminders_sms.sql
-- Event reminders + TextBee SMS delivery.
--
-- DESIGN (reuse, do not second-system):
--   * The in-app reminder engine ALREADY exists (run_reminder_engine, hourly
--     pg_cron job "geometra-reminder-engine", idempotent via reminder_key,
--     centralized notes + write_audit_log, RLS). We do NOT build a second
--     engine or a second notifications table -- that is the exact 'second
--     system' the architecture forbids.
--   * This migration ONLY ADDS; nothing existing is dropped or recreated:
--       (a) per-event, user-configurable reminder lead config on events
--           (frequency + optional custom interval), default = 24 hours
--           (identical to current behavior out of the box),
--       (b) an outbound SMS deliverable ledger (reminder_sms_deliveries)
--           with DB-level idempotency (unique per event/recipient/frequency)
--           so a repeated scheduler invocation can never double-send,
--       (c) SECURITY DEFINER reminder/SMS functions reused by the SAME hourly
--           pg_cron cadence,
--       (d) RLS so a delivery row is only visible to its recipient (plus
--           super admins); writes only via the DEFINER path,
--       (e) an audit trail through the existing write_audit_log().
--   * SMS is BEST-EFFORT and independent: a failure or missing phone never
--     breaks the in-app reminder. status is only ever 'sent' when the TextBee
--     API actually confirms delivery; otherwise queued/failed/skipped. No
--     fabricated delivery is ever claimed.
--   * No credentials in this file. The TextBee API key stays server-side in
--     the edge function env (TEXTBEE_API_KEY), never in the browser, never in
--     SQL, never in Git.
-- =============================================================================

set search_path = '';

-- ---------------------------------------------------------------------------
-- 1. Per-event reminder configuration (owner-editable, DB-checked).
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists reminder_frequency           text not null default '24_hours',
  add column if not exists reminder_interval_value      integer,
  add column if not exists reminder_interval_unit       text,
  add column if not exists reminder_interval_label      text,
  add column if not exists reminder_next_due_at         timestamptz;

alter table public.events
  drop constraint if exists events_reminder_frequency_check;
alter table public.events
  add constraint events_reminder_frequency_check check (
    reminder_frequency in
      ('disabled','30_minutes','1_hour','24_hours','weekly','monthly','custom')
    and (
      (reminder_frequency = 'custom'
       and reminder_interval_value is not null and reminder_interval_value > 0
       and reminder_interval_unit in ('minutes','hours','days','weeks'))
      or
      (reminder_frequency <> 'custom'
       and reminder_interval_value is null and reminder_interval_unit is null)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Outbound SMS ledger (idempotent per event/recipient/frequency).
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_sms_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events(id) on delete cascade,
  user_id              uuid not null references public.profiles(id) on delete cascade,
  frequency            text not null,
  to_phone             text,
  message              text not null,
  status               text not null default 'queued'
    check (status in ('queued','dispatched','sent','failed','skipped','disabled')),
  provider_message_id  text,
  error_message        text,
  attempt_count        integer not null default 0,
  last_attempt_at      timestamptz,
  sent_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint reminder_sms_deliveries_key_uidx unique (event_id, user_id, frequency)
);

comment on column public.reminder_sms_deliveries.status is
  'queued = due, not yet handed to the edge fn; dispatched = handed to '
  'send-sms; sent = TextBee accepted (provider_message_id set) -- the ONLY '
  'source of truth for "sent"; failed = provider/transient error, retryable; '
  'skipped = no valid E.164 phone, never faked as sent; disabled = frequency '
  'set to disabled before dispatch.';

create index if not exists reminder_sms_deliveries_due_idx
  on public.reminder_sms_deliveries (event_id, status)
  where status in ('queued','dispatched','failed');

-- ---------------------------------------------------------------------------
-- 3. E.164 phone normalization (Tunisia / +216). Pure helper shared by the
--    dispatcher; returns NULL when unparseable (those rows are skipped).
-- ---------------------------------------------------------------------------
create or replace function public.normalize_phone_e164(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v text;
begin
  if p_phone is null or trim(p_phone) = '' then
    return null;
  end if;
  v := regexp_replace(trim(p_phone), '[^0-9+]', '', 'g');
  if v ~ '^\+[1-9][0-9]{6,14}$' then
    return v;
  end if;
  if v ~ '^00[1-9][0-9]{6,14}$' then
    return '+' || substr(v, 3);
  end if;
  if v ~ '^0[2-9][0-9]{8}$' then
    return '+216' || substr(v, 2);
  end if;
  if v ~ '^[2-9][0-9]{7}$' then
    return '+216' || v;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Lead-time resolution (preset or custom) -> interval.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_reminder_lead(
  p_frequency text,
  p_value     integer,
  p_unit      text
)
returns interval
language plpgsql
immutable
set search_path = ''
as $$
begin
  case p_frequency
    when '30_minutes' then return interval '30 minutes';
    when '1_hour'     then return interval '1 hour';
    when '24_hours'   then return interval '24 hours';
    when 'weekly'     then return interval '7 days';
    when 'monthly'    then return interval '30 days';
    when 'custom'     then
      return case p_unit
        when 'minutes' then make_interval(mins => p_value)
        when 'hours'   then make_interval(hours => p_value)
        when 'days'    then make_interval(days => p_value)
        when 'weeks'   then make_interval(weeks => p_value)
        else interval '24 hours'
      end;
    else return null; -- disabled / unknown
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Due-instant computation. Event moment is date + time (timezone-less,
--    treated as UTC to match the existing engine); due = moment - lead.
-- ---------------------------------------------------------------------------
create or replace function public.compute_event_reminder_next_due(
  p_frequency text,
  p_value     integer,
  p_unit      text,
  p_date      date,
  p_time      text
)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare v_lead interval;
begin
  v_lead := public.resolve_reminder_lead(p_frequency, p_value, p_unit);
  if v_lead is null or p_date is null or p_time is null then
    return null;
  end if;
  return ((((p_date::text || 'T' || p_time::text)::timestamp) at time zone 'UTC') - v_lead);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Keep reminder_next_due_at in sync on config/date/time change.
-- ---------------------------------------------------------------------------
create or replace function public.sync_event_reminder_due()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reminder_frequency = 'disabled' or new.archived then
    new.reminder_next_due_at := null;
    return new;
  end if;
  new.reminder_next_due_at := public.compute_event_reminder_next_due(
    new.reminder_frequency, new.reminder_interval_value,
    new.reminder_interval_unit, new.date, new.time::text
  );
  return new;
end;
$$;

drop trigger if exists trg_events_sync_reminder_due on public.events;
create trigger trg_events_sync_reminder_due
  before insert or update of
    reminder_frequency, reminder_interval_value, reminder_interval_unit,
    date, time, archived
  on public.events
  for each row execute function public.sync_event_reminder_due();

-- Backfill: existing events default to the SAME 24h behavior they have today.
update public.events e
set reminder_next_due_at =
  ((((e.date::text || 'T' || e.time::text)::timestamp) at time zone 'UTC')
   - interval '24 hours')
where e.archived = false
  and e.reminder_frequency = '24_hours'
  and e.reminder_next_due_at is null
  and e.date is not null
  and e.time is not null;

-- ---------------------------------------------------------------------------
-- 7. updated_at bookkeeping + audit through the existing write_audit_log().
-- ---------------------------------------------------------------------------
create or replace function public.set_reminder_delivery_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_reminder_delivery_updated_at on public.reminder_sms_deliveries;
create trigger trg_reminder_delivery_updated_at
  before update on public.reminder_sms_deliveries
  for each row execute function public.set_reminder_delivery_updated_at();

create or replace function public.log_reminder_delivery_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    perform public.write_audit_log(
      p_action        := 'reminder_sms_' || new.status,
      p_entity_type   := 'event_reminder',
      p_entity_id     := new.event_id::text,
      p_entity_user_id := new.user_id,
      p_message       := case
        when new.status = 'sent'
             then case when new.provider_message_id is not null
                       then 'SMS accepted by TextBee (' ||
                            new.provider_message_id || ')' else 'SMS accepted by TextBee' end
        when new.status = 'skipped' then 'SMS skipped (no valid E.164 phone)'
        when new.status = 'failed'  then 'SMS failed: ' || coalesce(new.error_message, 'unknown')
        else 'SMS reminder queued' end
    );
  end if;
  return null;
end;
$$;

drop trigger if exists trg_reminder_delivery_audit on public.reminder_sms_deliveries;
create trigger trg_reminder_delivery_audit
  after insert or update on public.reminder_sms_deliveries
  for each row execute function public.log_reminder_delivery_audit();

-- ---------------------------------------------------------------------------
-- 8. RLS: delivery visible only to its recipient (or super admins); writes
--    only through the SECURITY DEFINER path.
-- ---------------------------------------------------------------------------
alter table public.reminder_sms_deliveries enable row level security;

drop policy if exists "Users can view their own SMS deliveries" on public.reminder_sms_deliveries;
create policy "Users can view their own SMS deliveries"
  on public.reminder_sms_deliveries
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
  );

grant select on public.reminder_sms_deliveries to authenticated;
grant select on public.reminder_sms_deliveries to service_role;
revoke all on public.reminder_sms_deliveries from anon, public;

-- ---------------------------------------------------------------------------
-- 9. Hourly SMS dispatcher. SECURITY DEFINER, called by pg_cron on the SAME
--    cadence as the in-app engine. Idempotent: ON CONFLICT DO NOTHING by
--    (event, recipient, frequency). NEVER claims a send -- rows go 'queued'
--    and the send-sms edge function performs the actual TextBee call.
-- ---------------------------------------------------------------------------
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
    select p.phone into v_e164
      from public.profiles p
      where p.id = r.user_id;
    v_e164 := public.normalize_phone_e164(v_e164);
    if v_e164 is null then
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

-- ---------------------------------------------------------------------------
-- 10. pg_cron: schedule on the same hourly cadence as the in-app engine.
--     Idempotent job name; pg_cron absence is a logged warning, never a
--     deploy failure.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise log 'event sms: pg_cron unavailable (%)', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      if exists (select 1 from cron.job where jobname = 'geometra-reminder-sms') then
        perform cron.unschedule('geometra-reminder-sms');
      end if;
      perform cron.schedule(
        'geometra-reminder-sms',
        '5 * * * *',
        'select public.run_reminder_sms_dispatcher();'
      );
    exception when others then
      raise log 'event sms: could not schedule pg_cron job (%)', sqlerrm;
    end;
  end if;
end
$$;

notify pgrst, 'reload schema';