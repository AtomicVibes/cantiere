-- =============================================================
-- Push delivery log (per-subscription send outcomes)
--
-- send-push records one row per delivery attempt so failures can be
-- diagnosed without guessing: sent / failed / skipped with the provider
-- status/error category. No credentials, no message bodies beyond the
-- notification reference.
--
-- Explicitly NOT changed:
--   * push_subscriptions schema, RLS, unique constraint - untouched.
--   * notifications table, triggers, reminder engine, SMS dispatcher,
--     20261001120000_event_reminders_sms.sql - untouched.
--   * No rows deleted, no data rewritten.
-- =============================================================

create table if not exists public.push_delivery_log (
  id              uuid not null default gen_random_uuid(),
  notification_id uuid null references public.notifications(id) on delete set null,
  user_id         uuid null references public.profiles(id) on delete set null,
  subscription_id uuid null references public.push_subscriptions(id) on delete set null,
  status          text not null check (status in ('sent','failed','skipped','stale_removed')),
  error           text null,
  created_at      timestamptz not null default now(),
  constraint push_delivery_log_pkey primary key (id)
);

create index if not exists push_delivery_log_notification_idx
  on public.push_delivery_log (notification_id);
create index if not exists push_delivery_log_user_created_idx
  on public.push_delivery_log (user_id, created_at desc);

alter table public.push_delivery_log enable row level security;

-- Service role (edge function writer) bypasses RLS; keep an explicit
-- self-read policy so users can inspect their own delivery history.
drop policy if exists "Users can read own push delivery log" on public.push_delivery_log;
create policy "Users can read own push delivery log"
  on public.push_delivery_log
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.push_delivery_log from anon;

notify pgrst, 'reload schema';
