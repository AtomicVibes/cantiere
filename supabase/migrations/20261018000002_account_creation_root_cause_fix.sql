-- =============================================================
-- Add Member / Create Account — root-cause fix for the 400
--   POST /functions/v1/invite-user -> "Database error creating new user"
--
-- Diagnosed against the live database with temporary probe migrations
-- (20261018000000 / 20261018000001, both deleted afterwards):
--
--   1. public.profiles has NO updated_at column (the generated types agree),
--      but handle_new_user inserted one:
--        ERROR: column "updated_at" of relation "profiles" does not exist
--      Every auth.users INSERT therefore aborted inside the trigger, and
--      GoTrue hid the real message behind "Database error creating new user".
--
--   2. the AFTER INSERT trigger on profiles (assign_default_role) always ran
--        UPDATE profiles SET role_id = (roles WHERE name = 'team_member')
--      'team_member' does not exist in public.roles, so every newly created
--      profile silently ended up with role_id = NULL — wiping the default
--      User role that the account flow just assigned.
--
-- This migration re-creates both functions and then proves the fix by running
-- the real creation path (auth.users INSERT -> trigger -> profiles) and
-- checking the resulting profile, cleaning up after itself.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. handle_new_user: write only columns that exist on public.profiles
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

  -- Column list matches the deployed public.profiles schema
  -- (no updated_at: the table does not have one).
  INSERT INTO public.profiles (id, email, username, role_id, full_name, phone, job_title, department, created_at)
  VALUES (
    NEW.id, v_email, v_username, v_role_id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'phone',
    NEW.raw_user_meta_data ->> 'job_title',
    NEW.raw_user_meta_data ->> 'department',
    NOW()
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
-- 2. assign_default_role: only fill a role when none was assigned,
--    and only with a role that really exists (never NULL it out).
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role_id UUID;
BEGIN
  -- The account flow (invite-user / create-client / handle_new_user) resolves
  -- the role before the row exists: never overwrite it.
  IF NEW.role_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_role_id FROM public.roles WHERE name = 'team_member' LIMIT 1;
  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'manager' LIMIT 1;
  END IF;
  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'client' LIMIT 1;
  END IF;

  IF v_role_id IS NOT NULL THEN
    UPDATE public.profiles
       SET role_id = v_role_id
     WHERE id = NEW.id
       AND role_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------
-- 3. Verification: run the exact creation path GoTrue runs and assert
--    the profile that comes out (auth user + profile + default role).
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_id uuid := '00000000-0000-0000-0000-00000000d1a8';
  v_role_id uuid;
  v_role_name text;
  v_profile_role uuid;
  v_username text;
  v_email text;
  v_full_name text;
BEGIN
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'manager' LIMIT 1;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'verification aborted: no manager ("User") role row exists';
  END IF;

  BEGIN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, confirmation_sent_at, recovery_sent_at,
      email_change_sent_at, confirmation_token, recovery_token,
      email_change_token_new, email_change_token_current, email_change,
      phone, phone_change, phone_change_token, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_id, NULL, 'authenticated', 'authenticated',
      'account-fix-verification@example.invalid',
      '$2a$10$verificationhashverificationhashverific',
      NOW(), NOW(), NOW(), NOW(), '', '', '', '', '',
      NULL, NULL, '', NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'full_name', 'Account Fix Verification',
        'username', 'account-fix-verification',
        'phone', '+39000000000',
        'role_id', v_role_id::text
      ),
      NOW(), NOW()
    );

    SELECT p.role_id, p.username, p.email, p.full_name
      INTO v_profile_role, v_username, v_email, v_full_name
      FROM public.profiles p
     WHERE p.id = v_id;

    IF v_profile_role IS NULL THEN
      RAISE EXCEPTION 'verification failed: profile row was not created';
    END IF;
    IF v_profile_role <> v_role_id THEN
      SELECT name INTO v_role_name FROM public.roles WHERE id = v_profile_role;
      RAISE EXCEPTION 'verification failed: profile role_id is % (%), expected the User role %',
        v_profile_role, coalesce(v_role_name, 'no role'), v_role_id;
    END IF;
    IF v_username IS DISTINCT FROM 'account-fix-verification' THEN
      RAISE EXCEPTION 'verification failed: username not preserved (got %)', coalesce(v_username, 'NULL');
    END IF;
    IF v_email IS DISTINCT FROM 'account-fix-verification@example.invalid' THEN
      RAISE EXCEPTION 'verification failed: email not preserved (got %)', coalesce(v_email, 'NULL');
    END IF;

    -- Cleanup: profile first (FK), then the Auth user.
    DELETE FROM public.profiles WHERE id = v_id;
    DELETE FROM auth.users WHERE id = v_id;

    IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_id)
       OR EXISTS (SELECT 1 FROM public.profiles WHERE id = v_id) THEN
      RAISE EXCEPTION 'verification failed: probe records could not be cleaned up';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The sub-block already rolled back; surface the reason.
    RAISE;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
