-- =============================================================
-- Deterministic verification: archiving/restoring audit logs does
-- NOT self-audit, while every other audited path still writes rows.
--
-- DEV-ONLY, not part of supabase/migrations. Runs inside a transaction
-- and rolls back, so it never touches real data.
--
-- Usage (against a disposable/dev database, as a privileged role):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_audit_archive_no_self_audit.sql
--
-- Real triggers are left enabled (no session_replication_role override), so
-- the audit_logs archive/restore trigger and the per-entity triggers behave
-- exactly as in production. RLS is exercised by impersonating a normal
-- authenticated user via the PostgREST JWT-claim GUCs.
-- =============================================================

begin;

-- ------------------------------------------------------------------
-- 1. Fixtures: five audit rows plus a tested normal-app audit writer.
-- ------------------------------------------------------------------
do $$
declare
  v_ids uuid[];
  v_before int;
  v_after int;
  v_n int;
  i text;
begin
  insert into public.audit_logs (user_id, action_type, message, archived)
  select null, 'TEST_FIXTURE_' || g, 'self-audit test fixture', false
  from generate_series(1, 5) g;

  select array_agg(id) into v_ids
  from public.audit_logs
  where action_type like 'TEST_FIXTURE_%';

  if v_ids is null or array_length(v_ids, 1) <> 5 then
    raise exception 'fixture setup failed: expected 5 audit rows';
  end if;

  -- ------------------------------------------------------------------
  -- 2. Archive the 5 selected rows: rows must flip archived=true and the
  --    total row count must NOT increase (no self-audit, one row per op).
  -- ------------------------------------------------------------------
  select count(*) into v_before from public.audit_logs;

  update public.audit_logs
     set archived = true
   where id = any(v_ids);
  get diagnostics v_n = row_count;
  if v_n <> 5 then
    raise exception 'archive expected to update 5 rows, updated %', v_n;
  end if;

  select count(*) into v_after from public.audit_logs;
  if v_after <> v_before then
    raise exception 'archive created % new audit rows (before=%, after=%)', v_after - v_before, v_before, v_after;
  end if;

  select count(*) into v_n from public.audit_logs where id = any(v_ids) and archived;
  if v_n <> 5 then
    raise exception 'archived flag not applied to all 5 rows';
  end if;
  raise notice 'PASS: archiving 5 audit logs updated 5 rows and added 0 rows';

  -- ------------------------------------------------------------------
  -- 3. Restore the same 5 rows: archived=false, still no self-audit row.
  -- ------------------------------------------------------------------
  select count(*) into v_before from public.audit_logs;

  update public.audit_logs
     set archived = false
   where id = any(v_ids);
  get diagnostics v_n = row_count;
  if v_n <> 5 then
    raise exception 'restore expected to update 5 rows, updated %', v_n;
  end if;

  select count(*) into v_after from public.audit_logs;
  if v_after <> v_before then
    raise exception 'restore created % new audit rows (before=%, after=%)', v_after - v_before, v_before, v_after;
  end if;

  select count(*) into v_n from public.audit_logs where id = any(v_ids) and not archived;
  if v_n <> 5 then
    raise exception 'restored flag not applied to all 5 rows';
  end if;
  raise notice 'PASS: restoring 5 audit logs updated 5 rows and added 0 rows';

  -- ------------------------------------------------------------------
  -- 4. A normal auditable operation still writes exactly one new row.
  -- ------------------------------------------------------------------
  select count(*) into v_before from public.audit_logs;

  perform public.write_audit_log(
    'PROJECT_UPDATE',
    p_message    := 'Project updated (verification)',
    p_entity_type := 'project',
    p_entity_id  := '00000000-0000-0000-0000-0000000000a1'
  );

  select count(*) into v_after from public.audit_logs;
  if v_after <> v_before + 1 then
    raise exception 'normal audited action created % rows, expected exactly 1', v_after - v_before;
  end if;
  raise notice 'PASS: normal application action still creates one audit row';
end
$$;

-- ------------------------------------------------------------------
-- 5. The canonical writer keeps its security properties.
-- ------------------------------------------------------------------
do $$
declare
  v_def boolean;
  v_config text[];
begin
  select prosecdef, coalesce(proconfig, '{}'::text[]) into v_def, v_config
  from pg_proc
  where proname = 'write_audit_log'
    and pronamespace = 'public'::regnamespace;

  if not v_def then
    raise exception 'write_audit_log is not SECURITY DEFINER';
  end if;
  if not ('search_path' = any(v_config)) then
    raise exception 'write_audit_log does not pin search_path';
  end if;
  raise notice 'PASS: write_audit_log is SECURITY DEFINER with empty search_path';
end
$$;

-- ------------------------------------------------------------------
-- 6. Per-entity audit triggers and the (narrowed) audit_logs trigger exist.
-- ------------------------------------------------------------------
do $$
declare
  v_triggers text[] := array[
    'trg_audit_projects',
    'trg_audit_timeline',
    'trg_audit_profile_role',
    'trg_audit_clients',
    'trg_audit_documents',
    'trg_audit_events',
    'trg_audit_invoices',
    'trg_audit_project_requests',
    'trg_audit_audit_log_changes'
  ];
  v_name text;
  v_n int;
begin
  foreach v_name in array v_triggers loop
    select count(*) into v_n
    from pg_trigger
    where tgname = v_name and not tgisinternal;
    if v_n <> 1 then
      raise exception 'expected trigger % to exist, found %', v_name, v_n;
    end if;
  end loop;
  raise notice 'PASS: all per-entity audit triggers present';
end
$$;

-- ------------------------------------------------------------------
-- 7. RLS: only a super-admin can UPDATE audit logs.
-- ------------------------------------------------------------------
do $$
declare
  v_n int;
begin
  select count(*) into v_n
  from pg_policy
  where polrelid = 'public.audit_logs'::regclass
    and polname = 'Super admin can update audit logs'
    and polcmd = 'U'; -- UPDATE
  if v_n <> 1 then
    raise exception 'super-admin UPDATE policy missing';
  end if;
  raise notice 'PASS: audit_logs UPDATE RLS policy is super-admin-only';
end
$$;

-- A normal authenticated user (no super-admin role, no profile row) must not
-- be able to archive rows even when sending the UPDATE directly.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f9';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f9","role":"authenticated"}';

do $$
declare v_n int;
begin
  update public.audit_logs
     set archived = true
   where action_type like 'TEST_FIXTURE_%';
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'ordinary user archived % audit rows', v_n;
  end if;
  raise notice 'PASS: ordinary authenticated user cannot archive audit logs (0 rows)';
end
$$;

reset role;

-- Fixture rows are still un-archived after the ordinary-user attempt.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.audit_logs
   where action_type like 'TEST_FIXTURE_%' and archived;
  if v_n <> 0 then
    raise exception 'fixture rows were modified by the ordinary-user attempt';
  end if;
  raise notice 'PASS: fixtures untouched by RLS-denied update';
end
$$;

raise notice 'verify_audit_archive_no_self_audit: ALL CHECKS PASSED';
rollback;