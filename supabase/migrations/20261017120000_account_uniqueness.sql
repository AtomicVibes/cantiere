-- =============================================================
-- Account uniqueness: duplicate email + username prevention
--
-- 1) profiles.username (nullable text) — blank strings become NULL.
-- 2) Pre-flight DO block: detects existing duplicate lower(email) /
--    lower(username) values and raises an actionable error listing them
--    instead of letting the unique indexes fail with a raw 23505.
-- 3) Authoritative case-insensitive unique indexes:
--       profiles_email_lower_uidx    on lower(email)    where email IS NOT NULL
--       profiles_username_lower_uidx on lower(username) where username IS NOT NULL
-- 4) handle_new_user re-created:
--       * rejects a duplicate email/username BEFORE inserting the profile,
--         raising the exact user-facing message. Because the function runs
--         in the same statement as the auth.users INSERT, the Auth insert is
--         rolled back too -> no orphaned Auth user.
--       * persists username from raw_user_meta_data.
-- 5) account_identity_available(p_email, p_username, p_exclude_id) RPC:
--       SECURITY DEFINER availability probe for frontend + edge functions.
--
-- Cleanup query (run BEFORE this migration if it fails on duplicates):
--
--   -- inspect
--   SELECT lower(email) AS email, count(*), array_agg(id) AS ids
--     FROM public.profiles WHERE email IS NOT NULL
--    GROUP BY 1 HAVING count(*) > 1;
--   SELECT lower(username) AS username, count(*), array_agg(id) AS ids
--     FROM public.profiles WHERE username IS NOT NULL
--    GROUP BY 1 HAVING count(*) > 1;
--
--   -- keep the oldest row, detach the duplicates (never delete profiles):
--   UPDATE public.profiles p
--      SET email = NULL
--     FROM (SELECT id, row_number() OVER (PARTITION BY lower(email)
--                    ORDER BY created_at, id) AS rn
--             FROM public.profiles WHERE email IS NOT NULL) d
--    WHERE d.id = p.id AND d.rn > 1;
--   UPDATE public.profiles p
--      SET username = NULL
--     FROM (SELECT id, row_number() OVER (PARTITION BY lower(username)
--                    ORDER BY created_at, id) AS rn
--             FROM public.profiles WHERE username IS NOT NULL) d
--    WHERE d.id = p.id AND d.rn > 1;
--
-- Explicitly NOT changed: roles, permissions, RLS policies, visibility.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------
alter table public.profiles
  add column if not exists username text;

update public.profiles
   set username = nullif(btrim(username), '')
 where username is not null;

comment on column public.profiles.username is
  'Unique account handle. Case-insensitively unique (profiles_username_lower_uidx), 3-30 chars matching ^[a-z0-9_.-]{3,30}$.';

-- ---------------------------------------------------------------
-- 2. Pre-flight duplicate detection (actionable, not a raw 23505)
-- ---------------------------------------------------------------
do $$
declare
  v_emails text := '';
  v_usernames text := '';
begin
  select string_agg(format('%s x%s', e, c), ', ' order by e)
    into v_emails
    from (select lower(email) as e, count(*) as c
            from public.profiles
           where email is not null
           group by 1
          having count(*) > 1) t;

  select string_agg(format('%s x%s', u, c), ', ' order by u)
    into v_usernames
    from (select lower(username) as u, count(*) as c
            from public.profiles
           where username is not null
           group by 1
          having count(*) > 1) t;

  if coalesce(v_emails, '') <> '' or coalesce(v_usernames, '') <> '' then
    raise exception
      'Cannot enable account uniqueness: duplicate identities exist. Duplicate emails: % | Duplicate usernames: %. Run the cleanup query documented at the top of 20261017120000_account_uniqueness.sql, then re-run this migration.',
      coalesce(nullif(v_emails, ''), 'none'),
      coalesce(nullif(v_usernames, ''), 'none');
  end if;
end $$;

-- ---------------------------------------------------------------
-- 3. Authoritative unique indexes (case-insensitive)
-- ---------------------------------------------------------------
create unique index if not exists profiles_email_lower_uidx
  on public.profiles (lower(email))
  where email is not null;

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null;

-- ---------------------------------------------------------------
-- 4. handle_new_user: duplicate guard + username persistence
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role_id UUID;
  v_default_role_id UUID;
  v_role_name TEXT;
  v_email TEXT;
  v_username TEXT;
BEGIN
  v_role_id := (NEW.raw_user_meta_data ->> 'role_id')::UUID;
  v_email := NEW.email;
  v_username := nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'username', '')), '');

  IF v_role_id IS NULL THEN
    SELECT id INTO v_default_role_id FROM public.roles WHERE name = 'client' LIMIT 1;
    v_role_id := v_default_role_id;
  END IF;

  SELECT r.name INTO v_role_name FROM public.roles r WHERE r.id = v_role_id;

  -- Duplicate email: abort so the auth.users INSERT rolls back too
  -- (no orphaned Auth user is left behind).
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE lower(p.email) = lower(v_email)
       AND p.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'An account already exists with this email address.';
  END IF;

  -- Duplicate username: same rollback guarantee.
  IF v_username IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE lower(p.username) = lower(v_username)
       AND p.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'This username is already taken. Please choose another username.';
  END IF;

  INSERT INTO public.profiles (id, email, username, role_id, full_name, phone, job_title, department, created_at, updated_at)
  VALUES (
    NEW.id, v_email, v_username, v_role_id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'phone',
    NEW.raw_user_meta_data ->> 'job_title',
    NEW.raw_user_meta_data ->> 'department',
    NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_role_name = 'client' THEN
    INSERT INTO public.clients (profile_id, created_at, updated_at)
    VALUES (NEW.id, NOW(), NOW())
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------
-- 5. Identity availability RPC
-- ---------------------------------------------------------------
create or replace function public.account_identity_available(
  p_email text default null,
  p_username text default null,
  p_exclude_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email_available',
      btrim(coalesce(p_email, '')) = ''
      or not exists (
        select 1 from public.profiles p
         where lower(p.email) = lower(btrim(p_email))
           and (p_exclude_id is null or p.id <> p_exclude_id)
      ),
    'username_available',
      btrim(coalesce(p_username, '')) = ''
      or not exists (
        select 1 from public.profiles p
         where lower(p.username) = lower(btrim(p_username))
           and (p_exclude_id is null or p.id <> p_exclude_id)
      )
  );
$$;

revoke execute on function public.account_identity_available(text, text, uuid) from anon;
grant execute on function public.account_identity_available(text, text, uuid) to authenticated;
grant execute on function public.account_identity_available(text, text, uuid) to service_role;

notify pgrst, 'reload schema';
