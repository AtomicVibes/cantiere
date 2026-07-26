-- Soft-delete (hidden_conversations) + hard-delete (delete_conversation RPC) support

-- ============================================================
-- 1. hidden_conversations table for regular-user soft deletes
-- ============================================================
create table if not exists public.hidden_conversations (
  id            uuid        not null default gen_random_uuid(),
  user_id       uuid        not null references public.profiles(id) on delete cascade,
  other_user_id uuid        not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint hidden_conversations_pkey primary key (id),
  constraint hidden_conversations_unique unique (user_id, other_user_id)
);

alter table public.hidden_conversations enable row level security;

create policy "Users can manage own hidden conversations"
  on public.hidden_conversations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 2. delete_conversation RPC for super-admin hard deletes
-- ============================================================
create or replace function public.delete_conversation(
  current_user_id uuid,
  peer_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.messages
  where (sender_id = current_user_id and receiver_id = peer_id)
     or (sender_id = peer_id and receiver_id = current_user_id);
end;
$$;
