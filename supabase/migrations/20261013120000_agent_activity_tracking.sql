-- =============================================================
-- Agent activity tracking: sessions + action telemetry.
--
-- agent_sessions: one row per sign-in (login timestamp, logout
-- timestamp, periodic heartbeat, active flag).
-- agent_action_logs: fire-and-forget per-action rows (project views,
-- document views, invoice checks) linked to session + profile.
--
-- Strictly ADDITIVE: new tables only, FKs with ON DELETE CASCADE,
-- RLS owner-manage (mirrors push_subscriptions) + service_role read.
-- No existing table, policy, trigger or function is touched.
-- =============================================================

create table if not exists public.agent_sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  login_at timestamptz not null default now(),
  logout_at timestamptz null,
  last_heartbeat_at timestamptz not null default now(),
  is_active boolean not null default true,
  user_agent text null,
  constraint agent_sessions_pkey primary key (id)
);

create index if not exists agent_sessions_user_idx
  on public.agent_sessions (user_id);
create index if not exists agent_sessions_active_idx
  on public.agent_sessions (user_id)
  where is_active = true;

create table if not exists public.agent_action_logs (
  id uuid not null default gen_random_uuid(),
  session_id uuid null references public.agent_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  entity_type text null,
  entity_id uuid null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint agent_action_logs_pkey primary key (id)
);

create index if not exists agent_action_logs_user_idx
  on public.agent_action_logs (user_id);
create index if not exists agent_action_logs_session_idx
  on public.agent_action_logs (session_id);
create index if not exists agent_action_logs_created_idx
  on public.agent_action_logs (created_at desc);

alter table public.agent_sessions enable row level security;
alter table public.agent_action_logs enable row level security;

drop policy if exists "Users manage own agent sessions" on public.agent_sessions;
create policy "Users manage own agent sessions"
  on public.agent_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role reads agent sessions" on public.agent_sessions;
create policy "Service role reads agent sessions"
  on public.agent_sessions for select
  to service_role
  using (true);

drop policy if exists "Users manage own agent action logs" on public.agent_action_logs;
create policy "Users manage own agent action logs"
  on public.agent_action_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role reads agent action logs" on public.agent_action_logs;
create policy "Service role reads agent action logs"
  on public.agent_action_logs for select
  to service_role
  using (true);

revoke all on public.agent_sessions from anon;
revoke all on public.agent_action_logs from anon;

notify pgrst, 'reload schema';
