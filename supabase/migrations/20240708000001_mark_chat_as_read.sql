-- Migration: Optimistic read-receipt RPC
-- Marks all unread messages from a sender as read in a single atomic call.

create or replace function public.mark_chat_as_read(
  chat_receiver_id uuid,
  chat_sender_id   uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages
  set    is_read = true
  where  sender_id   = chat_sender_id
    and  receiver_id = chat_receiver_id
    and  is_read     = false;
end;
$$;
