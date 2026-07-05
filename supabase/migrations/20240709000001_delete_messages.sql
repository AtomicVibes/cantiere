-- Migration: Delete message RPCs for Optimistic UI
-- Provides atomic delete operations with sender ownership checks.

-- Deletes a single message by ID, only if the caller is the sender.
create or replace function public.delete_single_message(
  msg_id   uuid,
  user_id  uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.messages
  where  id        = msg_id
    and  sender_id = user_id;
end;
$$;

-- Deletes all messages sent by the caller to a specific peer.
create or replace function public.clear_conversation(
  chat_receiver_id uuid,
  chat_sender_id   uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.messages
  where  sender_id   = chat_sender_id
    and  receiver_id = chat_receiver_id;
end;
$$;
