-- Migration: Push notification infrastructure
-- 1. push_subscriptions table for device tokens
-- 2. pg_net trigger on notifications table to call edge function

-- Enable pg_net extension for async HTTP requests
create extension if not exists pg_net with schema extensions;

-- ============================================================
-- 1. push_subscriptions table
-- ============================================================
create table if not exists public.push_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_pkey primary key (id),
  constraint push_subscriptions_user_subscription_unique unique (user_id, subscription)
);

-- Index for fast lookups by user_id
create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

-- Enable Row Level Security
alter table public.push_subscriptions enable row level security;

-- Users can read/write only their own subscriptions
create policy "Users can manage their own push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service role can read all (used by edge function)
create policy "Service role can read all subscriptions"
  on public.push_subscriptions
  for select
  to service_role
  using (true);

-- ============================================================
-- 2. Trigger function: call send-push edge function on INSERT
-- ============================================================
create or replace function public.handle_new_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  edge_function_url text;
  service_role_key text;
  payload text;
begin
  -- Read settings configured via `supabase secrets set` or ALTER DATABASE
  edge_function_url := nullif(current_setting('app.settings.edge_function_url', true), '');
  service_role_key  := nullif(current_setting('app.settings.service_role_key', true), '');

  if edge_function_url is null or service_role_key is null then
    return new;
  end if;

  payload := jsonb_build_object(
    'title',          new.title,
    'body',           new.message,
    'receiver_id',    new.user_id,
    'type',           new.type,
    'url',            new.url,
    'notification_id', new.id
  )::text;

  perform net.http_post(
    url     := edge_function_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body    := payload
  );

  return new;
end;
$$;

-- Attach trigger to existing notifications table
drop trigger if exists trg_notification_push on public.notifications;
create trigger trg_notification_push
  after insert on public.notifications
  for each row
  execute function public.handle_new_notification_push();
