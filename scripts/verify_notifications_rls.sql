-- =============================================================
-- Deterministic verification of per-user notification isolation.
--
-- DEV-ONLY, not part of supabase/migrations, so `supabase db push` never
-- applies it. Runs entirely inside a transaction and rolls back, so it never
-- touches real data.
--
-- Usage (against a disposable/dev database, as a privileged role):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_notifications_rls.sql
--
-- It bypasses FK checks and user triggers (session_replication_role=replica)
-- so fixtures can be created without auth.users rows and without firing the
-- real push trigger. It then impersonates two authenticated users by setting
-- the PostgREST JWT claims GUCs, so `auth.uid()` and RLS behave exactly as in
-- production. Any assertion failure aborts the transaction.
-- =============================================================

begin;
set local session_replication_role = replica;

-- Fixtures owned by A and B (created while privileged, so RLS is bypassed).
insert into public.notifications (id, user_id, type, message, is_read, archived) values
  ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f1', 'general', 'A only', false, false),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2', 'general', 'B only', false, false)
on conflict (id) do nothing;

-- =========================== User A ===========================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
declare v_n int; v_msgs text;
begin
  select count(*), coalesce(string_agg(message, ',' order by message), '')
    into v_n, v_msgs
    from public.notifications;
  if v_n <> 1 then
    raise exception 'User A expected exactly 1 visible notification, saw %', v_n;
  end if;
  if v_msgs <> 'A only' then
    raise exception 'User A saw unexpected rows: %', v_msgs;
  end if;
  raise notice 'PASS: User A sees only the A notification';
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000f2';
  if v_n <> 0 then
    raise exception 'User A can read B rows (% rows)', v_n;
  end if;
  raise notice 'PASS: User A cannot SELECT B rows';
end $$;

do $$
declare v_n int;
begin
  update public.notifications set is_read = true
   where id = '00000000-0000-0000-0000-0000000000f3';
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'User A updated a B row (% rows)', v_n;
  end if;
  raise notice 'PASS: User A cannot UPDATE B rows';
end $$;

do $$
declare v_n int;
begin
  delete from public.notifications
   where id = '00000000-0000-0000-0000-0000000000f3';
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'User A deleted a B row (% rows)', v_n;
  end if;
  raise notice 'PASS: User A cannot DELETE B rows';
end $$;

reset role;

-- =========================== User B ===========================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';

do $$
declare v_n int; v_msgs text;
begin
  select count(*), coalesce(string_agg(message, ',' order by message), '')
    into v_n, v_msgs
    from public.notifications;
  if v_n <> 1 then
    raise exception 'User B expected exactly 1 visible notification, saw %', v_n;
  end if;
  if v_msgs <> 'B only' then
    raise exception 'User B saw unexpected rows: %', v_msgs;
  end if;
  raise notice 'PASS: User B sees only the B notification';
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000f1';
  if v_n <> 0 then
    raise exception 'User B can read A rows (% rows)', v_n;
  end if;
  raise notice 'PASS: User B cannot SELECT A rows';
end $$;

reset role;

-- Cross-user mutation attempts above must have left B's row untouched.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.notifications
   where id = '00000000-0000-0000-0000-0000000000f3' and is_read = false;
  if v_n <> 1 then
    raise exception 'B row was modified by a cross-user UPDATE/DELETE';
  end if;
  raise notice 'PASS: cross-user UPDATE/DELETE had no effect';
end $$;

raise notice 'verify_notifications_rls: ALL CHECKS PASSED';
rollback;
